import { Injectable } from '@nestjs/common';
import type { Authority, FilingKind, Prisma } from '@prisma/client';

import { PayrollRunsFacade } from '@/contexts/payroll/public';
import { authorize } from '@/shared/application/permissions';
import { BusinessRuleViolation, NotFoundError } from '@/shared/domain/errors';
import { Decimal } from '@/shared/domain/money';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { toCsv } from '@/shared/application/csv';
import { decimal, isoDate } from '@/shared/application/formatting';

const FILING: Record<FilingKind, { authority: Authority; label: string }> = {
  IRT_WITHHOLDING: { authority: 'AGT', label: 'IRT retido (Grupo A)' },
  SS_REMUNERATION: { authority: 'INSS', label: 'Folha de remunerações e contribuições' },
  CONTRACTOR_WITHHOLDING: { authority: 'AGT', label: 'Retenção na fonte — prestadores (Grupo B)' },
  ANNUAL_INCOME: { authority: 'AGT', label: 'Declaração anual de rendimentos (Modelo 2)' },
};
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Default deadlines (docs/02, 2.3.5 and 2.4): IRT by the end of the next month, INSS by day 10 of the next month. */
export function dueDate(kind: FilingKind, year: number, month: number) {
  if (kind === 'SS_REMUNERATION') return new Date(Date.UTC(year, month, 10));
  if (kind === 'ANNUAL_INCOME') return new Date(Date.UTC(year + 1, 2, 0));
  return new Date(Date.UTC(year, month + 1, 0));
}

@Injectable()
export class GenerateTaxFilingsUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly payroll: PayrollRunsFacade,
    private readonly audit: AuditService,
  ) {}

  async execute(year: number, month: number) {
    const actor = this.actors.current;
    authorize(actor, 'tax.write');
    const rows = await this.payroll.monthlyWithholdings(actor.companyId, year, month);
    if (rows.length === 0) throw new BusinessRuleViolation('Não há folhas aprovadas neste mês', 'no_approved_payroll');

    const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Decimal(0));
    const irt = { amount: sum(rows.map((row) => row.irt)), lines: rows.map((row) => ({ nif: row.nif, nome: row.name, rendimento: row.gross, materia_colectavel: row.irtBase, irt: row.irt })) };
    const ss = {
      amount: sum(rows.flatMap((row) => [row.ssEmployee, row.ssEmployer])),
      lines: rows.map((row) => ({ numero_ss: row.socialSecurityNumber, nome: row.name, remuneracao: row.ssBase, trabalhador_3: row.ssEmployee, empresa_8: row.ssEmployer })),
    };
    const invoices = await this.db.tx.contractorInvoice.findMany({
      where: { companyId: actor.companyId, status: { in: ['APPROVED', 'PAID'] }, withholding: { gt: 0 }, dueDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) } },
    });
    const contractors = { amount: sum(invoices.map((invoice) => invoice.withholding.toString())), lines: invoices.map((invoice) => ({ fornecedor: invoice.supplier, nif: invoice.supplierNif, factura: invoice.number, valor: invoice.amount.toFixed(2), retencao: invoice.withholding.toFixed(2) })) };

    const generated = [];
    for (const [kind, data] of [
      ['IRT_WITHHOLDING', irt],
      ['SS_REMUNERATION', ss],
      ['CONTRACTOR_WITHHOLDING', contractors],
    ] as const) {
      if (kind === 'CONTRACTOR_WITHHOLDING' && data.lines.length === 0) continue;
      const existing = await this.db.tx.taxFiling.findUnique({ where: { companyId_kind_year_month: { companyId: actor.companyId, kind, year, month } } });
      if (existing && existing.status !== 'READY') continue;
      const filing = await this.db.tx.taxFiling.upsert({
        where: { companyId_kind_year_month: { companyId: actor.companyId, kind, year, month } },
        create: { tenantId: actor.tenantId, companyId: actor.companyId, authority: FILING[kind].authority, kind, year, month, dueDate: dueDate(kind, year, month), amount: data.amount.toFixed(2), lines: data.lines as Prisma.InputJsonValue },
        update: { amount: data.amount.toFixed(2), lines: data.lines as Prisma.InputJsonValue },
      });
      generated.push({ id: filing.id, kind, amount: filing.amount.toFixed(2), dueDate: isoDate(filing.dueDate) });
    }
    await this.audit.record({ action: 'tax_filings.generate', entityType: 'tax_filing', after: { year, month, count: generated.length } });
    return generated;
  }
}

