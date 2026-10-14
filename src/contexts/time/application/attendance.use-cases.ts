import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma, PunchSource, PunchType } from '@prisma/client';

import { ApprovalOutcomeRegistry, Approvals } from '@/contexts/approvals/public';
import { authorize, can } from '@/shared/application/permissions';
import { BusinessRuleViolation, ForbiddenError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate, toDate } from '@/shared/application/formatting';

import { monthRange } from '../domain/calendar';
import { TimeSupport } from './time-support';

const DEFAULT_START = '08:00';
const DEFAULT_TOLERANCE = 10;

/** Times are shown in Africa/Luanda (UTC+1, no daylight saving). */
const luandaTime = (date: Date) => new Date(date.getTime() + 3_600_000).toISOString().slice(11, 16);
const luandaDay = (date: Date) => new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10);

@Injectable()
export class PunchUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  /** Clock in/out from the browser (docs/03, M05). The type alternates IN/OUT within the day. */
  async execute(input: { latitude?: number; longitude?: number; idempotencyKey?: string }, userAgent?: string) {
    const actor = this.actors.current;
    if (!actor.employeeId) throw new ForbiddenError('A sua conta não está ligada a um trabalhador', 'no_employee_link');
    if (input.idempotencyKey) {
      const existing = await this.db.tx.attendanceRecord.findUnique({ where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return { id: existing.id, type: existing.type, time: luandaTime(existing.timestamp), duplicate: true };
    }
    const now = new Date();
    const dayStart = new Date(`${luandaDay(now)}T00:00:00+01:00`);
    const last = await this.db.tx.attendanceRecord.findFirst({ where: { employeeId: actor.employeeId, timestamp: { gte: dayStart } }, orderBy: { timestamp: 'desc' } });
    const type: PunchType = last?.type === 'IN' ? 'OUT' : 'IN';
    const record = await this.db.tx.attendanceRecord.create({
      data: { tenantId: actor.tenantId, employeeId: actor.employeeId, timestamp: now, type, source: 'WEB', latitude: input.latitude, longitude: input.longitude, userAgent, idempotencyKey: input.idempotencyKey },
    });
    return { id: record.id, type, time: luandaTime(now), duplicate: false };
  }
}

@Injectable()
export class ImportPunchesUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  /** Bulk import from biometric terminals or the public API (idempotent by `idempotencyKey`). */
  async execute(records: { employeeId: string; timestamp: string; type: PunchType; source: PunchSource; idempotencyKey: string }[]) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.write');
    const result = await this.db.tx.attendanceRecord.createMany({
      data: records.map((record) => ({ ...record, tenantId: actor.tenantId, timestamp: new Date(record.timestamp) })),
      skipDuplicates: true,
    });
    return { received: records.length, created: result.count, duplicates: records.length - result.count };
  }
}

