import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Prisma, TerminationReason } from '@prisma/client';

import { ApprovalOutcomeRegistry, Approvals } from '@/contexts/approvals/public';
import { LoanBalances } from '@/contexts/payroll/public';
import { LeaveBalances } from '@/contexts/time/public';
import { authorize } from '@/shared/application/permissions';
import { BusinessRuleViolation, NotFoundError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate, toDate } from '@/shared/application/formatting';

import { calculateFinalSettlement } from '../domain/final-settlement';

export const TERMINATION_REASON_LABEL: Record<TerminationReason, string> = {
  CONTRACT_EXPIRY: 'Caducidade do contrato a termo',
  EMPLOYEE_RESIGNATION: 'Rescisão por iniciativa do trabalhador',
  DISCIPLINARY_DISMISSAL: 'Despedimento por justa causa',
  OBJECTIVE_DISMISSAL: 'Despedimento por causas objectivas',
  MUTUAL_AGREEMENT: 'Acordo entre as partes',
  RETIREMENT: 'Reforma',
  DEATH: 'Morte do trabalhador',
};

@Injectable()
export class StartTerminationUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly leave: LeaveBalances,
    private readonly loans: LoanBalances,
    private readonly approvals: Approvals,
    private readonly audit: AuditService,
  ) {}

  /** Computes the final settlement and sends the termination for approval (HR manager → board). */
  async execute(input: { employeeId: string; reason: TerminationReason; noticeDate: string; lastDay: string; notes?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.write');
    const employee = await this.db.tx.employee.findFirst({
      where: { id: input.employeeId, companyId: actor.companyId },
      include: { contracts: { where: { status: 'ACTIVE' }, take: 1 } },
    });
    if (!employee) throw new NotFoundError('Trabalhador', input.employeeId);
    if (employee.status === 'TERMINATED') throw new BusinessRuleViolation('O trabalhador já está cessado', 'already_terminated');
    const contract = employee.contracts[0];
    if (!contract) throw new BusinessRuleViolation('O trabalhador não tem contrato vigente', 'no_active_contract');

    const lastDay = toDate(input.lastDay);
    const settlement = calculateFinalSettlement({
      reason: input.reason,
      baseSalary: contract.baseSalary.toString(),
      hireDate: employee.hireDate,
      noticeDate: toDate(input.noticeDate),
      lastDay,
      unusedVacationDays: await this.leave.remainingDays(employee.id, lastDay.getUTCFullYear()),
      outstandingLoans: await this.loans.outstanding(employee.id),
    });

    const termination = await this.db.tx.termination.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: employee.id,
        reason: input.reason,
        noticeDate: toDate(input.noticeDate),
        lastDay,
        settlement: settlement as unknown as Prisma.InputJsonValue,
        settlementTotal: settlement.total,
        notes: input.notes,
        createdBy: actor.userId,
      },
    });
    await this.approvals.start({
      type: 'TERMINATION',
      subjectId: termination.id,
      title: `Cessação de ${employee.fullName}`,
      detail: `${TERMINATION_REASON_LABEL[input.reason]} · último dia ${input.lastDay} · acerto ${settlement.total} Kz`,
      requesterUserId: actor.userId,
      beneficiary: { employeeId: employee.id, name: employee.fullName, managerId: employee.managerId },
    });
    await this.audit.record({ action: 'termination.start', entityType: 'termination', entityId: termination.id, after: { employee: employee.fullName, reason: input.reason, total: settlement.total } });
    return { id: termination.id, settlement };
  }
}

/** Applies the approved termination: contract and employee are closed (event `employee.terminated`). */
@Injectable()
export class TerminationOutcomeHandler implements OnModuleInit {
  constructor(
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.registry.register('TERMINATION', async ({ subjectId, decision }) => {
      const termination = await this.db.tx.termination.findUniqueOrThrow({ where: { id: subjectId } });
      if (decision !== 'APPROVED') {
        await this.db.tx.termination.update({ where: { id: subjectId }, data: { status: decision === 'REJECTED' ? 'CANCELLED' : 'DRAFT' } });
        return;
      }
      await this.db.tx.termination.update({ where: { id: subjectId }, data: { status: 'APPROVED' } });
      await this.db.tx.employmentContract.updateMany({ where: { employeeId: termination.employeeId, status: 'ACTIVE' }, data: { status: 'TERMINATED', terminationDate: termination.lastDay } });
      await this.db.tx.employee.update({ where: { id: termination.employeeId }, data: { status: 'TERMINATED' } });
      await this.outbox.publish('employee.terminated', { employeeId: termination.employeeId, lastDay: isoDate(termination.lastDay) });
    });
  }
}

@Injectable()
export class TerminationQueries {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  async list() {
    const actor = this.actors.current;
    authorize(actor, 'contracts.read');
    const rows = await this.db.tx.termination.findMany({ orderBy: { createdAt: 'desc' } });
    const employees = await this.db.tx.employee.findMany({ where: { id: { in: rows.map((row) => row.employeeId) } }, select: { id: true, fullName: true } });
    const names = new Map(employees.map((employee) => [employee.id, employee.fullName]));
    return rows.map((row) => ({
      id: row.id,
      employee: { id: row.employeeId, name: names.get(row.employeeId) ?? null },
      reason: row.reason,
      reasonLabel: TERMINATION_REASON_LABEL[row.reason],
      noticeDate: isoDate(row.noticeDate),
      lastDay: isoDate(row.lastDay),
      settlementTotal: decimal(row.settlementTotal),
      status: row.status,
    }));
  }

  async get(id: string) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.read');
    const row = await this.db.tx.termination.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Cessação', id);
    return { ...row, noticeDate: isoDate(row.noticeDate), lastDay: isoDate(row.lastDay), settlementTotal: decimal(row.settlementTotal), reasonLabel: TERMINATION_REASON_LABEL[row.reason] };
  }
}

/** "Não renovar": a contract expiry termination on the contract end date. */
@Injectable()
export class NotRenewContractUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly start: StartTerminationUseCase,
  ) {}

  async execute(contractId: string, input: { reason: string; noticeDate?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.write');
    const contract = await this.db.tx.employmentContract.findFirst({ where: { id: contractId, status: 'ACTIVE', employee: { companyId: actor.companyId } } });
    if (!contract) throw new NotFoundError('Contrato', contractId);
    if (!contract.endDate) throw new BusinessRuleViolation('Contratos sem termo não caducam', 'no_end_date');
    return this.start.execute({
      employeeId: contract.employeeId,
      reason: 'CONTRACT_EXPIRY',
      noticeDate: input.noticeDate ?? new Date().toISOString().slice(0, 10),
      lastDay: isoDate(contract.endDate)!,
      notes: input.reason,
    });
  }
}
