import Decimal from 'decimal.js';

import { evaluateFormula, parseFormula } from './formula';
import { irtFor, type LegalParameters } from './legal-tables';

/**
 * Payroll engine (docs/04, 4.4). Pure and deterministic: no database, network or clock.
 * Same inputs → same payslip, with a trace that explains every amount.
 */

export type LineKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CHARGE' | 'INFORMATIVE';

export interface PayItemDefinition {
  id: string;
  code: string;
  name: string;
  kind: LineKind;
  nature: 'FIXED' | 'VARIABLE' | 'CALCULATED';
  formula: string | null;
  irtSubject: boolean;
  irtExemptionLimit: string | null;
  ssSubject: boolean;
  holidayAllowance: boolean;
  christmasAllowance: boolean;
  proportional: boolean;
  calculationOrder: number;
}

export type RunType = 'REGULAR' | 'HOLIDAY_ALLOWANCE' | 'CHRISTMAS_ALLOWANCE' | 'BONUS' | 'RETRO' | 'SUPPLEMENTARY' | 'FINAL_SETTLEMENT';

export interface PeriodInput {
  year: number;
  month: number;
  start: Date;
  end: Date;
  workingDays: number;
  runType: RunType;
}

export interface EmployeePayInput {
  employeeId: string;
  name: string;
  nif: string | null;
  socialSecurityNumber: string | null;
  hireDate: Date;
  dependents: number;
  contract: { baseSalary: string; weeklyHours: string; startDate: Date; endDate: Date | null; terminationDate: Date | null; paymentMethod: string };
  fixedItems: { payItemId: string; amount: string }[];
  variables: { payItemId: string; quantity: string | null; amount: string | null }[];
  attendance: { unjustifiedAbsenceDays: number; unpaidLeaveDays: number; overtimeHours: { WEEKDAY: number; REST_DAY: number; HOLIDAY: number; NIGHT: number } };
  /** Active loans, advances and garnishments, in legal priority order is applied by the engine. */
  deductions: { id: string; type: 'GARNISHMENT' | 'LOAN' | 'ADVANCE'; installment: string; balance: string }[];
  reimbursements: { id: string; amount: string; description: string }[];
  hasValidIban: boolean;
  previousNet: string | null;
}

export interface CalculatedLine {
  code: string;
  description: string;
  kind: LineKind;
  quantity: string | null;
  amount: string;
  taxableAmount: string;
  ssAmount: string;
  source: 'CONTRACT' | 'VARIABLE' | 'FORMULA' | 'ATTENDANCE' | 'LOAN' | 'STATUTORY' | 'EXPENSE';
  trace: string;
}

export type AlertSeverity = 'blocking' | 'warning' | 'info';

export interface PayslipAlert {
  severity: AlertSeverity;
  code: string;
  message: string;
}

export interface PayslipResult {
  employeeId: string;
  lines: CalculatedLine[];
  gross: string;
  ssBase: string;
  ssEmployee: string;
  ssEmployer: string;
  irtTaxable: string;
  irtBase: string;
  irt: string;
  totalDeductions: string;
  net: string;
  employerCost: string;
  alerts: PayslipAlert[];
  /** Applied loan installments, so the loans can be updated when the run is approved. */
  appliedDeductions: { id: string; amount: string }[];
  trace: Record<string, unknown>;
}

const D = (value: Decimal.Value) => new Decimal(value);
const r2 = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const fmt = (value: Decimal) => value.toFixed(2);
const DAY_MS = 86_400_000;
const NET_VARIATION_ALERT = 0.2;

const DEDUCTION_PRIORITY = { GARNISHMENT: 0, LOAN: 1, ADVANCE: 2 } as const;
const DEDUCTION_LINE = {
  GARNISHMENT: { code: 'D030', description: 'Penhora judicial' },
  LOAN: { code: 'D021', description: 'Prestação de empréstimo' },
  ADVANCE: { code: 'D020', description: 'Adiantamento salarial' },
} as const;