@Injectable()
export class AttendanceQueries {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  /** Today's board: who is present, late, absent or on leave (docs/10, "Presença"). */
  async today(filter: { establishmentId?: string; date?: string }) {
    const actor = this.actors.current;
    if (!can(actor, 'attendance.read') && !can(actor, 'team.read')) throw new ForbiddenError();
    const day = filter.date ?? luandaDay(new Date());
    const start = new Date(`${day}T00:00:00+01:00`);
    const end = new Date(start.getTime() + 86_400_000);

    const employees = await this.db.tx.employee.findMany({
      where: {
        companyId: actor.companyId,
        status: { in: ['ACTIVE', 'PROBATION', 'ON_LEAVE'] },
        ...(filter.establishmentId ? { establishmentId: filter.establishmentId } : {}),
        ...(can(actor, 'attendance.read') ? {} : { managerId: actor.employeeId }),
      },
      select: { id: true, fullName: true, establishmentId: true, scheduleId: true },
      orderBy: { fullName: 'asc' },
    });
    const ids = employees.map((employee) => employee.id);
    const [records, leave, schedules, sites] = await Promise.all([
      this.db.tx.attendanceRecord.findMany({ where: { employeeId: { in: ids }, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: 'asc' } }),
      this.db.tx.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: toDate(day) }, endDate: { gte: toDate(day) } } }),
      this.db.tx.workSchedule.findMany({ where: { companyId: actor.companyId } }),
      this.db.tx.establishment.findMany({ where: { companyId: actor.companyId }, select: { id: true, name: true } }),
    ]);
    const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const siteName = new Map(sites.map((site) => [site.id, site.name]));
    const onLeave = new Set(leave.map((item) => item.employeeId));

    const rows = employees.map((employee) => {
      const punches = records.filter((record) => record.employeeId === employee.id);
      const firstIn = punches.find((record) => record.type === 'IN');
      const lastOut = [...punches].reverse().find((record) => record.type === 'OUT');
      const schedule = employee.scheduleId ? scheduleById.get(employee.scheduleId) : undefined;
      const scheduledStart = new Date(`${day}T${schedule?.startTime ?? DEFAULT_START}:00+01:00`);
      const limit = new Date(scheduledStart.getTime() + (schedule?.toleranceMinutes ?? DEFAULT_TOLERANCE) * 60_000);
      const status = onLeave.has(employee.id) ? 'leave' : !firstIn ? 'absent' : firstIn.timestamp > limit ? 'late' : 'present';
      return {
        employee: { id: employee.id, name: employee.fullName },
        establishment: employee.establishmentId ? (siteName.get(employee.establishmentId) ?? null) : null,
        in: firstIn ? luandaTime(firstIn.timestamp) : null,
        out: lastOut ? luandaTime(lastOut.timestamp) : null,
        source: firstIn?.source ?? null,
        status,
      };
    });

    const count = (status: string) => rows.filter((row) => row.status === status).length;
    return { date: day, summary: { expected: rows.length - count('leave'), present: count('present') + count('late'), late: count('late'), absent: count('absent'), onLeave: count('leave') }, rows };
  }

  async myHistory(days = 30) {
    const actor = this.actors.current;
    if (!actor.employeeId) throw new ForbiddenError('A sua conta não está ligada a um trabalhador', 'no_employee_link');
    const records = await this.db.tx.attendanceRecord.findMany({ where: { employeeId: actor.employeeId, timestamp: { gte: new Date(Date.now() - days * 86_400_000) } }, orderBy: { timestamp: 'asc' } });
    const byDay = new Map<string, { in: string | null; out: string | null }>();
    for (const record of records) {
      const day = luandaDay(record.timestamp);
      const entry = byDay.get(day) ?? { in: null, out: null };
      if (record.type === 'IN' && !entry.in) entry.in = luandaTime(record.timestamp);
      if (record.type === 'OUT') entry.out = luandaTime(record.timestamp);
      byDay.set(day, entry);
    }
    return [...byDay.entries()].map(([date, entry]) => ({ date, ...entry, complete: Boolean(entry.in && entry.out) })).reverse();
  }

  async period(year: number, month: number) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.read');
    const period = await this.db.tx.attendancePeriod.findUnique({ where: { companyId_year_month: { companyId: actor.companyId, year, month } } });
    const pendingCorrections = await this.db.tx.attendanceCorrection.count({ where: { status: 'PENDING', date: { gte: monthRange(year, month).start, lte: monthRange(year, month).end } } });
    return { year, month, closedAt: period?.closedAt ?? null, summary: period?.summary ?? null, pendingCorrections };
  }

  async corrections(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const actor = this.actors.current;
    if (!can(actor, 'attendance.read') && !can(actor, 'team.read')) throw new ForbiddenError();
    const rows = await this.db.tx.attendanceCorrection.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 300 });
    const employees = await this.db.tx.employee.findMany({ where: { id: { in: rows.map((row) => row.employeeId) } }, select: { id: true, fullName: true } });
    const names = new Map(employees.map((employee) => [employee.id, employee.fullName]));
    return rows.map((row) => ({ ...row, date: isoDate(row.date), employee: { id: row.employeeId, name: names.get(row.employeeId) ?? null } }));
  }
}