@Injectable()
export class TaxFilingsService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  private present(filing: Prisma.TaxFilingGetPayload<object>) {
    const today = new Date();
    return {
      id: filing.id,
      authority: filing.authority,
      kind: filing.kind,
      name: `${FILING[filing.kind].label} — ${MONTHS[filing.month - 1]} ${filing.year}`,
      year: filing.year,
      month: filing.month,
      dueDate: isoDate(filing.dueDate),
      amount: decimal(filing.amount),
      status: filing.status !== 'PAID' && filing.dueDate < today ? 'OVERDUE' : filing.status,
      submittedAt: filing.submittedAt,
      paidAt: filing.paidAt,
    };
  }

  async list(year?: number) {
    const actor = this.actors.current;
    authorize(actor, 'tax.read');
    const filings = await this.db.tx.taxFiling.findMany({ where: { companyId: actor.companyId, ...(year ? { year } : {}) }, orderBy: [{ dueDate: 'desc' }] });
    return filings.map((filing) => this.present(filing));
  }

  async get(id: string) {
    const actor = this.actors.current;
    authorize(actor, 'tax.read');
    const filing = await this.db.tx.taxFiling.findFirst({ where: { id, companyId: actor.companyId } });
    if (!filing) throw new NotFoundError('Obrigação fiscal', id);
    return { ...this.present(filing), lines: filing.lines };
  }

  async file(id: string) {
    const filing = await this.get(id);
    return { content: toCsv(filing.lines as Record<string, string | null>[]), fileName: `${filing.kind.toLowerCase()}-${filing.year}-${String(filing.month).padStart(2, '0')}.csv` };
  }

  async transition(id: string, to: 'SUBMITTED' | 'PAID') {
    const actor = this.actors.current;
    authorize(actor, 'tax.write');
    const filing = await this.db.tx.taxFiling.findFirst({ where: { id, companyId: actor.companyId } });
    if (!filing) throw new NotFoundError('Obrigação fiscal', id);
    if (to === 'PAID' && filing.status === 'READY') {
      await this.db.tx.taxFiling.update({ where: { id }, data: { status: 'PAID', submittedAt: new Date(), paidAt: new Date() } });
    } else {
      await this.db.tx.taxFiling.update({ where: { id }, data: to === 'SUBMITTED' ? { status: 'SUBMITTED', submittedAt: new Date() } : { status: 'PAID', paidAt: new Date() } });
    }
    await this.audit.record({ action: `tax_filing.${to.toLowerCase()}`, entityType: 'tax_filing', entityId: id });
    return this.get(id);
  }

  /** Upcoming deadlines for the next months, whether or not the filing was generated yet. */
  async calendar(months = 3) {
    const actor = this.actors.current;
    authorize(actor, 'tax.read');
    const today = new Date();
    const filings = await this.db.tx.taxFiling.findMany({ where: { companyId: actor.companyId } });
    const deadlines = [];
    for (let offset = -1; offset < months; offset++) {
      const reference = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
      const year = reference.getUTCFullYear();
      const month = reference.getUTCMonth() + 1;
      for (const kind of ['SS_REMUNERATION', 'IRT_WITHHOLDING'] as const) {
        const due = dueDate(kind, year, month);
        if (due < today) continue;
        const filing = filings.find((item) => item.kind === kind && item.year === year && item.month === month);
        deadlines.push({
          date: isoDate(due),
          authority: FILING[kind].authority,
          title: `${FILING[kind].label} — ${MONTHS[month - 1]} ${year}`,
          daysLeft: Math.ceil((due.getTime() - today.getTime()) / 86_400_000),
          status: filing?.status ?? 'NOT_GENERATED',
          filingId: filing?.id ?? null,
        });
      }
    }
    return deadlines.sort((a, b) => a.daysLeft - b.daysLeft);
  }
}
