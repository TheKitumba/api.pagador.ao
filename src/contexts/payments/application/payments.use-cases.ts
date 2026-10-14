import { Injectable, OnModuleInit } from '@nestjs/common';

import { ApprovalOutcomeRegistry, Approvals } from '@/contexts/approvals/public';
import { PayrollRunsFacade } from '@/contexts/payroll/public';
import { EmployeeDirectory } from '@/contexts/workforce/public';
import { authorize } from '@/shared/application/permissions';
import { BusinessRuleViolation, NotFoundError } from '@/shared/domain/errors';
import { Decimal } from '@/shared/domain/money';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate } from '@/shared/application/formatting';

import { formatFor } from '../infrastructure/bank-file-formats';

const IBAN_CHANGE_WINDOW_DAYS = 5;

@Injectable()
export class GeneratePaymentBatchesUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly payroll: PayrollRunsFacade,
    private readonly employees: EmployeeDirectory,
    private readonly approvals: Approvals,
    private readonly audit: AuditService,
  ) {}

  /** One batch per bank for an approved payroll run (docs/03, M08). */
  async execute(runId: string) {
    const actor = this.actors.current;
    authorize(actor, 'payments.prepare');
    const { run, slips } = await this.payroll.payable(runId);
    if (run.status !== 'APPROVED') throw new BusinessRuleViolation('Só folhas aprovadas podem gerar lotes de pagamento', 'run_not_approved');
    const existing = await this.db.tx.paymentBatch.count({ where: { runId } });
    if (existing > 0) throw new BusinessRuleViolation('Os lotes desta folha já foram gerados', 'batches_exist');

    const payable = slips.filter((slip) => new Decimal(slip.net).greaterThan(0));
    const withoutAccount = payable.filter((slip) => !slip.iban || !slip.bankCode);
    const byBank = new Map<string, typeof payable>();
    for (const slip of payable.filter((s) => s.iban && s.bankCode)) byBank.set(slip.bankCode!, [...(byBank.get(slip.bankCode!) ?? []), slip]);

    const period = `${run.year}-${String(run.month).padStart(2, '0')}`;
    const banks = await this.db.tx.bank.findMany({ where: { code: { in: [...byBank.keys()] } } });
    const paymentDay = await this.db.tx.payrollPeriod.findFirst({ where: { companyId: run.companyId, year: run.year, month: run.month } });
    const recentChanges = paymentDay ? await this.employees.recentIbanChanges(run.companyId, new Date(paymentDay.paymentDate.getTime() - IBAN_CHANGE_WINDOW_DAYS * 86_400_000)) : [];

    const created = [];
    for (const [bankCode, bankSlips] of byBank) {
      const total = bankSlips.reduce((sum, slip) => sum.plus(slip.net), new Decimal(0));
      const batch = await this.db.tx.paymentBatch.create({
        data: {
          tenantId: actor.tenantId,
          runId,
          bankCode,
          fileFormat: banks.find((bank) => bank.code === bankCode)?.fileFormat ?? 'CSV',
          reference: `LOT-${period}-${bankCode}`,
          totalAmount: total.toFixed(2),
          preparedBy: actor.userId,
          instructions: { create: bankSlips.map((slip) => ({ tenantId: actor.tenantId, payslipId: slip.payslipId, employeeName: slip.employeeName, iban: slip.iban!, amount: slip.net })) },
        },
      });
      const ibanAlerts = recentChanges.filter((change) => bankSlips.some((slip) => slip.employeeId === change.employeeId));
      await this.approvals.start({
        type: 'PAYMENT_BATCH',
        subjectId: batch.id,
        title: `Aprovar lote ${batch.reference}`,
        detail: `${bankSlips.length} transferências · ${total.toFixed(2)} Kz${ibanAlerts.length ? ` · ATENÇÃO: IBAN alterado nos últimos ${IBAN_CHANGE_WINDOW_DAYS} dias (${ibanAlerts.map((a) => a.name).join(', ')})` : ''}`,
        requesterUserId: actor.userId,
        // Segregation of duties: who prepares the batch cannot approve it (docs/05, 5.4 rule 2).
        excludedUserIds: [actor.userId],
      });
      created.push({ id: batch.id, reference: batch.reference, bankCode, instructions: bankSlips.length, totalAmount: total.toFixed(2), ibanChanges: ibanAlerts.map((a) => a.name) });
    }
    await this.audit.record({ action: 'payment_batches.generate', entityType: 'payroll_run', entityId: runId, after: { batches: created.length } });
    return { batches: created, withoutBankAccount: withoutAccount.map((slip) => ({ employeeId: slip.employeeId, name: slip.employeeName, net: slip.net })) };
  }
}

