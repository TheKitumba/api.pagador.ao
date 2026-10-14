import { randomUUID } from 'node:crypto';

import { Injectable, OnModuleInit } from '@nestjs/common';
import type { ExpenseCategory, LoanType, RequestStatus } from '@prisma/client';

import { ApprovalOutcomeRegistry, Approvals } from '@/contexts/approvals/public';
import { EmployeeDirectory } from '@/contexts/workforce/public';
import { authorize, can } from '@/shared/application/permissions';
import { FileStorage } from '@/shared/application/ports';
import { ForbiddenError, NotFoundError, ValidationError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate, toDate } from '@/shared/application/formatting';

const LOAN_LABEL: Record<LoanType, string> = { ADVANCE: 'Adiantamento salarial', LOAN: 'Empréstimo', GARNISHMENT: 'Penhora judicial' };
const EXPENSE_LABEL: Record<ExpenseCategory, string> = { TRAVEL: 'Deslocação', PER_DIEM: 'Ajudas de custo', FUEL: 'Combustível', MATERIAL: 'Material', REPRESENTATION: 'Representação', OTHER: 'Outra' };

async function resolveBeneficiary(directory: EmployeeDirectory, actorEmployeeId: string | null, employeeId: string | undefined, canForOthers: boolean, companyId: string) {
  const targetId = employeeId ?? actorEmployeeId;
  if (!targetId) throw new ForbiddenError('A sua conta não está ligada a um trabalhador', 'no_employee_link');
  if (targetId !== actorEmployeeId && !canForOthers) throw new ForbiddenError('Só pode fazer pedidos em seu nome', 'missing_permission');
  const employee = await directory.get(targetId);
  if (employee.companyId !== companyId) throw new NotFoundError('Trabalhador', targetId);
  return employee;
}

@Injectable()
export class LoansService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly directory: EmployeeDirectory,
    private readonly approvals: Approvals,
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    const apply = async ({ subjectId, decision }: { subjectId: string; decision: string }) => {
      await this.db.tx.loan.update({ where: { id: subjectId }, data: { status: decision === 'APPROVED' ? 'ACTIVE' : 'REJECTED' } });
    };
    this.registry.register('ADVANCE', apply);
    this.registry.register('LOAN', apply);
  }

  async list() {
    const actor = this.actors.current;
    const mine = !can(actor, 'compensation.read');
    if (mine && !actor.employeeId) throw new ForbiddenError();
    const loans = await this.db.tx.loan.findMany({ where: mine ? { employeeId: actor.employeeId! } : {}, orderBy: { createdAt: 'desc' } });
    const names = await this.directory.names(loans.map((loan) => loan.employeeId));
    return loans.map((loan) => ({
      id: loan.id,
      employee: { id: loan.employeeId, name: names.get(loan.employeeId) ?? null },
      type: loan.type,
      typeLabel: LOAN_LABEL[loan.type],
      principal: decimal(loan.principal),
      installments: loan.installments,
      installmentValue: decimal(loan.installmentValue),
      paidInstallments: loan.paidInstallments,
      balance: decimal(loan.balance),
      firstMonth: isoDate(loan.firstMonth),
      status: loan.status,
      notes: loan.notes,
    }));
  }

  /** Advances and loans go through approval; a court garnishment is registered directly. */
  async create(input: { employeeId?: string; type: LoanType; principal: number | string; installments: number; firstMonth: string; notes?: string }) {
    const actor = this.actors.current;
    const employee = await resolveBeneficiary(this.directory, actor.employeeId, input.employeeId, can(actor, 'compensation.write'), actor.companyId);
    if (input.type === 'GARNISHMENT') authorize(actor, 'compensation.write');
    const principal = Money.of(input.principal);
    if (!principal.greaterThan(0)) throw new ValidationError('Montante inválido', { principal: ['Tem de ser superior a zero'] });
    const installment = principal.divide(input.installments).round();

    const loan = await this.db.tx.loan.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: employee.id,
        type: input.type,
        principal: principal.toString(),
        installments: input.installments,
        installmentValue: installment.toString(),
        balance: principal.toString(),
        firstMonth: toDate(input.firstMonth),
        notes: input.notes,
        status: input.type === 'GARNISHMENT' ? 'ACTIVE' : 'PENDING',
      },
    });
    if (input.type !== 'GARNISHMENT') {
      await this.approvals.start({
        type: input.type === 'ADVANCE' ? 'ADVANCE' : 'LOAN',
        subjectId: loan.id,
        title: `${LOAN_LABEL[input.type]} de ${principal.toString()} Kz`,
        detail: `${input.installments} prestação(ões) de ${installment.toString()} Kz a partir de ${input.firstMonth}`,
        requesterUserId: actor.userId,
        beneficiary: { employeeId: employee.id, name: employee.name, managerId: employee.managerId },
      });
    }
    await this.audit.record({ action: 'loan.create', entityType: 'loan', entityId: loan.id, after: { employee: employee.name, type: input.type, principal: principal.toString() } });
    return { id: loan.id, status: loan.status, installmentValue: installment.toString() };
  }
}

