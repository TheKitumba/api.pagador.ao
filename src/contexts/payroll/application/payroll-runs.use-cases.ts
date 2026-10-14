import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { PayrollRunType, Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';

import { ApprovalOutcomeRegistry, Approvals } from '@/contexts/approvals/public';
import { authorize } from '@/shared/application/permissions';
import { BusinessRuleViolation, ConflictError, NotFoundError } from '@/shared/domain/errors';
import { Decimal } from '@/shared/domain/money';
import { Iban } from '@/shared/domain/value-objects';
import { AuditService } from '@/shared/infrastructure/audit/audit.service';
import { ActorContext } from '@/shared/infrastructure/context/actor-context';
import { OutboxService } from '@/shared/infrastructure/outbox/outbox.service';
import { Database } from '@/shared/infrastructure/prisma/database';
import { JOBS, QUEUES, SYNC_PAYROLL_LIMIT } from '@/shared/infrastructure/queue/queues';
import { decimal, isoDate, toDate } from '@/shared/application/formatting';

import { calculatePayslip, type PayItemDefinition, type PayslipAlert, type PeriodInput } from '../domain/calculation/payroll-calculator';
import { PayrollRun } from '../domain/payroll-run';
import { LegalParametersProvider } from '../infrastructure/legal-parameters.provider';
import { AttendanceSummaryPort, EmploymentSnapshotPort } from './ports';

const RUN_TYPE_LABEL: Record<PayrollRunType, string> = {
  REGULAR: 'Folha',
  HOLIDAY_ALLOWANCE: 'Subsídio de férias',
  CHRISTMAS_ALLOWANCE: 'Subsídio de Natal',
  BONUS: 'Prémios',
  RETRO: 'Retroactivos',
  SUPPLEMENTARY: 'Folha complementar',
  FINAL_SETTLEMENT: 'Acertos de contas',
};
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const runName = (type: PayrollRunType, year: number, month: number) => `${RUN_TYPE_LABEL[type]} de ${MONTHS[month - 1]} ${year}`;

function lastBusinessDay(year: number, month: number) {
  const date = new Date(Date.UTC(year, month, 0));
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  return date;
}

function workingDays(start: Date, end: Date) {
  let days = 0;
  for (let day = new Date(start); day <= end; day = new Date(day.getTime() + 86_400_000)) if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) days++;
  return days;
}

@Injectable()
export class PayrollRunRepository {
  constructor(private readonly db: Database) {}

  async get(id: string) {
    const row = await this.db.tx.payrollRun.findUnique({ where: { id }, include: { period: true } });
    if (!row) throw new NotFoundError('Processamento', id);
    return { row, aggregate: PayrollRun.restore({ id: row.id, status: row.status, calculatedBy: row.calculatedBy, approvedBy: row.approvedBy }) };
  }

  async save(run: PayrollRun, extra: Prisma.PayrollRunUpdateInput = {}) {
    const { id, status, calculatedBy, approvedBy } = run.snapshot;
    await this.db.tx.payrollRun.update({ where: { id }, data: { status, calculatedBy, approvedBy, ...extra } });
  }
}

@Injectable()
export class CreatePayrollRunUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly audit: AuditService,
  ) {}

  async execute(input: { year: number; month: number; runType: PayrollRunType; paymentDate?: string }) {
    const actor = this.actors.current;
    authorize(actor, 'payroll.calculate');
    const start = new Date(Date.UTC(input.year, input.month - 1, 1));
    const end = new Date(Date.UTC(input.year, input.month, 0));
    const period = await this.db.tx.payrollPeriod.upsert({
      where: { companyId_year_month: { companyId: actor.companyId, year: input.year, month: input.month } },
      create: {
        tenantId: actor.tenantId,
        companyId: actor.companyId,
        year: input.year,
        month: input.month,
        startDate: start,
        endDate: end,
        paymentDate: input.paymentDate ? toDate(input.paymentDate) : lastBusinessDay(input.year, input.month),
      },
      update: input.paymentDate ? { paymentDate: toDate(input.paymentDate) } : {},
    });
    if (period.status === 'CLOSED') throw new BusinessRuleViolation('O período está fechado', 'period_closed');
    const open = await this.db.tx.payrollRun.findFirst({ where: { periodId: period.id, runType: input.runType, status: { not: 'CLOSED' } } });
    if (open && input.runType === 'REGULAR') throw new ConflictError('Já existe um processamento normal para este período', 'run_exists');

    const run = await this.db.tx.payrollRun.create({ data: { tenantId: actor.tenantId, companyId: actor.companyId, periodId: period.id, runType: input.runType } });
    await this.audit.record({ action: 'payroll_run.create', entityType: 'payroll_run', entityId: run.id, after: { year: input.year, month: input.month, runType: input.runType } });
    return { id: run.id, name: runName(input.runType, input.year, input.month), status: run.status };
  }
}

