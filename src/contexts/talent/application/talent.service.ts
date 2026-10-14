import { Injectable } from '@nestjs/common';
import type { CycleStatus } from '@prisma/client';

import { EmployeeDirectory } from '@/contexts/workforce/public';
import { authorize, can } from '@/shared/application/permissions';
import { ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate, toDate } from '@/shared/application/formatting';

/** 9-box labels: index = (3 − potential) × 3 + (performance − 1), potential/performance on a 1–3 scale. */
const NINE_BOX = ['Talento a desenvolver', 'Futuro líder', 'Estrela', 'Profissional em risco', 'Profissional sólido', 'Alto desempenho', 'Insuficiente', 'Eficaz', 'Especialista de confiança'];

/** Performance cycles, reviews, goals and feedback (docs/03, M12). */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly directory: EmployeeDirectory,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async cycles() {
    const actor = this.actors.current;
    if (!can(actor, 'performance.read')) throw new ForbiddenError();
    const cycles = await this.db.tx.reviewCycle.findMany({ where: { companyId: actor.companyId }, orderBy: { startDate: 'desc' } });
    const counts = await this.db.tx.performanceReview.groupBy({ by: ['cycleId'], _count: { _all: true, completedAt: true } });
    const byCycle = new Map(counts.map((row) => [row.cycleId, row._count]));
    return cycles.map((cycle) => ({ ...cycle, startDate: isoDate(cycle.startDate), endDate: isoDate(cycle.endDate), participants: byCycle.get(cycle.id)?._all ?? 0, completed: byCycle.get(cycle.id)?.completedAt ?? 0 }));
  }

  /** Creates the cycle and one review per participant (whole company or one unit). */
  async createCycle(input: { name: string; startDate: string; endDate: string; orgUnitId?: string; selfAssessment?: boolean }) {
    const actor = this.actors.current;
    authorize(actor, 'performance.write');
    const today = new Date();
    const start = toDate(input.startDate);
    const cycle = await this.db.tx.reviewCycle.create({
      data: { tenantId: actor.tenantId, companyId: actor.companyId, name: input.name, startDate: start, endDate: toDate(input.endDate), selfAssessment: input.selfAssessment ?? true, status: start <= today ? 'ACTIVE' : 'SCHEDULED' },
    });
    const participants = await this.db.tx.employee.findMany({ where: { companyId: actor.companyId, status: { in: ['ACTIVE', 'PROBATION'] }, ...(input.orgUnitId ? { orgUnitId: input.orgUnitId } : {}) }, select: { id: true, managerId: true } });
    await this.db.tx.performanceReview.createMany({ data: participants.map((p) => ({ tenantId: actor.tenantId, cycleId: cycle.id, employeeId: p.id, reviewerId: p.managerId })) });
    await this.audit.record({ action: 'review_cycle.create', entityType: 'review_cycle', entityId: cycle.id, after: { name: input.name, participants: participants.length } });
    return { id: cycle.id, participants: participants.length };
  }

  async setCycleStatus(id: string, status: CycleStatus) {
    authorize(this.actors.current, 'performance.write');
    return this.db.tx.reviewCycle.update({ where: { id }, data: { status } });
  }

  async reviews(cycleId: string) {
    const actor = this.actors.current;
    const reviews = await this.db.tx.performanceReview.findMany({ where: { cycleId, ...(can(actor, 'performance.read') && actor.permissions.has('employees.read') ? {} : { reviewerId: actor.employeeId ?? '-' }) } });
    const names = await this.directory.names([...reviews.map((r) => r.employeeId), ...reviews.map((r) => r.reviewerId).filter((id): id is string => Boolean(id))]);
    return reviews.map((review) => ({ ...review, employee: { id: review.employeeId, name: names.get(review.employeeId) ?? null }, reviewer: review.reviewerId ? { id: review.reviewerId, name: names.get(review.reviewerId) ?? null } : null }));
  }

  /** The manager (or HR) records performance and potential (1–3) and comments. */
  async submitReview(id: string, input: { performance: number; potential: number; comments?: string }) {
    const actor = this.actors.current;
    const review = await this.db.tx.performanceReview.findUnique({ where: { id } });
    if (!review) throw new NotFoundError('Avaliação', id);
    if (review.reviewerId !== actor.employeeId && !can(actor, 'performance.write')) throw new ForbiddenError('Só a chefia ou o RH avaliam', 'not_reviewer');
    if (review.employeeId === actor.employeeId) throw new ForbiddenError('Não pode avaliar-se a si próprio aqui', 'self_review');
    const updated = await this.db.tx.performanceReview.update({ where: { id }, data: { ...input, completedAt: new Date() } });
    await this.audit.record({ action: 'review.submit', entityType: 'performance_review', entityId: id });
    return updated;
  }

  async nineBox(cycleId: string) {
    authorize(this.actors.current, 'performance.read');
    const reviews = await this.db.tx.performanceReview.findMany({ where: { cycleId, completedAt: { not: null } }, select: { performance: true, potential: true } });
    const counts = Array<number>(9).fill(0);
    for (const review of reviews) if (review.performance && review.potential) counts[(3 - review.potential) * 3 + (review.performance - 1)]++;
    return NINE_BOX.map((label, index) => ({ label, count: counts[index], performance: (index % 3) + 1, potential: 3 - Math.floor(index / 3) }));
  }

  async goals(employeeId?: string) {
    const actor = this.actors.current;
    const target = employeeId ?? (can(actor, 'performance.read') ? undefined : actor.employeeId ?? '-');
    const goals = await this.db.tx.goal.findMany({ where: target ? { employeeId: target } : {}, orderBy: { dueDate: 'asc' } });
    const names = await this.directory.names(goals.map((goal) => goal.employeeId));
    return goals.map((goal) => ({ ...goal, dueDate: isoDate(goal.dueDate), owner: { id: goal.employeeId, name: names.get(goal.employeeId) ?? null }, atRisk: goal.progress < 50 && goal.dueDate.getTime() - Date.now() < 60 * 86_400_000 }));
  }

  async createGoal(input: { employeeId: string; title: string; dueDate: string }) {
    const actor = this.actors.current;
    const employee = await this.directory.get(input.employeeId);
    if (employee.managerId !== actor.employeeId && !can(actor, 'performance.write')) throw new ForbiddenError();
    return this.db.tx.goal.create({ data: { tenantId: actor.tenantId, employeeId: input.employeeId, title: input.title, dueDate: toDate(input.dueDate) } });
  }

  async updateGoalProgress(id: string, progress: number) {
    const actor = this.actors.current;
    const goal = await this.db.tx.goal.findUnique({ where: { id } });
    if (!goal) throw new NotFoundError('Objectivo', id);
    if (goal.employeeId !== actor.employeeId && !can(actor, 'performance.write')) {
      const employee = await this.directory.get(goal.employeeId);
      if (employee.managerId !== actor.employeeId) throw new ForbiddenError();
    }
    return this.db.tx.goal.update({ where: { id }, data: { progress } });
  }

  async feedback() {
    const actor = this.actors.current;
    const items = await this.db.tx.feedback.findMany({
      where: can(actor, 'performance.read') ? {} : { OR: [{ isPublic: true }, { toEmployeeId: actor.employeeId ?? '-' }, { fromUserId: actor.userId }] },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = await this.directory.names([...items.map((i) => i.toEmployeeId), ...items.map((i) => i.fromEmployeeId).filter((id): id is string => Boolean(id))]);
    return items.map((item) => ({ ...item, to: { id: item.toEmployeeId, name: names.get(item.toEmployeeId) ?? null }, from: item.fromEmployeeId ? { id: item.fromEmployeeId, name: names.get(item.fromEmployeeId) ?? null } : null }));
  }

  async giveFeedback(input: { toEmployeeId: string; kind: 'Reconhecimento' | 'Sugestão'; value?: string; message: string; isPublic?: boolean }) {
    const actor = this.actors.current;
    if (input.toEmployeeId === actor.employeeId) throw new ForbiddenError('Não pode dar feedback a si próprio', 'self_feedback');
    await this.directory.get(input.toEmployeeId);
    const item = await this.db.tx.feedback.create({ data: { tenantId: actor.tenantId, fromUserId: actor.userId, fromEmployeeId: actor.employeeId, toEmployeeId: input.toEmployeeId, kind: input.kind, value: input.value, message: input.message, isPublic: input.isPublic ?? true } });
    await this.outbox.publish('feedback.given', { feedbackId: item.id, toEmployeeId: input.toEmployeeId, kind: input.kind });
    return item;
  }
}

/** Training plan, sessions and certificates (docs/03, M13). */
@Injectable()
export class TrainingService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly directory: EmployeeDirectory,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const actor = this.actors.current;
    authorize(actor, 'training.read');
    const trainings = await this.db.tx.training.findMany({ where: { companyId: actor.companyId }, include: { _count: { select: { enrollments: true } } }, orderBy: { date: 'desc' } });
    return trainings.map((training) => ({ ...training, date: isoDate(training.date), enrolled: training._count.enrollments, _count: undefined }));
  }

  async create(input: { title: string; provider: string; date: string; hours: number; seats: number; mandatory?: boolean }) {
    const actor = this.actors.current;
    authorize(actor, 'training.write');
    const training = await this.db.tx.training.create({ data: { ...input, date: toDate(input.date), tenantId: actor.tenantId, companyId: actor.companyId } });
    await this.audit.record({ action: 'training.create', entityType: 'training', entityId: training.id, after: { title: training.title } });
    return training;
  }

  async enroll(trainingId: string, employeeIds: string[]) {
    const actor = this.actors.current;
    authorize(actor, 'training.write');
    const training = await this.db.tx.training.findFirst({ where: { id: trainingId, companyId: actor.companyId }, include: { _count: { select: { enrollments: true } } } });
    if (!training) throw new NotFoundError('Acção de formação', trainingId);
    const free = training.seats - training._count.enrollments;
    const accepted = employeeIds.slice(0, Math.max(0, free));
    await this.db.tx.trainingEnrollment.createMany({ data: accepted.map((employeeId) => ({ tenantId: actor.tenantId, trainingId, employeeId })), skipDuplicates: true });
    return { enrolled: accepted.length, waitlisted: employeeIds.length - accepted.length };
  }

  async enrollments(trainingId: string) {
    authorize(this.actors.current, 'training.read');
    const rows = await this.db.tx.trainingEnrollment.findMany({ where: { trainingId } });
    const names = await this.directory.names(rows.map((row) => row.employeeId));
    return rows.map((row) => ({ ...row, certificateExpiresAt: isoDate(row.certificateExpiresAt), employee: { id: row.employeeId, name: names.get(row.employeeId) ?? null } }));
  }

  async recordAttendance(enrollmentId: string, input: { attended: boolean; certificateExpiresAt?: string | null }) {
    authorize(this.actors.current, 'training.write');
    return this.db.tx.trainingEnrollment.update({ where: { id: enrollmentId }, data: { attended: input.attended, certificateExpiresAt: input.certificateExpiresAt ? toDate(input.certificateExpiresAt) : input.certificateExpiresAt } });
  }

  /** Certificates expiring in the next `days` (mandatory trainings, docs/03 M13). */
  async expiringCertificates(days = 90) {
    authorize(this.actors.current, 'training.read');
    const rows = await this.db.tx.trainingEnrollment.findMany({ where: { certificateExpiresAt: { lte: new Date(Date.now() + days * 86_400_000) } }, include: { training: { select: { title: true } } }, orderBy: { certificateExpiresAt: 'asc' } });
    const names = await this.directory.names(rows.map((row) => row.employeeId));
    return rows.map((row) => ({ employee: { id: row.employeeId, name: names.get(row.employeeId) ?? null }, title: row.training.title, expiresAt: isoDate(row.certificateExpiresAt) }));
  }
}
