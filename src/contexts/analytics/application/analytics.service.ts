import { Injectable } from '@nestjs/common';

import { TaxFilingsService } from '@/contexts/tax-compliance/application/tax-filings.use-cases';
import { authorize, can } from '@/shared/application/permissions';
import { NotFoundError } from '@/shared/domain/errors';
import { Decimal } from '@/shared/domain/money';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { Database } from '@/shared/infrastructure/prisma/database';
import { isoDate } from '@/shared/application/formatting';

type Row = Record<string, string | number | null>;

export const REPORTS: { code: string; name: string; category: string; description: string }[] = [
  { code: 'headcount-by-unit', name: 'Efectivo por departamento', category: 'Pessoas', description: 'Trabalhadores activos por unidade orgânica' },
  { code: 'headcount-by-site', name: 'Efectivo por estabelecimento', category: 'Pessoas', description: 'Trabalhadores activos por local' },
  { code: 'turnover', name: 'Admissões e saídas (12 meses)', category: 'Pessoas', description: 'Rotatividade mensal' },
  { code: 'payroll-cost-by-cost-center', name: 'Custo da folha por centro de custo', category: 'Remuneração', description: 'Último processamento aprovado' },
  { code: 'overtime-vs-limit', name: 'Horas extra vs. limite legal', category: 'Tempo', description: 'Mês corrente' },
  { code: 'absenteeism-by-reason', name: 'Absentismo por motivo', category: 'Tempo', description: 'Dias de ausência aprovados no ano' },
];