/** The calculation itself. Used by the HTTP use case (small runs) and by the worker (large runs). */
@Injectable()
export class PayrollRunCalculation {
  constructor(
    private readonly db: Database,
    private readonly runs: PayrollRunRepository,
    private readonly legal: LegalParametersProvider,
    private readonly employment: EmploymentSnapshotPort,
    private readonly attendance: AttendanceSummaryPort,
    private readonly outbox: OutboxService,
  ) {}

  async run(runId: string, calculatedBy: string) {
    const { row, aggregate } = await this.runs.get(runId);
    aggregate.assertCalculable();
    const period = row.period;
    const tx = this.db.tx;

    const { parameters, snapshot } = await this.legal.resolve(period.endDate);
    const [employees, payItemRows] = await Promise.all([
      this.employment.forPeriod(row.companyId, period.startDate, period.endDate),
      tx.payItem.findMany({ where: { companyId: row.companyId, archivedAt: null } }),
    ]);
    const ids = employees.map((employee) => employee.employeeId);
    const [attendance, variables, loans, expenses, previous, attendanceClosed] = await Promise.all([
      this.attendance.forEmployees(ids, period.year, period.month),
      tx.payrollVariable.findMany({ where: { periodId: period.id } }),
      row.runType === 'REGULAR' ? tx.loan.findMany({ where: { employeeId: { in: ids }, status: 'ACTIVE' } }) : Promise.resolve([]),
      row.runType === 'REGULAR' ? tx.expenseClaim.findMany({ where: { employeeId: { in: ids }, status: 'APPROVED', paidInRunId: null } }) : Promise.resolve([]),
      tx.payrollRun.findFirst({ where: { companyId: row.companyId, runType: row.runType, id: { not: row.id }, status: { in: ['APPROVED', 'PAID', 'CLOSED'] } }, orderBy: { createdAt: 'desc' }, include: { payslips: { select: { employeeId: true, net: true } } } }),
      this.attendance.isClosed(row.companyId, period.year, period.month),
    ]);
    const previousNet = new Map(previous?.payslips.map((payslip) => [payslip.employeeId, payslip.net.toString()]) ?? []);

    const payItems: PayItemDefinition[] = payItemRows.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      kind: item.kind,
      nature: item.nature,
      formula: item.formula,
      irtSubject: item.irtSubject,
      irtExemptionLimit: item.irtExemptionLimit?.toString() ?? null,
      ssSubject: item.ssSubject,
      holidayAllowance: item.holidayAllowance,
      christmasAllowance: item.christmasAllowance,
      proportional: item.proportional,
      calculationOrder: item.calculationOrder,
    }));
    const periodInput: PeriodInput = { year: period.year, month: period.month, start: period.startDate, end: period.endDate, workingDays: workingDays(period.startDate, period.endDate), runType: row.runType };

    await tx.payslip.deleteMany({ where: { runId } });
    const totals = { employees: 0, gross: new Decimal(0), ssEmployee: new Decimal(0), ssEmployer: new Decimal(0), irt: new Decimal(0), net: new Decimal(0), employerCost: new Decimal(0) };
    const runAlerts: (PayslipAlert & { employeeId?: string; employeeName?: string })[] = [];
    if (!attendanceClosed && row.runType === 'REGULAR') runAlerts.push({ severity: 'warning', code: 'attendance_open', message: 'Assiduidade do período ainda não fechada' });

    for (const employee of employees) {
      const result = calculatePayslip(
        {
          employeeId: employee.employeeId,
          name: employee.name,
          nif: employee.nif,
          socialSecurityNumber: employee.socialSecurityNumber,
          hireDate: employee.hireDate,
          dependents: employee.dependents,
          contract: employee.contract,
          fixedItems: employee.fixedPayItems,
          variables: variables.filter((variable) => variable.employeeId === employee.employeeId).map((variable) => ({ payItemId: variable.payItemId, quantity: variable.quantity?.toString() ?? null, amount: variable.amount?.toString() ?? null })),
          attendance: attendance.get(employee.employeeId) ?? { unjustifiedAbsenceDays: 0, unpaidLeaveDays: 0, overtimeHours: { WEEKDAY: 0, REST_DAY: 0, HOLIDAY: 0, NIGHT: 0 } },
          deductions: loans.filter((loan) => loan.employeeId === employee.employeeId).map((loan) => ({ id: loan.id, type: loan.type, installment: loan.installmentValue.toString(), balance: loan.balance.toString() })),
          reimbursements: expenses.filter((expense) => expense.employeeId === employee.employeeId).map((expense) => ({ id: expense.id, amount: expense.amount.toString(), description: expense.description })),
          hasValidIban: Boolean(employee.bankAccount && Iban.isValid(employee.bankAccount.iban)),
          previousNet: previousNet.get(employee.employeeId) ?? null,
        },
        periodInput,
        payItems,
        parameters,
      );

      await tx.payslip.create({
        data: {
          tenantId: row.tenantId,
          runId,
          employeeId: employee.employeeId,
          contractId: employee.contract.id,
          gross: result.gross,
          ssBase: result.ssBase,
          ssEmployee: result.ssEmployee,
          ssEmployer: result.ssEmployer,
          irtTaxable: result.irtTaxable,
          irtBase: result.irtBase,
          irt: result.irt,
          totalDeductions: result.totalDeductions,
          net: result.net,
          employerCost: result.employerCost,
          alerts: result.alerts as unknown as Prisma.InputJsonValue,
          calculationTrace: { ...result.trace, appliedDeductions: result.appliedDeductions, reimbursements: expenses.filter((e) => e.employeeId === employee.employeeId).map((e) => e.id) } as Prisma.InputJsonValue,
          lines: { create: result.lines.map((line) => ({ ...line, tenantId: row.tenantId, quantity: line.quantity ? new Decimal(line.quantity.replace(/[^\d.]/g, '') || 0).toString() : null })) },
        },
      });
      totals.employees++;
      totals.gross = totals.gross.plus(result.gross);
      totals.ssEmployee = totals.ssEmployee.plus(result.ssEmployee);
      totals.ssEmployer = totals.ssEmployer.plus(result.ssEmployer);
      totals.irt = totals.irt.plus(result.irt);
      totals.net = totals.net.plus(result.net);
      totals.employerCost = totals.employerCost.plus(result.employerCost);
      for (const alert of result.alerts) runAlerts.push({ ...alert, employeeId: employee.employeeId, employeeName: employee.name });
    }

    aggregate.markCalculated(calculatedBy);
    const totalsJson = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value instanceof Decimal ? value.toFixed(2) : value]));
    await this.runs.save(aggregate, {
      totals: totalsJson as Prisma.InputJsonValue,
      alerts: runAlerts as unknown as Prisma.InputJsonValue,
      legalTablesSnapshot: snapshot as Prisma.InputJsonValue,
      calculatedAt: new Date(),
    });
    await this.outbox.publishFrom(aggregate);
    return { id: runId, status: aggregate.snapshot.status, totals: totalsJson, blocking: runAlerts.filter((alert) => alert.severity === 'blocking').length, warnings: runAlerts.filter((alert) => alert.severity === 'warning').length };
  }
}

