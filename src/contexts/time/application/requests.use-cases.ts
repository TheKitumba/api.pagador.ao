import { Injectable, OnModuleInit } from '@nestjs/common';
import type { OvertimeKind, Prisma, RequestStatus, ShiftKind } from '@prisma/client';

import { ApprovalOutcomeRegistry, Approvals } from '@/contexts/approvals/public';
import { authorize, can } from '@/shared/application/permissions';
import { ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate, toDate } from '@/shared/application/formatting';

import { monthRange } from '../domain/calendar';
import { TimeSupport } from './time-support';

const KIND_LABEL: Record<OvertimeKind, string> = { WEEKDAY: 'Dia útil', REST_DAY: 'Descanso semanal', HOLIDAY: 'Feriado', NIGHT: 'Nocturno' };
const DECIDED = { APPROVED: 'APPROVED', REJECTED: 'REJECTED', RETURNED: 'RETURNED' } as const;

async function overtimeLimits(db: Database) {
  const table = await db.tx.legalTable.findFirst({ where: { kind: 'OVERTIME_RATES', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
  const data = (table?.data ?? {}) as { monthlyLimitHours?: number; annualLimitHours?: number };
  return { monthly: data.monthlyLimitHours ?? 30, annual: data.annualLimitHours ?? 200 };
}

@Injectable()
export class RequestOvertimeUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly support: TimeSupport,
    private readonly approvals: Approvals,
  ) {}

  async execute(input: { employeeId?: string; date: string; minutes: number; kind: OvertimeKind; reason: string }) {
    const actor = this.actors.current;
    const employee = await this.support.resolveEmployee(actor, input.employeeId, 'overtime.write');
    const date = toDate(input.date);
    const { start, end } = monthRange(date.getUTCFullYear(), date.getUTCMonth() + 1);
    const [month, limits] = await Promise.all([
      this.db.tx.overtimeRequest.aggregate({ where: { employeeId: employee.id, status: { in: ['PENDING', 'APPROVED'] }, date: { gte: start, lte: end } }, _sum: { minutes: true } }),
      overtimeLimits(this.db),
    ]);
    const monthHours = ((month._sum.minutes ?? 0) + input.minutes) / 60;

    const request = await this.db.tx.overtimeRequest.create({ data: { tenantId: actor.tenantId, employeeId: employee.id, date, minutes: input.minutes, kind: input.kind, reason: input.reason } });
    await this.approvals.start({
      type: 'OVERTIME',
      subjectId: request.id,
      title: `${input.minutes / 60} h extra — ${KIND_LABEL[input.kind]} em ${input.date}`,
      detail: `${input.reason} · total no mês: ${monthHours} h / limite ${limits.monthly} h`,
      requesterUserId: actor.userId,
      beneficiary: { employeeId: employee.id, name: employee.name, managerId: employee.managerId },
    });
    return { id: request.id, status: request.status, monthHours, monthlyLimitHours: limits.monthly, exceedsLimit: monthHours > limits.monthly };
  }
}

@Injectable()
export class RegisterTimesheetUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly support: TimeSupport,
    private readonly approvals: Approvals,
  ) {}

  async execute(input: { employeeId?: string; weekStart: string; project: string; hours: number; notes?: string }) {
    const actor = this.actors.current;
    const employee = await this.support.resolveEmployee(actor, input.employeeId, 'attendance.write');
    const timesheet = await this.db.tx.timesheet.create({ data: { tenantId: actor.tenantId, employeeId: employee.id, weekStart: toDate(input.weekStart), project: input.project, hours: input.hours, notes: input.notes } });
    await this.approvals.start({
      type: 'TIMESHEET',
      subjectId: timesheet.id,
      title: `Folha de horas — semana de ${input.weekStart} (${input.hours} h)`,
      detail: input.project,
      requesterUserId: actor.userId,
      beneficiary: { employeeId: employee.id, name: employee.name, managerId: employee.managerId },
    });
    return { id: timesheet.id, status: timesheet.status };
  }
}

@Injectable()
export class TimeRequestOutcomeHandlers implements OnModuleInit {
  constructor(
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.registry.register('OVERTIME', async ({ subjectId, decision }) => {
      const request = await this.db.tx.overtimeRequest.update({ where: { id: subjectId }, data: { status: DECIDED[decision] } });
      if (decision === 'APPROVED') await this.outbox.publish('overtime.approved', { overtimeRequestId: request.id, employeeId: request.employeeId });
    });
    this.registry.register('TIMESHEET', async ({ subjectId, decision }) => {
      await this.db.tx.timesheet.update({ where: { id: subjectId }, data: { status: DECIDED[decision] } });
    });
  }
}