@Injectable()
export class RequestCorrectionUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly support: TimeSupport,
    private readonly approvals: Approvals,
  ) {}

  async execute(input: { employeeId?: string; date: string; type: PunchType; time: string; reason: string }) {
    const actor = this.actors.current;
    const employee = await this.support.resolveEmployee(actor, input.employeeId, 'attendance.write');
    const correction = await this.db.tx.attendanceCorrection.create({ data: { tenantId: actor.tenantId, employeeId: employee.id, date: toDate(input.date), type: input.type, time: input.time, reason: input.reason } });
    await this.approvals.start({
      type: 'ATTENDANCE_CORRECTION',
      subjectId: correction.id,
      title: `Correcção de ponto — ${input.type === 'IN' ? 'entrada' : 'saída'} às ${input.time} em ${input.date}`,
      detail: input.reason,
      requesterUserId: actor.userId,
      beneficiary: { employeeId: employee.id, name: employee.name, managerId: employee.managerId },
    });
    return { id: correction.id, status: correction.status };
  }
}

@Injectable()
export class CorrectionOutcomeHandler implements OnModuleInit {
  constructor(
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly db: Database,
  ) {}

  onModuleInit() {
    this.registry.register('ATTENDANCE_CORRECTION', async ({ subjectId, decision }) => {
      const correction = await this.db.tx.attendanceCorrection.update({ where: { id: subjectId }, data: { status: decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'RETURNED' } });
      if (decision === 'APPROVED') {
        await this.db.tx.attendanceRecord.create({
          data: { tenantId: correction.tenantId, employeeId: correction.employeeId, timestamp: new Date(`${isoDate(correction.date)}T${correction.time}:00+01:00`), type: correction.type, source: 'MANUAL', idempotencyKey: `correction:${correction.id}` },
        });
      }
    });
  }
}

@Injectable()
export class CloseAttendancePeriodUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  /** Freezes the month's attendance; absences and overtime then flow into the payroll (docs/04, 4.8). */
  async execute(year: number, month: number) {
    const actor = this.actors.current;
    authorize(actor, 'attendance.write');
    const existing = await this.db.tx.attendancePeriod.findUnique({ where: { companyId_year_month: { companyId: actor.companyId, year, month } } });
    if (existing?.closedAt) throw new BusinessRuleViolation('O período já está fechado', 'period_closed');
    const pending = await this.db.tx.attendanceCorrection.count({ where: { status: 'PENDING', date: { gte: monthRange(year, month).start, lte: monthRange(year, month).end } } });
    if (pending > 0) throw new BusinessRuleViolation(`Existem ${pending} correcções de ponto por decidir`, 'pending_corrections');

    const { start, end } = monthRange(year, month);
    const [leave, overtime] = await Promise.all([
      this.db.tx.leaveRequest.groupBy({ by: ['type'], where: { status: 'APPROVED', startDate: { lte: end }, endDate: { gte: start } }, _sum: { days: true } }),
      this.db.tx.overtimeRequest.aggregate({ where: { status: 'APPROVED', date: { gte: start, lte: end } }, _sum: { minutes: true } }),
    ]);
    const summary = { leaveDays: Object.fromEntries(leave.map((row) => [row.type, row._sum.days ?? 0])), overtimeHours: (overtime._sum.minutes ?? 0) / 60 } as Prisma.InputJsonValue;
    const period = await this.db.tx.attendancePeriod.upsert({
      where: { companyId_year_month: { companyId: actor.companyId, year, month } },
      create: { tenantId: actor.tenantId, companyId: actor.companyId, year, month, closedAt: new Date(), closedBy: actor.userId, summary },
      update: { closedAt: new Date(), closedBy: actor.userId, summary },
    });
    await this.audit.record({ action: 'attendance_period.close', entityType: 'attendance_period', entityId: period.id, after: { year, month } });
    return { year, month, closedAt: period.closedAt, summary };
  }
}

