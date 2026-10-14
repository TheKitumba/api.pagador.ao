import { Injectable } from '@nestjs/common';
import type { LegalTableKind, PayItemCategory, PayItemKind, PayItemNature, Prisma } from '@prisma/client';

import { authorize } from '@/shared/application/permissions';
import { NotFoundError } from '@/shared/domain/errors';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { decimal, isoDate, toDate } from '@/shared/application/formatting';

import { FORMULA_FUNCTIONS, FORMULA_VARIABLES, validateFormula } from '../domain/calculation/formula';

export interface PayItemInput {
  code: string;
  name: string;
  kind: PayItemKind;
  nature: PayItemNature;
  category?: PayItemCategory;
  formula?: string | null;
  irtSubject?: boolean;
  irtExemptionLimit?: number | null;
  ssSubject?: boolean;
  holidayAllowance?: boolean;
  christmasAllowance?: boolean;
  proportional?: boolean;
  accountingAccount?: string | null;
  calculationOrder?: number;
  visibleOnPayslip?: boolean;
}

@Injectable()
export class PayrollConfigService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async listPayItems() {
    const actor = this.actors.current;
    authorize(actor, 'payroll.read');
    const items = await this.db.tx.payItem.findMany({ where: { companyId: actor.companyId, archivedAt: null }, orderBy: [{ calculationOrder: 'asc' }, { code: 'asc' }] });
    return items.map((item) => ({ ...item, irtExemptionLimit: decimal(item.irtExemptionLimit), effectiveFrom: isoDate(item.effectiveFrom), effectiveTo: isoDate(item.effectiveTo) }));
  }

  formulaReference() {
    return { variables: FORMULA_VARIABLES, functions: FORMULA_FUNCTIONS, examples: ['1500 * assiduidade.dias_trabalhados', 'rubrica("R001") * 0.02 * min(floor(trabalhador.antiguidade_anos / 3), 5)'] };
  }

  async createPayItem(input: PayItemInput) {
    const actor = this.actors.current;
    authorize(actor, 'settings.write');
    if (input.formula) validateFormula(input.formula);
    const item = await this.db.tx.payItem.create({
      data: { ...input, irtExemptionLimit: input.irtExemptionLimit ?? undefined, tenantId: actor.tenantId, companyId: actor.companyId, calculationOrder: input.calculationOrder ?? 100 },
    });
    await this.audit.record({ action: 'pay_item.create', entityType: 'pay_item', entityId: item.id, after: item });
    return item;
  }

  async updatePayItem(id: string, input: Partial<PayItemInput>) {
    const actor = this.actors.current;
    authorize(actor, 'settings.write');
    const before = await this.db.tx.payItem.findFirst({ where: { id, companyId: actor.companyId } });
    if (!before) throw new NotFoundError('Rubrica', id);
    if (input.formula) validateFormula(input.formula);
    const item = await this.db.tx.payItem.update({ where: { id }, data: { ...input, irtExemptionLimit: input.irtExemptionLimit === undefined ? undefined : input.irtExemptionLimit } });
    await this.audit.record({ action: 'pay_item.update', entityType: 'pay_item', entityId: id, before, after: item });
    return item;
  }

  async archivePayItem(id: string) {
    const actor = this.actors.current;
    authorize(actor, 'settings.write');
    await this.db.tx.payItem.updateMany({ where: { id, companyId: actor.companyId }, data: { archivedAt: new Date(), effectiveTo: new Date() } });
    await this.audit.record({ action: 'pay_item.archive', entityType: 'pay_item', entityId: id });
  }

  async listLegalTables(kind?: LegalTableKind) {
    authorize(this.actors.current, 'settings.read');
    const tables = await this.db.tx.legalTable.findMany({ where: kind ? { kind } : {}, orderBy: [{ kind: 'asc' }, { effectiveFrom: 'desc' }] });
    const today = new Date();
    return tables.map((table) => ({
      ...table,
      effectiveFrom: isoDate(table.effectiveFrom),
      effectiveTo: isoDate(table.effectiveTo),
      scope: table.tenantId ? 'Empresa' : 'pagador.ao (global)',
      inForce: table.effectiveFrom <= today && (!table.effectiveTo || table.effectiveTo >= today),
    }));
  }

  /** New version of a legal table (tenant override). Previous versions stay for reprocessing. */
  async publishLegalTable(input: { kind: LegalTableKind; version: string; effectiveFrom: string; legalReference: string; data: Record<string, unknown> }) {
    const actor = this.actors.current;
    authorize(actor, 'settings.write');
    const effectiveFrom = toDate(input.effectiveFrom);
    await this.db.tx.legalTable.updateMany({
      where: { tenantId: actor.tenantId, kind: input.kind, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
      data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) },
    });
    const table = await this.db.tx.legalTable.create({
      data: { tenantId: actor.tenantId, kind: input.kind, version: input.version, effectiveFrom, legalReference: input.legalReference, data: input.data as Prisma.InputJsonValue, approvedBy: actor.name, approvedAt: new Date() },
    });
    await this.audit.record({ action: 'legal_table.publish', entityType: 'legal_table', entityId: table.id, after: { kind: input.kind, version: input.version, effectiveFrom: input.effectiveFrom } });
    return table;
  }
}