@Injectable()
export class PaymentBatchOutcomeHandler implements OnModuleInit {
  constructor(
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.registry.register('PAYMENT_BATCH', async ({ subjectId, decision, actor }) => {
      if (decision === 'APPROVED') {
        await this.db.tx.paymentBatch.update({ where: { id: subjectId }, data: { status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date() } });
        await this.outbox.publish('payment_batch.approved', { batchId: subjectId });
      } else {
        await this.db.tx.paymentBatch.update({ where: { id: subjectId }, data: { status: 'DRAFT' } });
      }
    });
  }
}

@Injectable()
export class PaymentBatchesService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly payroll: PayrollRunsFacade,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(runId?: string) {
    authorize(this.actors.current, 'payments.read');
    const batches = await this.db.tx.paymentBatch.findMany({ where: runId ? { runId } : {}, orderBy: { createdAt: 'desc' }, include: { _count: { select: { instructions: true } } } });
    return batches.map((batch) => ({
      id: batch.id,
      reference: batch.reference,
      runId: batch.runId,
      bankCode: batch.bankCode,
      fileFormat: batch.fileFormat,
      instructions: batch._count.instructions,
      totalAmount: decimal(batch.totalAmount),
      status: batch.status,
      approvedAt: batch.approvedAt,
      createdAt: batch.createdAt,
    }));
  }

  async get(id: string) {
    authorize(this.actors.current, 'payments.read');
    const batch = await this.db.tx.paymentBatch.findUnique({ where: { id }, include: { instructions: { orderBy: { employeeName: 'asc' } } } });
    if (!batch) throw new NotFoundError('Lote de pagamento', id);
    return { ...batch, totalAmount: decimal(batch.totalAmount), instructions: batch.instructions.map((item) => ({ ...item, amount: decimal(item.amount), iban: `${item.iban.slice(0, 4)} •••• ${item.iban.slice(-4)}` })) };
  }

  /** Bank file. Before approval it is a preview; after approval, downloading marks the batch as sent. */
  async file(id: string) {
    const actor = this.actors.current;
    authorize(actor, 'payments.prepare');
    const batch = await this.db.tx.paymentBatch.findUnique({ where: { id }, include: { instructions: true } });
    if (!batch) throw new NotFoundError('Lote de pagamento', id);
    const company = await this.db.tx.company.findUniqueOrThrow({ where: { id: actor.companyId } });
    const period = await this.db.tx.payrollRun.findUniqueOrThrow({ where: { id: batch.runId }, include: { period: true } });
    const format = formatFor(batch.fileFormat);
    const content = format.render({
      reference: batch.reference,
      company: { name: company.legalName, nif: company.nif },
      paymentDate: isoDate(period.period.paymentDate)!,
      instructions: batch.instructions.map((item) => ({ employeeName: item.employeeName, iban: item.iban, amount: item.amount.toFixed(2), reference: batch.reference })),
    });
    if (batch.status === 'APPROVED') {
      await this.db.tx.paymentBatch.update({ where: { id }, data: { status: 'SENT' } });
      await this.db.tx.paymentInstruction.updateMany({ where: { batchId: id }, data: { status: 'SENT' } });
      await this.audit.record({ action: 'payment_batch.download', entityType: 'payment_batch', entityId: id });
    }
    const preview = batch.status === 'PENDING_APPROVAL' || batch.status === 'DRAFT';
    return { content, fileName: `${batch.reference}${preview ? '-PREVIEW' : ''}.${format.extension}`, contentType: format.contentType };
  }

  /** Bank confirmation: everything paid except the listed rejections (docs/03, M08 reconciliation). */
  async reconcile(id: string, rejections: { instructionId: string; reason: string }[]) {
    const actor = this.actors.current;
    authorize(actor, 'payments.prepare');
    const batch = await this.db.tx.paymentBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundError('Lote de pagamento', id);
    if (!['SENT', 'APPROVED'].includes(batch.status)) throw new BusinessRuleViolation('Só lotes enviados podem ser reconciliados', 'batch_not_sent');

    await this.db.tx.paymentInstruction.updateMany({ where: { batchId: id }, data: { status: 'PAID' } });
    for (const rejection of rejections) {
      await this.db.tx.paymentInstruction.updateMany({ where: { id: rejection.instructionId, batchId: id }, data: { status: 'REJECTED', rejectionReason: rejection.reason } });
    }
    const status = rejections.length ? 'PARTIALLY_REJECTED' : 'RECONCILED';
    await this.db.tx.paymentBatch.update({ where: { id }, data: { status } });
    await this.audit.record({ action: 'payment_batch.reconcile', entityType: 'payment_batch', entityId: id, after: { rejections: rejections.length } });

    const pending = await this.db.tx.paymentBatch.count({ where: { runId: batch.runId, status: { notIn: ['RECONCILED', 'PARTIALLY_REJECTED'] } } });
    if (pending === 0) await this.payroll.markPaid(batch.runId);
    if (rejections.length === 0) await this.outbox.publish('payment_batch.paid', { batchId: id });
    return { id, status, runPaid: pending === 0 };
  }
}