@Injectable()
export class TimeRequestQueries {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  private async names(ids: string[]) {
    const actor = this.actors.current;
    const where: Prisma.EmployeeWhereInput = { id: { in: ids }, companyId: actor.companyId };
    if (!can(actor, 'overtime.read') && !can(actor, 'attendance.read')) {
      if (can(actor, 'team.read') && actor.employeeId) where.OR = [{ managerId: actor.employeeId }, { id: actor.employeeId }];
      else if (actor.employeeId) where.id = actor.employeeId;
      else throw new ForbiddenError();
    }
    const rows = await this.db.tx.employee.findMany({ where, select: { id: true, fullName: true } });
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  async overtime(filter: { status?: RequestStatus; year: number; month: number }) {
    const { start, end } = monthRange(filter.year, filter.month);
    const rows = await this.db.tx.overtimeRequest.findMany({ where: { date: { gte: start, lte: end }, ...(filter.status ? { status: filter.status } : {}) }, orderBy: { date: 'desc' } });
    const names = await this.names(rows.map((row) => row.employeeId));
    const limits = await overtimeLimits(this.db);
    const totals = new Map<string, number>();
    for (const row of rows.filter((item) => item.status !== 'REJECTED' && item.status !== 'CANCELLED')) totals.set(row.employeeId, (totals.get(row.employeeId) ?? 0) + row.minutes);
    return {
      monthlyLimitHours: limits.monthly,
      data: rows
        .filter((row) => names.has(row.employeeId))
        .map((row) => ({
          id: row.id,
          employee: { id: row.employeeId, name: names.get(row.employeeId)! },
          date: isoDate(row.date),
          hours: row.minutes / 60,
          kind: row.kind,
          kindLabel: KIND_LABEL[row.kind],
          reason: row.reason,
          status: row.status,
          monthTotalHours: (totals.get(row.employeeId) ?? 0) / 60,
          exceedsLimit: (totals.get(row.employeeId) ?? 0) / 60 > limits.monthly,
        })),
    };
  }

  async timesheets(status?: RequestStatus) {
    const rows = await this.db.tx.timesheet.findMany({ where: status ? { status } : {}, orderBy: { weekStart: 'desc' }, take: 300 });
    const names = await this.names(rows.map((row) => row.employeeId));
    return rows
      .filter((row) => names.has(row.employeeId))
      .map((row) => ({ id: row.id, employee: { id: row.employeeId, name: names.get(row.employeeId)! }, weekStart: isoDate(row.weekStart), project: row.project, hours: row.hours.toString(), notes: row.notes, status: row.status }));
  }
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const actor = this.actors.current;
    authorize(actor, 'attendance.read');
    const [schedules, counts] = await Promise.all([
      this.db.tx.workSchedule.findMany({ where: { companyId: actor.companyId, archivedAt: null }, orderBy: { name: 'asc' } }),
      this.db.tx.employee.groupBy({ by: ['scheduleId'], where: { companyId: actor.companyId, status: { not: 'TERMINATED' } }, _count: true }),
    ]);
    const byId = new Map(counts.map((row) => [row.scheduleId, row._count]));
    return schedules.map((schedule) => ({ ...schedule, weeklyHours: schedule.weeklyHours.toString(), employees: byId.get(schedule.id) ?? 0 }));
  }

  async create(input: { name: string; type?: 'FIXED' | 'FLEXIBLE' | 'SHIFT' | 'ROTATION'; weeklyHours: number; startTime?: string; endTime?: string; days?: string[]; toleranceMinutes?: number }) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.write');
    const schedule = await this.db.tx.workSchedule.create({ data: { ...input, tenantId: actor.tenantId, companyId: actor.companyId } });
    await this.audit.record({ action: 'schedule.create', entityType: 'work_schedule', entityId: schedule.id, after: schedule });
    return schedule;
  }

  async update(id: string, input: Partial<{ name: string; weeklyHours: number; startTime: string; endTime: string; days: string[]; toleranceMinutes: number }>) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.write');
    const schedule = await this.db.tx.workSchedule.findFirst({ where: { id, companyId: actor.companyId } });
    if (!schedule) throw new NotFoundError('Horário', id);
    return this.db.tx.workSchedule.update({ where: { id }, data: input });
  }

  async archive(id: string) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.write');
    await this.db.tx.workSchedule.updateMany({ where: { id, companyId: actor.companyId }, data: { archivedAt: new Date() } });
  }

  async roster(weekStart: string, establishmentId?: string) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.read');
    const start = toDate(weekStart);
    const end = new Date(start.getTime() + 6 * 86_400_000);
    const employees = await this.db.tx.employee.findMany({
      where: { companyId: actor.companyId, status: { not: 'TERMINATED' }, ...(establishmentId ? { establishmentId } : {}) },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    const shifts = await this.db.tx.shiftAssignment.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: start, lte: end } } });
    const days = Array.from({ length: 7 }, (_, index) => isoDate(new Date(start.getTime() + index * 86_400_000))!);
    return {
      weekStart,
      days,
      rows: employees
        .map((employee) => ({ employee: { id: employee.id, name: employee.fullName }, shifts: days.map((day) => shifts.find((shift) => shift.employeeId === employee.id && isoDate(shift.date) === day)?.shift ?? null) }))
        .filter((row) => row.shifts.some(Boolean) || !establishmentId),
    };
  }

  async assign(assignments: { employeeId: string; date: string; shift: ShiftKind }[]) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.write');
    for (const assignment of assignments) {
      await this.db.tx.shiftAssignment.upsert({
        where: { employeeId_date: { employeeId: assignment.employeeId, date: toDate(assignment.date) } },
        create: { tenantId: actor.tenantId, employeeId: assignment.employeeId, date: toDate(assignment.date), shift: assignment.shift },
        update: { shift: assignment.shift },
      });
    }
    await this.audit.record({ action: 'shifts.assign', entityType: 'shift_assignment', after: { count: assignments.length } });
    return { updated: assignments.length };
  }
}