export function calculatePayslip(employee: EmployeePayInput, period: PeriodInput, payItems: PayItemDefinition[], legal: LegalParameters): PayslipResult {
  const lines: (CalculatedLine & { value: Decimal; reducesGross?: boolean })[] = [];
  const alerts: PayslipAlert[] = [];
  const byId = new Map(payItems.map((item) => [item.id, item]));
  const byCode = new Map(payItems.map((item) => [item.code, item]));
  const amountsByCode = new Map<string, Decimal>();

  // 1–2. Reference values ------------------------------------------------------
  const base = D(employee.contract.baseSalary);
  const weeklyHours = D(employee.contract.weeklyHours);
  const dayValue = base.dividedBy(30);
  const hourValue = base.times(12).dividedBy(D(52).times(weeklyHours));

  const employedFrom = new Date(Math.max(period.start.getTime(), employee.contract.startDate.getTime(), employee.hireDate.getTime()));
  const endCandidates = [period.end.getTime(), employee.contract.endDate?.getTime(), employee.contract.terminationDate?.getTime()].filter((value): value is number => value !== undefined);
  const employedTo = new Date(Math.min(...endCandidates));
  const fullMonth = employedFrom.getTime() === period.start.getTime() && employedTo.getTime() === period.end.getTime();
  const daysEmployed = fullMonth ? 30 : Math.max(0, Math.min(30, Math.round((employedTo.getTime() - employedFrom.getTime()) / DAY_MS) + 1));
  const fraction = D(daysEmployed).dividedBy(30);

  const addLine = (item: { code: string; name: string; kind: LineKind; irtSubject?: boolean; irtExemptionLimit?: string | null; ssSubject?: boolean }, rawAmount: Decimal, source: CalculatedLine['source'], trace: string, quantity: string | null = null, reducesGross = false) => {
    const value = r2(rawAmount);
    if (value.isZero()) return;
    const taxable = item.kind === 'EARNING' && item.irtSubject ? Decimal.max(0, value.minus(item.irtExemptionLimit ? D(item.irtExemptionLimit) : 0)) : D(0);
    const ss = item.kind === 'EARNING' && item.ssSubject ? value : D(0);
    lines.push({ code: item.code, description: item.name, kind: item.kind, quantity, amount: fmt(value), taxableAmount: fmt(taxable), ssAmount: fmt(ss), source, trace, value, reducesGross });
    amountsByCode.set(item.code, (amountsByCode.get(item.code) ?? D(0)).plus(value));
  };
  const statutory = (code: string, fallback: { name: string; kind: LineKind; irtSubject?: boolean; ssSubject?: boolean; irtExemptionLimit?: string | null }) => {
    const definition = byCode.get(code);
    return definition ? { ...definition } : { code, irtSubject: true, ssSubject: true, irtExemptionLimit: null, ...fallback };
  };

  const formulaVariables = {
    'contrato.salario_base': base,
    'contrato.horas_semanais': weeklyHours,
    'trabalhador.antiguidade_anos': D(Math.floor((period.end.getTime() - employee.hireDate.getTime()) / (365.25 * DAY_MS))),
    'trabalhador.n_dependentes': D(employee.dependents),
    'periodo.dias_uteis': D(period.workingDays),
    'periodo.dias_trabalhados': D(daysEmployed),
    'assiduidade.horas_extra_util': D(employee.attendance.overtimeHours.WEEKDAY),
    'assiduidade.horas_extra_descanso': D(employee.attendance.overtimeHours.REST_DAY),
    'assiduidade.horas_extra_feriado': D(employee.attendance.overtimeHours.HOLIDAY),
    'assiduidade.horas_nocturnas': D(employee.attendance.overtimeHours.NIGHT),
    'assiduidade.faltas_injustificadas': D(employee.attendance.unjustifiedAbsenceDays),
    'assiduidade.dias_trabalhados': D(Math.max(0, period.workingDays - employee.attendance.unjustifiedAbsenceDays - employee.attendance.unpaidLeaveDays)),
  };
  const evaluate = (formula: string, quantity?: Decimal) =>
    evaluateFormula(parseFormula(formula), {
      variables: { ...formulaVariables, quantidade: quantity ?? D(0) },
      payItem: (code) => amountsByCode.get(code) ?? D(0),
      table: (name) => (name === 'salario_minimo' && legal.minimumWage ? D(legal.minimumWage.amount) : D(0)),
    });

  // 3. Earnings --------------------------------------------------------------------------
  if (period.runType === 'HOLIDAY_ALLOWANCE' || period.runType === 'CHRISTMAS_ALLOWANCE') {
    const holiday = period.runType === 'HOLIDAY_ALLOWANCE';
    const baseItem = byCode.get('R001');
    const included = [
      ...(baseItem ? [{ code: 'R001', amount: base, flagged: holiday ? baseItem.holidayAllowance : baseItem.christmasAllowance }] : [{ code: 'R001', amount: base, flagged: true }]),
      ...employee.fixedItems.map((fixed) => {
        const definition = byId.get(fixed.payItemId);
        return { code: definition?.code ?? '?', amount: D(fixed.amount), flagged: Boolean(definition && (holiday ? definition.holidayAllowance : definition.christmasAllowance)) };
      }),
    ].filter((item) => item.flagged);
    const allowanceBase = included.reduce((sum, item) => sum.plus(item.amount), D(0));
    const code = holiday ? 'R030' : 'R031';
    addLine(statutory(code, { name: holiday ? 'Subsídio de férias' : 'Subsídio de Natal', kind: 'EARNING' }), allowanceBase.times(0.5), 'STATUTORY', `50% × (${included.map((item) => item.code).join(' + ')}) = 50% × ${fmt(allowanceBase)}`);
  } else {
    addLine(
      statutory('R001', { name: 'Vencimento base', kind: 'EARNING' }),
      base.times(fraction),
      'CONTRACT',
      fullMonth ? 'Valor do contrato vigente' : `${fmt(base)} × ${daysEmployed}/30 dias (admissão/cessação no período)`,
      fullMonth ? null : `${daysEmployed} dias`,
    );

    for (const fixed of employee.fixedItems) {
      const definition = byId.get(fixed.payItemId);
      if (!definition || definition.code === 'R001') continue;
      const amount = definition.proportional ? D(fixed.amount).times(fraction) : D(fixed.amount);
      addLine(definition, amount, 'CONTRACT', definition.proportional && !fullMonth ? `${fixed.amount} × ${daysEmployed}/30` : 'Valor fixo do contrato');
    }

    const overtime = employee.attendance.overtimeHours;
    const overtimeLines: [keyof typeof overtime, string, string, number][] = [
      ['WEEKDAY', 'R020', 'Horas extra — dia útil', legal.overtime.weekday],
      ['REST_DAY', 'R021', 'Horas extra — descanso semanal', legal.overtime.restDay],
      ['HOLIDAY', 'R021', 'Horas extra — feriado', legal.overtime.holiday],
      ['NIGHT', 'R022', 'Trabalho nocturno', legal.overtime.night],
    ];
    for (const [kind, code, label, rate] of overtimeLines) {
      const hours = overtime[kind];
      if (hours > 0) {
        const definition = statutory(code, { name: label, kind: 'EARNING' });
        addLine({ ...definition, name: label }, hourValue.times(rate).times(hours), 'ATTENDANCE', `valor_hora() × ${rate} × ${hours} = ${hourValue.toFixed(4)} × ${rate} × ${hours}`, `${hours} h`);
      }
    }

    for (const variable of employee.variables) {
      const definition = byId.get(variable.payItemId);
      if (!definition || definition.kind !== 'EARNING') continue;
      const quantity = variable.quantity ? D(variable.quantity) : undefined;
      const amount = variable.amount ? D(variable.amount) : definition.formula ? evaluate(definition.formula, quantity) : D(0);
      addLine(definition, amount, 'VARIABLE', variable.amount ? 'Lançamento do período' : `${definition.formula} (quantidade ${variable.quantity})`, variable.quantity);
    }

    const calculated = payItems.filter((item) => item.nature === 'CALCULATED' && item.formula && item.kind === 'EARNING').sort((a, b) => a.calculationOrder - b.calculationOrder);
    for (const definition of calculated) addLine(definition, evaluate(definition.formula!), 'FORMULA', definition.formula!);

    for (const reimbursement of employee.reimbursements) {
      addLine(statutory('R051', { name: 'Reembolso de despesas', kind: 'EARNING', irtSubject: false, ssSubject: false }), D(reimbursement.amount), 'EXPENSE', reimbursement.description);
    }

    // Absences reduce pay, the SS base and the IRT base (docs/04, 4.6).
    if (employee.attendance.unjustifiedAbsenceDays > 0) {
      const days = employee.attendance.unjustifiedAbsenceDays;
      addLine(statutory('D010', { name: 'Faltas injustificadas', kind: 'DEDUCTION' }), dayValue.times(days).negated(), 'ATTENDANCE', `valor_dia() × ${days} = ${fmt(base)} / 30 × ${days}`, `${days} ${days === 1 ? 'dia' : 'dias'}`, true);
    }
    if (employee.attendance.unpaidLeaveDays > 0) {
      const days = employee.attendance.unpaidLeaveDays;
      addLine(statutory('D012', { name: 'Licença sem vencimento', kind: 'DEDUCTION' }), dayValue.times(days).negated(), 'ATTENDANCE', `valor_dia() × ${days}`, `${days} dias`, true);
    }
  }

  // 4–5. Social security ---------------------------------------------------------
  const earnings = lines.filter((line) => line.kind === 'EARNING');
  const grossReductions = lines.filter((line) => line.reducesGross);
  const reductionTotal = grossReductions.reduce((sum, line) => sum.plus(line.value), D(0));
  const gross = earnings.reduce((sum, line) => sum.plus(line.value), D(0)).plus(reductionTotal);
  const ssBase = Decimal.max(0, earnings.reduce((sum, line) => sum.plus(line.ssAmount), D(0)).plus(reductionTotal));
  const ssEmployee = r2(ssBase.times(legal.socialSecurity.employeeRate));
  const ssEmployer = r2(ssBase.times(legal.socialSecurity.employerRate));
  addLine(statutory('D001', { name: `Segurança Social (${legal.socialSecurity.employeeRate * 100}%)`, kind: 'DEDUCTION' }), ssEmployee.negated(), 'STATUTORY', `Base de incidência ${fmt(ssBase)} × ${legal.socialSecurity.employeeRate * 100}%`);

  // 6–7. IRT -------------------------------------------------------------------------
  const irtTaxable = Decimal.max(0, earnings.reduce((sum, line) => sum.plus(line.taxableAmount), D(0)).plus(reductionTotal));
  const irtBase = Decimal.max(0, irtTaxable.minus(ssEmployee));
  const irt = irtFor(irtBase, legal.irt.brackets);
  addLine(statutory('D002', { name: `IRT — Grupo A, escalão ${irt.bracket}`, kind: 'DEDUCTION' }), irt.irt.negated(), 'STATUTORY', irt.trace);

  // Other authorised deductions entered for the period (union fees, insurance co-payment…)
  for (const variable of employee.variables) {
    const definition = byId.get(variable.payItemId);
    if (!definition || definition.kind !== 'DEDUCTION' || !variable.amount) continue;
    addLine(definition, D(variable.amount).negated(), 'VARIABLE', 'Lançamento do período');
  }

  // 8. Loans, advances and garnishments, respecting the non-attachable share ------------
  const deductionsSoFar = lines.filter((line) => line.kind === 'DEDUCTION' && !line.reducesGross).reduce((sum, line) => sum.plus(line.value.abs()), D(0));
  const netBeforeLoans = gross.minus(deductionsSoFar);
  let available = Decimal.max(0, netBeforeLoans.times(legal.maxDeductibleRatio));
  const appliedDeductions: { id: string; amount: string }[] = [];
  for (const deduction of [...employee.deductions].sort((a, b) => DEDUCTION_PRIORITY[a.type] - DEDUCTION_PRIORITY[b.type])) {
    const due = Decimal.min(D(deduction.installment), D(deduction.balance));
    if (due.lessThanOrEqualTo(0)) continue;
    const meta = DEDUCTION_LINE[deduction.type];
    if (due.greaterThan(available)) {
      alerts.push({ severity: 'warning', code: 'deduction_postponed', message: `${meta.description} adiada: excede a parte penhorável do vencimento` });
      continue;
    }
    addLine(statutory(meta.code, { name: meta.description, kind: 'DEDUCTION' }), due.negated(), 'LOAN', `Prestação ${fmt(due)} (saldo ${deduction.balance})`);
    appliedDeductions.push({ id: deduction.id, amount: fmt(due) });
    available = available.minus(due);
  }

  // Employer charges -----------------------------------------------------------------
  addLine(statutory('E001', { name: `Segurança Social — entidade empregadora (${legal.socialSecurity.employerRate * 100}%)`, kind: 'EMPLOYER_CHARGE' }), ssEmployer, 'STATUTORY', `Base de incidência ${fmt(ssBase)} × ${legal.socialSecurity.employerRate * 100}%`);

  // 9. Totals --------------------------------------------------------------------------
  const totalDeductions = lines.filter((line) => line.kind === 'DEDUCTION' && !line.reducesGross).reduce((sum, line) => sum.plus(line.value.abs()), D(0));
  const net = gross.minus(totalDeductions);
  const employerCharges = lines.filter((line) => line.kind === 'EMPLOYER_CHARGE').reduce((sum, line) => sum.plus(line.value), D(0));

  // 10. Validations (docs/04, 4.7) -------------------------------------------------
  if (net.isNegative()) alerts.push({ severity: 'blocking', code: 'negative_net', message: 'Líquido negativo' });
  if (employee.contract.paymentMethod === 'BANK_TRANSFER' && !employee.hasValidIban) alerts.push({ severity: 'blocking', code: 'invalid_iban', message: 'Pagamento por transferência sem IBAN válido' });
  if (legal.minimumWage && weeklyHours.greaterThanOrEqualTo(40) && base.lessThan(legal.minimumWage.amount)) alerts.push({ severity: 'warning', code: 'below_minimum_wage', message: 'Vencimento base abaixo do salário mínimo' });
  if (!employee.nif) alerts.push({ severity: 'warning', code: 'missing_nif', message: 'Trabalhador sem NIF' });
  if (!employee.socialSecurityNumber) alerts.push({ severity: 'warning', code: 'missing_ss_number', message: 'Trabalhador sem n.º de Segurança Social' });
  if (employee.previousNet && D(employee.previousNet).greaterThan(0) && period.runType === 'REGULAR') {
    const variation = net.minus(employee.previousNet).dividedBy(employee.previousNet);
    if (variation.abs().greaterThan(NET_VARIATION_ALERT)) {
      alerts.push({ severity: 'warning', code: 'net_variation', message: `Variação do líquido de ${variation.times(100).toFixed(0)}% face ao processamento anterior` });
    }
  }
  const overtimeHours = Object.values(employee.attendance.overtimeHours).reduce((sum, hours) => sum + hours, 0);
  if (overtimeHours > legal.overtime.monthlyLimitHours) alerts.push({ severity: 'warning', code: 'overtime_limit', message: `Horas extra acima do limite legal (${overtimeHours} h no mês)` });
  if (employee.hireDate >= period.start && employee.hireDate <= period.end) alerts.push({ severity: 'info', code: 'hired_in_period', message: 'Admissão no período' });
  if (employee.contract.terminationDate && employee.contract.terminationDate <= period.end) alerts.push({ severity: 'info', code: 'terminated_in_period', message: 'Cessação no período' });

  return {
    employeeId: employee.employeeId,
    lines: lines.map(({ value: _value, reducesGross: _reduces, ...line }) => line),
    gross: fmt(gross),
    ssBase: fmt(ssBase),
    ssEmployee: fmt(ssEmployee),
    ssEmployer: fmt(ssEmployer),
    irtTaxable: fmt(irtTaxable),
    irtBase: fmt(irtBase),
    irt: fmt(irt.irt),
    totalDeductions: fmt(totalDeductions),
    net: fmt(net),
    employerCost: fmt(gross.plus(employerCharges)),
    alerts,
    appliedDeductions,
    trace: {
      inputs: { baseSalary: fmt(base), weeklyHours: weeklyHours.toString(), daysEmployed, dayValue: dayValue.toFixed(4), hourValue: hourValue.toFixed(4), attendance: employee.attendance },
      legalTables: { irt: legal.irt.version, socialSecurity: legal.socialSecurity.version, overtime: legal.overtime.version, minimumWage: legal.minimumWage?.version ?? null },
      bases: { ssBase: fmt(ssBase), irtTaxable: fmt(irtTaxable), irtBase: fmt(irtBase), irtBracket: irt.bracket },
    },
  };
}
