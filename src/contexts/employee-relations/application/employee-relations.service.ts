import { Injectable } from '@nestjs/common';
import type { AccidentSeverity } from '@prisma/client';

import { EmployeeDirectory } from '@/contexts/workforce/public';
import { authorize } from '@/shared/application/permissions';
import { NotFoundError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate, toDate } from '@/shared/application/formatting';

/** Disciplinary cases: sensitive data, explicit permission only (docs/03 M14, docs/05). */
@Injectable()
export class DisciplinaryService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly directory: EmployeeDirectory,
    private readonly audit: AuditService,
  ) {}

  async list() {
    authorize(this.actors.current, 'disciplinary.read');
    const cases = await this.db.tx.disciplinaryCase.findMany({ orderBy: { createdAt: 'desc' } });
    const names = await this.directory.names(cases.map((c) => c.employeeId));
    return cases.map((item) => ({ ...item, incidentDate: isoDate(item.incidentDate), deadline: isoDate(item.deadline), employee: { id: item.employeeId, name: names.get(item.employeeId) ?? null } }));
  }

  /** Opens the case with the default deadline for the defence (10 working days ≈ 14 calendar days, parametrisable). */
  async open(input: { employeeId: string; instructorId?: string; infraction: string; facts: string; incidentDate: string }) {
    const actor = this.actors.current;
    authorize(actor, 'disciplinary.write');
    await this.directory.get(input.employeeId);
    const count = await this.db.tx.disciplinaryCase.count();
    const reference = `PD-${new Date().getUTCFullYear()}-${String(count + 1).padStart(2, '0')}`;
    const created = await this.db.tx.disciplinaryCase.create({
      data: { tenantId: actor.tenantId, reference, employeeId: input.employeeId, instructorId: input.instructorId, infraction: input.infraction, facts: input.facts, incidentDate: toDate(input.incidentDate), deadline: new Date(Date.now() + 14 * 86_400_000) },
    });
    await this.audit.record({ action: 'disciplinary.open', entityType: 'disciplinary_case', entityId: created.id, after: { reference }, sensitive: true });
    return created;
  }

  async advance(id: string, input: { stage: string; deadline?: string | null; decision?: string; close?: boolean }) {
    authorize(this.actors.current, 'disciplinary.write');
    const item = await this.db.tx.disciplinaryCase.findUnique({ where: { id } });
    if (!item) throw new NotFoundError('Processo disciplinar', id);
    const updated = await this.db.tx.disciplinaryCase.update({
      where: { id },
      data: { stage: input.stage, deadline: input.deadline ? toDate(input.deadline) : input.deadline, decision: input.decision, status: input.close ? 'CLOSED' : item.status },
    });
    await this.audit.record({ action: 'disciplinary.advance', entityType: 'disciplinary_case', entityId: id, before: { stage: item.stage }, after: { stage: input.stage, closed: input.close ?? false }, sensitive: true });
    return updated;
  }
}

/** Occupational health and safety: medical exams and accidents (docs/03 M15). */
@Injectable()
export class SafetyService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly directory: EmployeeDirectory,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async exams() {
    authorize(this.actors.current, 'safety.read');
    const exams = await this.db.tx.medicalExam.findMany({ orderBy: { dueDate: 'asc' } });
    const names = await this.directory.names(exams.map((e) => e.employeeId));
    const today = new Date();
    return exams.map((exam) => ({
      ...exam,
      dueDate: isoDate(exam.dueDate),
      doneAt: isoDate(exam.doneAt),
      status: exam.doneAt ? 'DONE' : exam.dueDate < today ? 'OVERDUE' : 'SCHEDULED',
      employee: { id: exam.employeeId, name: names.get(exam.employeeId) ?? null },
    }));
  }

  async scheduleExam(input: { employeeId: string; kind: string; dueDate: string }) {
    const actor = this.actors.current;
    authorize(actor, 'safety.write');
    await this.directory.get(input.employeeId);
    return this.db.tx.medicalExam.create({ data: { tenantId: actor.tenantId, employeeId: input.employeeId, kind: input.kind, dueDate: toDate(input.dueDate) } });
  }

  async recordExam(id: string, input: { doneAt: string; result?: string }) {
    authorize(this.actors.current, 'safety.write');
    return this.db.tx.medicalExam.update({ where: { id }, data: { doneAt: toDate(input.doneAt), result: input.result } });
  }

  async accidents() {
    authorize(this.actors.current, 'safety.read');
    const accidents = await this.db.tx.accident.findMany({ orderBy: { date: 'desc' } });
    const names = await this.directory.names(accidents.map((a) => a.employeeId));
    const last = accidents[0]?.date;
    return {
      daysWithoutAccidents: last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null,
      data: accidents.map((accident) => ({ ...accident, date: isoDate(accident.date), employee: { id: accident.employeeId, name: names.get(accident.employeeId) ?? null } })),
    };
  }

  async reportAccident(input: { employeeId: string; date: string; location: string; severity: AccidentSeverity; daysLost?: number; description: string }) {
    const actor = this.actors.current;
    authorize(actor, 'safety.write');
    await this.directory.get(input.employeeId);
    const accident = await this.db.tx.accident.create({ data: { ...input, date: toDate(input.date), tenantId: actor.tenantId } });
    await this.outbox.publish('accident.reported', { accidentId: accident.id, severity: input.severity });
    await this.audit.record({ action: 'accident.report', entityType: 'accident', entityId: accident.id, after: { severity: input.severity }, sensitive: true });
    return accident;
  }

  async markReported(id: string) {
    authorize(this.actors.current, 'safety.write');
    return this.db.tx.accident.update({ where: { id }, data: { reportedAt: new Date() } });
  }
}
