import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { InvoiceStatus } from '@prisma/client';

import { authorize } from '@/shared/application/permissions';
import { FileStorage } from '@/shared/application/ports';
import { BusinessRuleViolation, NotFoundError } from '@/shared/domain/errors';
import { Money } from '@/shared/domain/money';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate, toDate } from '@/shared/application/formatting';

import type { UploadedFile } from './documents.service';

/** Contractor invoices (M23) with IRT Group B withholding at source (docs/02, 2.3.1). */
@Injectable()
export class ContractorInvoicesService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly storage: FileStorage,
    private readonly audit: AuditService,
  ) {}

  private async withholdingRate() {
    const table = await this.db.tx.legalTable.findFirst({ where: { kind: 'CONTRACTOR_WITHHOLDING', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
    return (table?.data as { rate?: number } | undefined)?.rate ?? 0.065;
  }

  async list(status?: InvoiceStatus) {
    const actor = this.actors.current;
    authorize(actor, 'invoices.read');
    const rows = await this.db.tx.contractorInvoice.findMany({ where: { companyId: actor.companyId, ...(status ? { status } : {}) }, orderBy: { dueDate: 'desc' } });
    const today = new Date();
    return rows.map((row) => ({
      ...row,
      dueDate: isoDate(row.dueDate),
      amount: decimal(row.amount),
      withholding: decimal(row.withholding),
      overdue: row.status !== 'PAID' && row.dueDate < today,
      fileKey: undefined,
      hasFile: Boolean(row.fileKey),
    }));
  }

  async create(input: { supplier: string; supplierNif?: string; number: string; description?: string; dueDate: string; amount: number | string; withholding: boolean }, file?: UploadedFile) {
    const actor = this.actors.current;
    authorize(actor, 'invoices.write');
    const amount = Money.of(input.amount);
    const withholding = input.withholding ? amount.multiply(await this.withholdingRate()).round() : Money.zero();
    let fileKey: string | undefined;
    if (file) {
      fileKey = `${actor.tenantId}/invoices/${randomUUID()}.pdf`;
      await this.storage.put(fileKey, file.buffer, file.mimetype);
    }
    const invoice = await this.db.tx.contractorInvoice.create({
      data: {
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        supplier: input.supplier,
        supplierNif: input.supplierNif,
        number: input.number,
        description: input.description,
        dueDate: toDate(input.dueDate),
        amount: amount.toString(),
        withholding: withholding.toString(),
        fileKey,
      },
    });
    await this.audit.record({ action: 'invoice.create', entityType: 'contractor_invoice', entityId: invoice.id, after: { supplier: input.supplier, amount: amount.toString() } });
    return { id: invoice.id, withholding: withholding.toString(), netPayable: amount.subtract(withholding).toString() };
  }

  async transition(id: string, to: 'APPROVED' | 'PAID' | 'REJECTED') {
    const actor = this.actors.current;
    authorize(actor, 'invoices.approve');
    const invoice = await this.db.tx.contractorInvoice.findFirst({ where: { id, companyId: actor.companyId } });
    if (!invoice) throw new NotFoundError('Factura', id);
    const allowed: Record<string, InvoiceStatus[]> = { APPROVED: ['PENDING'], REJECTED: ['PENDING'], PAID: ['APPROVED'] };
    if (!allowed[to].includes(invoice.status)) throw new BusinessRuleViolation(`Não é possível passar de ${invoice.status} para ${to}`, 'invalid_transition');
    await this.db.tx.contractorInvoice.update({ where: { id }, data: { status: to } });
    await this.audit.record({ action: `invoice.${to.toLowerCase()}`, entityType: 'contractor_invoice', entityId: id });
    return { id, status: to };
  }

  async file(id: string) {
    const actor = this.actors.current;
    authorize(actor, 'invoices.read');
    const invoice = await this.db.tx.contractorInvoice.findFirst({ where: { id, companyId: actor.companyId } });
    if (!invoice?.fileKey) throw new NotFoundError('Ficheiro da factura', id);
    return { ...(await this.storage.get(invoice.fileKey)), fileName: `${invoice.number.replace(/\W+/g, '-')}.pdf` };
  }
}
