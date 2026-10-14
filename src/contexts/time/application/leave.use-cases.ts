import { Injectable, OnModuleInit } from '@nestjs/common';
import type { LeaveType, Prisma, RequestStatus } from '@prisma/client';

import { ApprovalOutcomeRegistry, Approvals } from '@/contexts/approvals/public';
import { authorize, can } from '@/shared/application/permissions';
import { BusinessRuleViolation, ForbiddenError, NotFoundError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate, toDate } from '@/shared/application/formatting';

import { countWorkingDays, LEAVE_RULES } from '../domain/calendar';
import { TimeSupport } from './time-support';

const STATUS_FROM_DECISION = { APPROVED: 'APPROVED', REJECTED: 'REJECTED', RETURNED: 'RETURNED' } as const;

@Injectable()
export class RequestLeaveUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly support: TimeSupport,
    private readonly approvals: Approvals,
    private readonly audit: AuditService,
  ) {}

  async execute(input: { employeeId?: string; type: LeaveType; startDate: string; endDate: string; reason?: string; documentId?: string }) {
    const actor = this.actors.current;
    const employee = await this.support.resolveEmployee(actor, input.employeeId, 'leave.write');
    const start = toDate(input.startDate);
    const end = toDate(input.endDate);
    const days = countWorkingDays(start, end, await this.support.holidays(start.getUTCFullYear()));
    if (days === 0) throw new BusinessRuleViolation('O período não tem dias úteis', 'no_working_days');

    const overlap = await this.db.tx.leaveRequest.findFirst({ where: { employeeId: employee.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } } });
    if (overlap) throw new BusinessRuleViolation('Já existe uma ausência neste período', 'leave_overlap');

    const rules = LEAVE_RULES[input.type];
    if (rules.usesBalance) {
      const balance = await this.db.tx.leaveBalance.findUnique({ where: { employeeId_year: { employeeId: employee.id, year: start.getUTCFullYear() } } });
      const available = balance ? balance.entitledDays + balance.carriedOver - balance.taken - balance.scheduled : 0;
      if (days > available) throw new BusinessRuleViolation(`Saldo insuficiente: ${available} dias disponíveis, ${days} pedidos`, 'insufficient_balance');
    }

    const request = await this.db.tx.leaveRequest.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: employee.id,
        type: input.type,
        startDate: start,
        endDate: end,
        days,
        justified: rules.justified,
        paid: rules.paid,
        reason: input.reason,
        documentId: input.documentId,
        createdBy: actor.userId,
      },
    });
    await this.approvals.start({
      type: 'LEAVE',
      subjectId: request.id,
      title: `${rules.label}: ${input.startDate} a ${input.endDate} (${days} ${days === 1 ? 'dia útil' : 'dias úteis'})`,
      detail: input.reason,
      requesterUserId: actor.userId,
      beneficiary: { employeeId: employee.id, name: employee.name, managerId: employee.managerId },
    });
    await this.audit.record({ action: 'leave.request', entityType: 'leave_request', entityId: request.id, after: { employee: employee.name, type: input.type, days } });
    return { id: request.id, days, status: request.status };
  }
}

@Injectable()
export class LeaveOutcomeHandler implements OnModuleInit {
  constructor(
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.registry.register('LEAVE', async ({ subjectId, decision }) => {
      const request = await this.db.tx.leaveRequest.update({ where: { id: subjectId }, data: { status: STATUS_FROM_DECISION[decision] } });
      if (decision !== 'APPROVED') return;
      if (LEAVE_RULES[request.type].usesBalance) {
        const year = request.startDate.getUTCFullYear();
        const field = request.startDate > new Date() ? 'scheduled' : 'taken';
        await this.db.tx.leaveBalance.upsert({
          where: { employeeId_year: { employeeId: request.employeeId, year } },
          create: { tenantId: request.tenantId, employeeId: request.employeeId, year, [field]: request.days },
          update: { [field]: { increment: request.days } },
        });
      }
      await this.outbox.publish('leave.approved', { leaveRequestId: request.id, employeeId: request.employeeId, startDate: isoDate(request.startDate), endDate: isoDate(request.endDate) });
    });
  }
}

