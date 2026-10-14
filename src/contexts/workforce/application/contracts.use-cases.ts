import { Injectable } from '@nestjs/common';
import type { ContractType, Prisma } from '@prisma/client';

import { authorize } from '@/shared/application/permissions';
import { BusinessRuleViolation, NotFoundError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate, toDate } from '@/shared/application/formatting';

import { addDays, MAX_FIXED_TERM_RENEWALS } from '../domain/employee';
import { employeeScope } from './employees.use-cases';

const FIXED_TERM: ContractType[] = ['FIXED_TERM', 'UNCERTAIN_TERM', 'TEMPORARY', 'INTERNSHIP'];

@Injectable()
export class ContractQueries {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  /** Contracts needing action: ending, probation ending, within `days` (docs/03, M04). */
  async alerts(days = 45) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.read');
    const today = new Date();
    const limit = addDays(today, days);
    const contracts = await this.db.tx.employmentContract.findMany({
      where: {
        status: 'ACTIVE',
        employee: employeeScope(actor),
        OR: [{ endDate: { gte: today, lte: limit } }, { probationEndDate: { gte: today, lte: limit } }],
      },
      include: { employee: { select: { id: true, fullName: true, employeeNumber: true } } },
    });
    return contracts
      .map((contract) => {
        const probation = contract.probationEndDate && contract.probationEndDate >= today && contract.probationEndDate <= limit;
        const date = (probation ? contract.probationEndDate : contract.endDate)!;
        return {
          contractId: contract.id,
          type: probation ? ('probation' as const) : ('ending' as const),
          employee: { id: contract.employee.id, name: contract.employee.fullName, number: contract.employee.employeeNumber },
          contractType: contract.contractType,
          date: isoDate(date),
          daysLeft: Math.ceil((date.getTime() - today.getTime()) / 86_400_000),
          renewalsCount: contract.renewalsCount,
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  async summary() {
    const actor = this.actors.current;
    authorize(actor, 'contracts.read');
    const active = await this.db.tx.employmentContract.groupBy({ by: ['contractType'], where: { status: 'ACTIVE', employee: { companyId: actor.companyId } }, _count: true });
    return active.map((row) => ({ contractType: row.contractType, count: row._count }));
  }

  async forEmployee(employeeId: string) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.read');
    const contracts = await this.db.tx.employmentContract.findMany({ where: { employeeId, employee: employeeScope(actor) }, orderBy: { startDate: 'desc' } });
    return contracts.map((contract) => ({
      ...contract,
      startDate: isoDate(contract.startDate),
      endDate: isoDate(contract.endDate),
      probationEndDate: isoDate(contract.probationEndDate),
      terminationDate: isoDate(contract.terminationDate),
      baseSalary: actor.permissions.has('employees.sensitive') ? decimal(contract.baseSalary) : null,
    }));
  }
}

@Injectable()
export class CreateContractUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  /** New contract (or amendment): ends the current one the day before. */
  async execute(employeeId: string, input: { contractType: ContractType; startDate: string; endDate?: string; baseSalary: number | string; weeklyHours?: number; positionId?: string; probationDays?: number; notes?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.write');
    const employee = await this.db.tx.employee.findFirst({ where: { id: employeeId, companyId: actor.companyId } });
    if (!employee) throw new NotFoundError('Trabalhador', employeeId);
    if (FIXED_TERM.includes(input.contractType) && !input.endDate) throw new BusinessRuleViolation('Contratos a termo exigem data de fim', 'end_date_required');

    const start = toDate(input.startDate);
    const salary = Money.of(input.baseSalary);
    await this.db.tx.employmentContract.updateMany({ where: { employeeId, status: 'ACTIVE' }, data: { status: 'ENDED', endDate: addDays(start, -1) } });
    const probationDays = input.probationDays ?? 0;
    const contract = await this.db.tx.employmentContract.create({
      data: {
        tenantId: actor.tenantId,
        employeeId,
        contractType: input.contractType,
        startDate: start,
        endDate: input.endDate ? toDate(input.endDate) : null,
        probationEndDate: probationDays ? addDays(start, probationDays) : null,
        baseSalary: salary.toString(),
        weeklyHours: input.weeklyHours ?? 44,
        positionId: input.positionId ?? employee.positionId,
        notes: input.notes,
      },
    });
    await this.audit.record({ action: 'contract.create', entityType: 'contract', entityId: contract.id, after: { employeeId, type: input.contractType, baseSalary: salary.toString() }, sensitive: true });
    return { id: contract.id };
  }
}

@Injectable()
export class RenewContractUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /** Renews a fixed-term contract; beyond the renewal limit it converts to indefinite (docs/02, 2.2.1). */
  async execute(contractId: string, input: { endDate: string; baseSalary?: number | string; notes?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.write');
    const contract = await this.db.tx.employmentContract.findFirst({ where: { id: contractId, status: 'ACTIVE', employee: { companyId: actor.companyId } } });
    if (!contract) throw new NotFoundError('Contrato', contractId);
    if (!FIXED_TERM.includes(contract.contractType)) throw new BusinessRuleViolation('Só contratos a termo podem ser renovados', 'not_fixed_term');

    const converts = contract.renewalsCount + 1 > MAX_FIXED_TERM_RENEWALS;
    const data: Prisma.EmploymentContractUpdateInput = converts
      ? { contractType: 'INDEFINITE', endDate: null, renewalsCount: { increment: 1 } }
      : { endDate: toDate(input.endDate), renewalsCount: { increment: 1 } };
    if (input.baseSalary !== undefined) data.baseSalary = Money.of(input.baseSalary).toString();
    if (input.notes) data.notes = input.notes;

    const updated = await this.db.tx.employmentContract.update({ where: { id: contractId }, data });
    await this.outbox.publish('contract.renewed', { contractId, employeeId: contract.employeeId, convertedToIndefinite: converts });
    await this.audit.record({ action: converts ? 'contract.converted_to_indefinite' : 'contract.renew', entityType: 'contract', entityId: contractId, before: { endDate: contract.endDate }, after: { endDate: updated.endDate, type: updated.contractType } });
    return { id: contractId, contractType: updated.contractType, endDate: isoDate(updated.endDate), renewalsCount: updated.renewalsCount, convertedToIndefinite: converts };
  }
}

@Injectable()
export class ConfirmProbationUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async execute(contractId: string, input: { rating?: string; notes?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'contracts.approve');
    const contract = await this.db.tx.employmentContract.findFirst({ where: { id: contractId, status: 'ACTIVE', employee: { companyId: actor.companyId } } });
    if (!contract?.probationEndDate) throw new NotFoundError('Contrato em período experimental', contractId);
    await this.db.tx.employmentContract.update({ where: { id: contractId }, data: { probationEndDate: new Date() } });
    await this.db.tx.employee.update({ where: { id: contract.employeeId }, data: { status: 'ACTIVE' } });
    await this.audit.record({ action: 'contract.probation_confirmed', entityType: 'contract', entityId: contractId, after: input });
    return { id: contractId, status: 'ACTIVE' };
  }
}