@Injectable()
export class ExpensesService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly directory: EmployeeDirectory,
    private readonly approvals: Approvals,
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.registry.register('EXPENSE', async ({ subjectId, decision }) => {
      await this.db.tx.expenseClaim.update({ where: { id: subjectId }, data: { status: decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : 'RETURNED' } });
    });
  }

  async list(status?: RequestStatus) {
    const actor = this.actors.current;
    const mine = !can(actor, 'compensation.read');
    if (mine && !actor.employeeId) throw new ForbiddenError();
    const claims = await this.db.tx.expenseClaim.findMany({ where: { ...(mine ? { employeeId: actor.employeeId! } : {}), ...(status ? { status } : {}) }, orderBy: { date: 'desc' } });
    const names = await this.directory.names(claims.map((claim) => claim.employeeId));
    return claims.map((claim) => ({
      id: claim.id,
      employee: { id: claim.employeeId, name: names.get(claim.employeeId) ?? null },
      category: claim.category,
      categoryLabel: EXPENSE_LABEL[claim.category],
      description: claim.description,
      amount: decimal(claim.amount),
      date: isoDate(claim.date),
      hasReceipt: Boolean(claim.receiptKey),
      status: claim.status,
      paidInRunId: claim.paidInRunId,
    }));
  }

  /** Approved claims are paid with the next payroll (pay item R051, not taxed). */
  async create(input: { employeeId?: string; category: ExpenseCategory; description: string; amount: number | string; date: string }, receipt?: { buffer: Buffer; mimetype: string; originalname: string }) {
    const actor = this.actors.current;
    const employee = await resolveBeneficiary(this.directory, actor.employeeId, input.employeeId, can(actor, 'compensation.write'), actor.companyId);
    let receiptKey: string | undefined;
    if (receipt) {
      receiptKey = `${actor.tenantId}/expenses/${randomUUID()}-${receipt.originalname.replace(/[^\w.-]+/g, '_')}`;
      await this.storage.put(receiptKey, receipt.buffer, receipt.mimetype);
    }
    const amount = Money.of(input.amount);
    const claim = await this.db.tx.expenseClaim.create({ data: { tenantId: actor.tenantId, employeeId: employee.id, category: input.category, description: input.description, amount: amount.toString(), date: toDate(input.date), receiptKey } });
    await this.approvals.start({
      type: 'EXPENSE',
      subjectId: claim.id,
      title: `Reembolso de ${amount.toString()} Kz — ${EXPENSE_LABEL[input.category]}`,
      detail: `${input.description}${receiptKey ? ' · comprovativo anexado' : ' · sem comprovativo'}`,
      requesterUserId: actor.userId,
      beneficiary: { employeeId: employee.id, name: employee.name, managerId: employee.managerId },
    });
    await this.audit.record({ action: 'expense.create', entityType: 'expense_claim', entityId: claim.id, after: { amount: amount.toString(), category: input.category } });
    return { id: claim.id, status: claim.status };
  }

  async receipt(id: string) {
    const actor = this.actors.current;
    const claim = await this.db.tx.expenseClaim.findUnique({ where: { id } });
    if (!claim?.receiptKey) throw new NotFoundError('Comprovativo', id);
    if (claim.employeeId !== actor.employeeId) authorize(actor, 'compensation.read');
    return { ...(await this.storage.get(claim.receiptKey)), fileName: claim.receiptKey.split('/').pop() ?? 'comprovativo' };
  }
}

@Injectable()
export class BenefitsService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  /** Benefits are pay items (allowances, benefits, insurance) assigned to contracts. */
  async list() {
    const actor = this.actors.current;
    authorize(actor, 'compensation.read');
    const items = await this.db.tx.payItem.findMany({ where: { companyId: actor.companyId, archivedAt: null, category: { in: ['ALLOWANCE', 'BENEFIT', 'INSURANCE'] } }, orderBy: { code: 'asc' } });
    const counts = await this.db.tx.contractPayItem.groupBy({ by: ['payItemId'], where: { payItemId: { in: items.map((item) => item.id) }, contract: { status: 'ACTIVE' } }, _count: true });
    const byItem = new Map(counts.map((row) => [row.payItemId, row._count]));
    return items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      category: item.category,
      irtSubject: item.irtSubject,
      irtExemptionLimit: decimal(item.irtExemptionLimit),
      ssSubject: item.ssSubject,
      employees: byItem.get(item.id) ?? 0,
    }));
  }

  async assign(payItemId: string, input: { employeeIds: string[]; amount: number | string }) {
    const actor = this.actors.current;
    authorize(actor, 'compensation.write');
    const item = await this.db.tx.payItem.findFirst({ where: { id: payItemId, companyId: actor.companyId } });
    if (!item) throw new NotFoundError('Rubrica', payItemId);
    const contracts = await this.db.tx.employmentContract.findMany({ where: { employeeId: { in: input.employeeIds }, status: 'ACTIVE' }, select: { id: true } });
    const amount = Money.of(input.amount).toString();
    for (const contract of contracts) {
      await this.db.tx.contractPayItem.upsert({
        where: { contractId_payItemId: { contractId: contract.id, payItemId } },
        create: { tenantId: actor.tenantId, contractId: contract.id, payItemId, amount },
        update: { amount },
      });
    }
    await this.audit.record({ action: 'benefit.assign', entityType: 'pay_item', entityId: payItemId, after: { contracts: contracts.length, amount } });
    return { assigned: contracts.length };
  }

  async unassign(payItemId: string, employeeId: string) {
    const actor = this.actors.current;
    authorize(actor, 'compensation.write');
    await this.db.tx.contractPayItem.deleteMany({ where: { payItemId, contract: { employeeId, status: 'ACTIVE' } } });
    await this.audit.record({ action: 'benefit.unassign', entityType: 'pay_item', entityId: payItemId, after: { employeeId } });
  }
}