@Injectable()
export class CancelLeaveUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly approvals: Approvals,
    private readonly audit: AuditService,
  ) {}

  async execute(id: string) {
    const actor = this.actors.current;
    const request = await this.db.tx.leaveRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundError('Pedido de ausência', id);
    if (request.employeeId !== actor.employeeId && !can(actor, 'leave.write')) throw new ForbiddenError();
    if (!['PENDING', 'RETURNED'].includes(request.status)) throw new BusinessRuleViolation('Só pedidos pendentes podem ser cancelados', 'not_cancellable');
    await this.db.tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.approvals.cancel('LEAVE', id);
    await this.audit.record({ action: 'leave.cancel', entityType: 'leave_request', entityId: id });
  }
}

@Injectable()
export class LeaveQueries {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  private scope(): Prisma.EmployeeWhereInput {
    const actor = this.actors.current;
    if (can(actor, 'leave.read')) return { companyId: actor.companyId };
    if (can(actor, 'team.read') && actor.employeeId) return { companyId: actor.companyId, OR: [{ managerId: actor.employeeId }, { id: actor.employeeId }] };
    if (actor.employeeId) return { id: actor.employeeId };
    throw new ForbiddenError();
  }

  async requests(filter: { status?: RequestStatus; employeeId?: string; year?: number }) {
    const rows = await this.db.tx.leaveRequest.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
        ...(filter.year ? { startDate: { gte: new Date(Date.UTC(filter.year, 0, 1)), lt: new Date(Date.UTC(filter.year + 1, 0, 1)) } } : {}),
      },
      orderBy: { startDate: 'desc' },
      take: 500,
    });
    const employees = await this.db.tx.employee.findMany({ where: { id: { in: rows.map((row) => row.employeeId) }, ...this.scope() }, select: { id: true, fullName: true } });
    const names = new Map(employees.map((employee) => [employee.id, employee.fullName]));
    return rows
      .filter((row) => names.has(row.employeeId))
      .map((row) => ({
        id: row.id,
        employee: { id: row.employeeId, name: names.get(row.employeeId)! },
        type: row.type,
        typeLabel: LEAVE_RULES[row.type].label,
        startDate: isoDate(row.startDate),
        endDate: isoDate(row.endDate),
        days: row.days,
        paid: row.paid,
        justified: row.justified,
        reason: row.reason,
        status: row.status,
        createdAt: row.createdAt,
      }));
  }

  async balances(year: number) {
    const employees = await this.db.tx.employee.findMany({ where: { ...this.scope(), status: { not: 'TERMINATED' } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } });
    const balances = await this.db.tx.leaveBalance.findMany({ where: { year, employeeId: { in: employees.map((employee) => employee.id) } } });
    const byEmployee = new Map(balances.map((balance) => [balance.employeeId, balance]));
    return employees.map((employee) => {
      const balance = byEmployee.get(employee.id);
      const entitled = balance?.entitledDays ?? 22;
      const carried = balance?.carriedOver ?? 0;
      const taken = balance?.taken ?? 0;
      const scheduled = balance?.scheduled ?? 0;
      return { employee: { id: employee.id, name: employee.fullName }, year, entitled, carried, taken, scheduled, available: entitled + carried - taken - scheduled };
    });
  }

  /** Vacation map: approved leave per employee and month (docs/03, M06). */
  async map(year: number) {
    const requests = await this.requests({ status: 'APPROVED', year });
    const byEmployee = new Map<string, { employee: { id: string; name: string }; months: number[] }>();
    for (const request of requests.filter((item) => item.type === 'VACATION')) {
      const entry = byEmployee.get(request.employee.id) ?? { employee: request.employee, months: [] };
      for (let month = Number(request.startDate!.slice(5, 7)); month <= Number(request.endDate!.slice(5, 7)); month++) {
        if (!entry.months.includes(month)) entry.months.push(month);
      }
      byEmployee.set(request.employee.id, entry);
    }
    return [...byEmployee.values()];
  }
}

@Injectable()
export class AdjustLeaveBalanceUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async execute(employeeId: string, year: number, input: { entitledDays?: number; carriedOver?: number; taken?: number; scheduled?: number }) {
    const actor = this.actors.current;
    authorize(actor, 'leave.write');
    const before = await this.db.tx.leaveBalance.findUnique({ where: { employeeId_year: { employeeId, year } } });
    const balance = await this.db.tx.leaveBalance.upsert({
      where: { employeeId_year: { employeeId, year } },
      create: { tenantId: actor.tenantId, employeeId, year, ...input },
      update: input,
    });
    await this.audit.record({ action: 'leave_balance.adjust', entityType: 'employee', entityId: employeeId, before, after: balance });
    return balance;
  }
}