/** Read models for the dashboard, reports and calendar (CQRS read side, docs/09 9.4.4). */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly tax: TaxFilingsService,
  ) {}

  async dashboard() {
    const actor = this.actors.current;
    authorize(actor, 'reports.read');
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const in30 = new Date(now.getTime() + 30 * 86_400_000);
    const companyId = actor.companyId;

    const [headcount, hiredThisMonth, lastRun, contractsEnding, absences, pendingApprovals] = await Promise.all([
      this.db.tx.employee.count({ where: { companyId, status: { not: 'TERMINATED' } } }),
      this.db.tx.employee.count({ where: { companyId, hireDate: { gte: monthStart } } }),
      this.db.tx.payrollRun.findFirst({ where: { companyId, runType: 'REGULAR', status: { not: 'DRAFT' } }, include: { period: true }, orderBy: [{ period: { year: 'desc' } }, { period: { month: 'desc' } }] }),
      this.db.tx.employmentContract.count({ where: { status: 'ACTIVE', employee: { companyId }, OR: [{ endDate: { gte: now, lte: in30 } }, { probationEndDate: { gte: now, lte: in30 } }] } }),
      this.db.tx.leaveRequest.aggregate({ where: { status: 'APPROVED', type: { in: ['SICK', 'UNJUSTIFIED', 'OTHER_JUSTIFIED'] }, startDate: { gte: monthStart } }, _sum: { days: true } }),
      this.db.tx.approvalRequest.count({ where: { status: 'PENDING' } }),
    ]);
    const workingDaysSoFar = Math.max(1, Math.round(((now.getTime() - monthStart.getTime()) / 86_400_000) * (5 / 7)));
    const absenteeism = headcount ? new Decimal(absences._sum.days ?? 0).dividedBy(headcount * workingDaysSoFar).times(100).toFixed(1) : '0.0';
    const deadlines = can(actor, 'tax.read') ? (await this.tax.calendar(2)).slice(0, 4) : [];
    const birthdays = await this.db.tx.$queryRaw<{ id: string; name: string; day: number }[]>`
      SELECT id, full_name AS name, EXTRACT(DAY FROM birth_date)::int AS day
      FROM employees
      WHERE company_id = ${companyId}::uuid AND status <> 'TERMINATED' AND EXTRACT(MONTH FROM birth_date) = ${now.getUTCMonth() + 1}
      ORDER BY day`;

    return {
      headcount,
      hiredThisMonth,
      payroll: lastRun ? { runId: lastRun.id, status: lastRun.status, year: lastRun.period.year, month: lastRun.period.month, paymentDate: isoDate(lastRun.period.paymentDate), totals: lastRun.totals } : null,
      absenteeismPercent: absenteeism,
      contractsEndingIn30Days: contractsEnding,
      pendingApprovals,
      deadlines,
      birthdays,
    };
  }

  catalog() {
    authorize(this.actors.current, 'reports.read');
    return REPORTS;
  }

  async run(code: string): Promise<{ code: string; name: string; rows: Row[] }> {
    const actor = this.actors.current;
    authorize(actor, 'reports.read');
    const report = REPORTS.find((item) => item.code === code);
    if (!report) throw new NotFoundError('Relatório', code);
    const companyId = actor.companyId;
    const now = new Date();
    let rows: Row[] = [];

    if (code === 'headcount-by-unit' || code === 'headcount-by-site') {
      const key = code === 'headcount-by-unit' ? 'orgUnitId' : 'establishmentId';
      const groups = await this.db.tx.employee.groupBy({ by: [key], where: { companyId, status: { not: 'TERMINATED' } }, _count: true });
      const names =
        key === 'orgUnitId'
          ? new Map((await this.db.tx.orgUnit.findMany({ where: { companyId } })).map((unit) => [unit.id, unit.name]))
          : new Map((await this.db.tx.establishment.findMany({ where: { companyId } })).map((site) => [site.id, site.name]));
      rows = groups.map((group) => ({ grupo: names.get((group as unknown as Record<string, string | null>)[key] ?? '') ?? 'Sem atribuição', efectivo: group._count })).sort((a, b) => Number(b.efectivo) - Number(a.efectivo));
    } else if (code === 'turnover') {
      for (let offset = 11; offset >= 0; offset--) {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 0));
        const [hires, exits] = await Promise.all([
          this.db.tx.employee.count({ where: { companyId, hireDate: { gte: start, lte: end } } }),
          this.db.tx.termination.count({ where: { status: { in: ['APPROVED', 'PAID'] }, lastDay: { gte: start, lte: end } } }),
        ]);
        rows.push({ mes: isoDate(start)!.slice(0, 7), admissoes: hires, saidas: exits });
      }
    } else if (code === 'payroll-cost-by-cost-center') {
      const run = await this.db.tx.payrollRun.findFirst({ where: { companyId, status: { in: ['APPROVED', 'PAID', 'CLOSED'] }, runType: 'REGULAR' }, orderBy: { createdAt: 'desc' } });
      if (run) {
        const payslips = await this.db.tx.payslip.findMany({ where: { runId: run.id }, select: { employeeId: true, employerCost: true } });
        const employees = await this.db.tx.employee.findMany({ where: { id: { in: payslips.map((p) => p.employeeId) } }, select: { id: true, costCenterId: true } });
        const centers = new Map((await this.db.tx.costCenter.findMany({ where: { companyId } })).map((c) => [c.id, `${c.code} — ${c.name}`]));
        const centerOf = new Map(employees.map((e) => [e.id, e.costCenterId ? (centers.get(e.costCenterId) ?? 'Sem centro de custo') : 'Sem centro de custo']));
        const totals = new Map<string, Decimal>();
        for (const payslip of payslips) {
          const center = centerOf.get(payslip.employeeId) ?? 'Sem centro de custo';
          totals.set(center, (totals.get(center) ?? new Decimal(0)).plus(payslip.employerCost.toString()));
        }
        rows = [...totals.entries()].map(([centro, total]) => ({ centro_de_custo: centro, custo_total: total.toFixed(2) }));
      }
    } else if (code === 'overtime-vs-limit') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const groups = await this.db.tx.overtimeRequest.groupBy({ by: ['employeeId'], where: { status: 'APPROVED', date: { gte: start } }, _sum: { minutes: true } });
      const names = new Map((await this.db.tx.employee.findMany({ where: { id: { in: groups.map((g) => g.employeeId) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
      rows = groups.map((group) => ({ trabalhador: names.get(group.employeeId) ?? null, horas: (group._sum.minutes ?? 0) / 60 })).sort((a, b) => Number(b.horas) - Number(a.horas));
    } else if (code === 'absenteeism-by-reason') {
      const groups = await this.db.tx.leaveRequest.groupBy({ by: ['type'], where: { status: 'APPROVED', type: { not: 'VACATION' }, startDate: { gte: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)) } }, _sum: { days: true } });
      rows = groups.map((group) => ({ motivo: group.type, dias: group._sum.days ?? 0 }));
    }
    return { code, name: report.name, rows };
  }

  async savedReports() {
    authorize(this.actors.current, 'reports.read');
    return this.db.tx.savedReport.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async saveReport(input: { name: string; source: string; groupBy?: string; schedule?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'reports.read');
    return this.db.tx.savedReport.create({ data: { ...input, tenantId: actor.tenantId, createdBy: actor.userId } });
  }

  /** Calendar events between two dates (docs/10 "Calendário"). */
  async calendar(from: Date, to: Date) {
    const actor = this.actors.current;
    const events: { date: string; title: string; kind: 'holiday' | 'payroll' | 'tax' | 'leave' | 'training' | 'interview' }[] = [];
    const holidays = await this.db.tx.legalTable.findMany({ where: { kind: 'HOLIDAYS' } });
    for (const table of holidays) {
      for (const holiday of (table.data as { holidays?: { date: string; name: string }[] }).holidays ?? []) {
        const date = new Date(`${holiday.date}T00:00:00Z`);
        if (date >= from && date <= to) events.push({ date: holiday.date, title: holiday.name, kind: 'holiday' });
      }
    }
    const [leave, periods, trainings, interviews] = await Promise.all([
      can(actor, 'leave.read') || can(actor, 'team.read') ? this.db.tx.leaveRequest.findMany({ where: { status: 'APPROVED', startDate: { lte: to }, endDate: { gte: from } } }) : Promise.resolve([]),
      can(actor, 'payroll.read') ? this.db.tx.payrollPeriod.findMany({ where: { companyId: actor.companyId, paymentDate: { gte: from, lte: to } } }) : Promise.resolve([]),
      this.db.tx.training.findMany({ where: { companyId: actor.companyId, date: { gte: from, lte: to } } }),
      can(actor, 'recruitment.read') ? this.db.tx.candidate.findMany({ where: { interviewAt: { gte: from, lte: to } } }) : Promise.resolve([]),
    ]);
    const names = new Map((await this.db.tx.employee.findMany({ where: { id: { in: leave.map((l) => l.employeeId) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
    for (const item of leave) events.push({ date: isoDate(item.startDate)!, title: `Ausência de ${names.get(item.employeeId) ?? ''} (${item.days} dias)`, kind: 'leave' });
    for (const period of periods) events.push({ date: isoDate(period.paymentDate)!, title: 'Pagamento de salários', kind: 'payroll' });
    for (const training of trainings) events.push({ date: isoDate(training.date)!, title: training.title, kind: 'training' });
    for (const candidate of interviews) events.push({ date: candidate.interviewAt!.toISOString().slice(0, 10), title: `Entrevista — ${candidate.name}`, kind: 'interview' });
    if (can(actor, 'tax.read')) {
      for (const deadline of await this.tax.calendar(3)) {
        const date = new Date(`${deadline.date}T00:00:00Z`);
        if (date >= from && date <= to) events.push({ date: deadline.date!, title: deadline.title, kind: 'tax' });
      }
    }
    return events.sort((a, b) => a.date.localeCompare(b.date));
  }
}