@Injectable()
export class CalculatePayrollRunUseCase {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly calculation: PayrollRunCalculation,
    private readonly audit: AuditService,
    private readonly employment: EmploymentSnapshotPort,
    @InjectQueue(QUEUES.payroll) private readonly queue: Queue,
  ) {}

  /** Small runs are calculated in the request; large ones go to the worker (docs/09, 9.7). */
  async execute(runId: string) {
    const actor = this.actors.current;
    authorize(actor, 'payroll.calculate');
    const run = await this.db.tx.payrollRun.findUnique({ where: { id: runId }, include: { period: true } });
    if (!run) throw new NotFoundError('Processamento', runId);
    const population = await this.employment.forPeriod(run.companyId, run.period.startDate, run.period.endDate);
    await this.audit.record({ action: 'payroll_run.calculate', entityType: 'payroll_run', entityId: runId, after: { employees: population.length } });

    if (population.length > SYNC_PAYROLL_LIMIT) {
      await this.queue.add(JOBS.payrollCalculate, { tenantId: actor.tenantId, runId, userId: actor.userId }, { jobId: `calc-${runId}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      return { id: runId, status: 'QUEUED', employees: population.length };
    }
    return this.calculation.run(runId, actor.userId);
  }
}

@Injectable()
export class SubmitPayrollRunUseCase {
  constructor(
    private readonly actors: ActorContext,
    private readonly runs: PayrollRunRepository,
    private readonly approvals: Approvals,
    private readonly audit: AuditService,
  ) {}

  async execute(runId: string) {
    const actor = this.actors.current;
    authorize(actor, 'payroll.calculate');
    const { row, aggregate } = await this.runs.get(runId);
    const alerts = (row.alerts as unknown as PayslipAlert[] | null) ?? [];
    aggregate.submit(alerts.filter((alert) => alert.severity === 'blocking').length);
    await this.runs.save(aggregate, { submittedAt: new Date() });
    const totals = row.totals as { employees?: number; net?: string } | null;
    await this.approvals.start({
      type: 'PAYROLL_RUN',
      subjectId: runId,
      title: `Aprovar ${runName(row.runType, row.period.year, row.period.month)}`,
      detail: `${totals?.employees ?? 0} trabalhadores · líquido ${totals?.net ?? '0.00'} Kz`,
      requesterUserId: actor.userId,
      // Segregation of duties: whoever calculated the run cannot approve it (docs/05, 5.4 rule 1).
      excludedUserIds: [row.calculatedBy, actor.userId].filter((id): id is string => Boolean(id)),
    });
    await this.audit.record({ action: 'payroll_run.submit', entityType: 'payroll_run', entityId: runId });
    return { id: runId, status: aggregate.snapshot.status };
  }
}

@Injectable()
export class PayrollRunOutcomeHandler implements OnModuleInit {
  constructor(
    private readonly registry: ApprovalOutcomeRegistry,
    private readonly db: Database,
    private readonly runs: PayrollRunRepository,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    this.registry.register('PAYROLL_RUN', async ({ subjectId, decision, actor }) => {
      const { aggregate } = await this.runs.get(subjectId);
      if (decision !== 'APPROVED') {
        aggregate.returnToCalculated();
        await this.runs.save(aggregate);
        return;
      }
      aggregate.approve(actor.userId);
      await this.runs.save(aggregate, { approvedAt: new Date() });

      // Withheld instalments and reimbursements become effective with the approved payroll.
      const payslips = await this.db.tx.payslip.findMany({ where: { runId: subjectId }, select: { calculationTrace: true } });
      for (const payslip of payslips) {
        const trace = payslip.calculationTrace as { appliedDeductions?: { id: string; amount: string }[]; reimbursements?: string[] };
        for (const deduction of trace.appliedDeductions ?? []) {
          const loan = await this.db.tx.loan.update({ where: { id: deduction.id }, data: { paidInstallments: { increment: 1 }, balance: { decrement: deduction.amount } } });
          if (loan.balance.lessThanOrEqualTo(0)) await this.db.tx.loan.update({ where: { id: loan.id }, data: { status: 'SETTLED', balance: 0 } });
        }
        if (trace.reimbursements?.length) await this.db.tx.expenseClaim.updateMany({ where: { id: { in: trace.reimbursements } }, data: { paidInRunId: subjectId } });
      }
      await this.outbox.publishFrom(aggregate);
    });
  }
}

@Injectable()
export class ClosePayrollRunUseCase {
  constructor(
    private readonly actors: ActorContext,
    private readonly runs: PayrollRunRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async markPaid(runId: string) {
    authorize(this.actors.current, 'payroll.close');
    const { aggregate } = await this.runs.get(runId);
    aggregate.markPaid();
    await this.runs.save(aggregate, { paidAt: new Date() });
    await this.outbox.publishFrom(aggregate);
    await this.audit.record({ action: 'payroll_run.paid', entityType: 'payroll_run', entityId: runId });
    return { id: runId, status: aggregate.snapshot.status };
  }

  async close(runId: string) {
    authorize(this.actors.current, 'payroll.close');
    const { aggregate } = await this.runs.get(runId);
    aggregate.close();
    await this.runs.save(aggregate, { closedAt: new Date() });
    await this.outbox.publishFrom(aggregate);
    await this.audit.record({ action: 'payroll_run.close', entityType: 'payroll_run', entityId: runId });
    return { id: runId, status: aggregate.snapshot.status };
  }
}

@Injectable()
export class PayrollVariablesService {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
    private readonly runs: PayrollRunRepository,
    private readonly audit: AuditService,
  ) {}

  async list(runId: string) {
    authorize(this.actors.current, 'payroll.read');
    const { row } = await this.runs.get(runId);
    const rows = await this.db.tx.payrollVariable.findMany({ where: { periodId: row.periodId }, orderBy: { createdAt: 'desc' } });
    const [employees, items] = await Promise.all([
      this.db.tx.employee.findMany({ where: { id: { in: rows.map((r) => r.employeeId) } }, select: { id: true, fullName: true } }),
      this.db.tx.payItem.findMany({ where: { id: { in: rows.map((r) => r.payItemId) } }, select: { id: true, code: true, name: true } }),
    ]);
    const names = new Map(employees.map((e) => [e.id, e.fullName]));
    const itemById = new Map(items.map((i) => [i.id, i]));
    return rows.map((variable) => ({
      id: variable.id,
      employee: { id: variable.employeeId, name: names.get(variable.employeeId) ?? null },
      payItem: itemById.get(variable.payItemId) ?? null,
      quantity: variable.quantity?.toString() ?? null,
      amount: decimal(variable.amount),
      notes: variable.notes,
    }));
  }

  /** Bulk variable entries for the period (docs/07: POST /payroll/periods/{id}/variables). */
  async add(runId: string, entries: { employeeId: string; payItemCode: string; quantity?: number; amount?: number | string; notes?: string }[]) {
    const actor = this.actors.current;
    authorize(actor, 'payroll.inputs');
    const { row, aggregate } = await this.runs.get(runId);
    aggregate.assertInputsEditable();
    const items = await this.db.tx.payItem.findMany({ where: { companyId: actor.companyId, code: { in: entries.map((entry) => entry.payItemCode) } } });
    const byCode = new Map(items.map((item) => [item.code, item]));
    const missing = entries.filter((entry) => !byCode.has(entry.payItemCode)).map((entry) => entry.payItemCode);
    if (missing.length) throw new NotFoundError('Rubrica', [...new Set(missing)].join(', '));

    await this.db.tx.payrollVariable.createMany({
      data: entries.map((entry) => ({
        tenantId: actor.tenantId,
        periodId: row.periodId,
        employeeId: entry.employeeId,
        payItemId: byCode.get(entry.payItemCode)!.id,
        quantity: entry.quantity,
        amount: entry.amount !== undefined ? new Decimal(entry.amount).toFixed(2) : undefined,
        notes: entry.notes,
      })),
    });
    await this.runs.save(aggregate);
    await this.audit.record({ action: 'payroll_variables.add', entityType: 'payroll_run', entityId: runId, after: { count: entries.length } });
    return { added: entries.length, status: aggregate.snapshot.status };
  }

  async remove(runId: string, variableId: string) {
    authorize(this.actors.current, 'payroll.inputs');
    const { row, aggregate } = await this.runs.get(runId);
    aggregate.assertInputsEditable();
    await this.db.tx.payrollVariable.deleteMany({ where: { id: variableId, periodId: row.periodId } });
    await this.runs.save(aggregate);
  }
}

@Injectable()
export class PayrollRunQueries {
  constructor(
    private readonly db: Database,
    private readonly actors: ActorContext,
  ) {}

  private present(run: Prisma.PayrollRunGetPayload<{ include: { period: true } }>) {
    const alerts = (run.alerts as unknown as PayslipAlert[] | null) ?? [];
    return {
      id: run.id,
      name: runName(run.runType, run.period.year, run.period.month),
      runType: run.runType,
      status: run.status,
      period: { id: run.periodId, year: run.period.year, month: run.period.month, paymentDate: isoDate(run.period.paymentDate) },
      totals: run.totals,
      blocking: alerts.filter((alert) => alert.severity === 'blocking').length,
      warnings: alerts.filter((alert) => alert.severity === 'warning').length,
      legalTables: run.legalTablesSnapshot,
      calculatedAt: run.calculatedAt,
      approvedAt: run.approvedAt,
      paidAt: run.paidAt,
      closedAt: run.closedAt,
    };
  }

  async list() {
    const actor = this.actors.current;
    authorize(actor, 'payroll.read');
    const runs = await this.db.tx.payrollRun.findMany({ where: { companyId: actor.companyId }, include: { period: true }, orderBy: [{ period: { year: 'desc' } }, { period: { month: 'desc' } }, { createdAt: 'desc' }] });
    return runs.map((run) => this.present(run));
  }

  async get(runId: string) {
    const actor = this.actors.current;
    authorize(actor, 'payroll.read');
    const run = await this.db.tx.payrollRun.findFirst({ where: { id: runId, companyId: actor.companyId }, include: { period: true } });
    if (!run) throw new NotFoundError('Processamento', runId);
    const previous = await this.db.tx.payrollRun.findFirst({
      where: { companyId: actor.companyId, runType: run.runType, id: { not: run.id }, createdAt: { lt: run.createdAt }, status: { in: ['APPROVED', 'PAID', 'CLOSED'] } },
      include: { period: true },
      orderBy: { createdAt: 'desc' },
    });
    return { ...this.present(run), previous: previous ? { id: previous.id, name: runName(previous.runType, previous.period.year, previous.period.month), totals: previous.totals } : null };
  }

  async alerts(runId: string) {
    authorize(this.actors.current, 'payroll.read');
    const run = await this.db.tx.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundError('Processamento', runId);
    return (run.alerts as unknown as PayslipAlert[] | null) ?? [];
  }

  async periods() {
    const actor = this.actors.current;
    authorize(actor, 'payroll.read');
    const periods = await this.db.tx.payrollPeriod.findMany({ where: { companyId: actor.companyId }, orderBy: [{ year: 'desc' }, { month: 'desc' }], include: { runs: { select: { id: true, runType: true, status: true } } } });
    return periods.map((period) => ({ ...period, startDate: isoDate(period.startDate), endDate: isoDate(period.endDate), paymentDate: isoDate(period.paymentDate) }));
  }

  /** Six-month evolution of gross and net (dashboard and payroll page). */
  async trend(months = 6) {
    const actor = this.actors.current;
    authorize(actor, 'payroll.read');
    const runs = await this.db.tx.payrollRun.findMany({ where: { companyId: actor.companyId, runType: 'REGULAR', status: { not: 'DRAFT' } }, include: { period: true }, orderBy: [{ period: { year: 'desc' } }, { period: { month: 'desc' } }], take: months });
    return runs.reverse().map((run) => {
      const totals = (run.totals ?? {}) as Record<string, string>;
      return { year: run.period.year, month: run.period.month, gross: totals.gross ?? '0.00', net: totals.net ?? '0.00', employerCost: totals.employerCost ?? '0.00' };
    });
  }
}
