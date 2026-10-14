import type { TerminationReason } from '@prisma/client';

import { Money } from '@/shared/domain/money';

/**
 * Final settlement (docs/02, 2.2.8; docs/04, 4.10 "Acerto final de contas").
 * Pure domain service: default rates are parameters, validated by a labour lawyer before use.
 */
export interface SettlementInput {
  reason: TerminationReason;
  baseSalary: string;
  hireDate: Date;
  noticeDate: Date;
  lastDay: Date;
  /** Unused vacation days (entitled + carried over − taken). */
  unusedVacationDays: number;
  /** Outstanding loans and advances to deduct. */
  outstandingLoans: string;
  /** Required notice (days) when the employee resigns. */
  requiredNoticeDays?: number;
  /** Months of salary per year of service in objective dismissals (parametrisable). */
  compensationMonthsPerYear?: number;
}

export interface SettlementLine {
  code: string;
  description: string;
  amount: string;
  trace: string;
}

export interface Settlement {
  lines: SettlementLine[];
  total: string;
}

const monthsBetween = (from: Date, to: Date) => (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + (to.getUTCDate() >= from.getUTCDate() ? 0 : -1);

export function calculateFinalSettlement(input: SettlementInput): Settlement {
  const base = Money.of(input.baseSalary);
  const day = base.divide(30);
  const lines: SettlementLine[] = [];
  const add = (code: string, description: string, amount: Money, trace: string) => {
    const rounded = amount.round();
    if (!rounded.isZero()) lines.push({ code, description, amount: rounded.toString(), trace });
  };

  const daysWorked = input.lastDay.getUTCDate();
  add('R001', 'Vencimento dos dias trabalhados no mês', day.multiply(daysWorked), `${base} / 30 × ${daysWorked} dias`);

  add('R032', 'Férias vencidas e não gozadas', day.multiply(input.unusedVacationDays), `${base} / 30 × ${input.unusedVacationDays} dias`);

  const yearStart = new Date(Date.UTC(input.lastDay.getUTCFullYear(), 0, 1));
  const start = input.hireDate > yearStart ? input.hireDate : yearStart;
  const monthsThisYear = Math.min(12, Math.max(0, monthsBetween(start, input.lastDay) + 1));
  add('R030', 'Proporcional do subsídio de férias (50%)', base.multiply(0.5).multiply(monthsThisYear).divide(12), `${base} × 50% × ${monthsThisYear}/12`);
  add('R031', 'Proporcional do subsídio de Natal (50%)', base.multiply(0.5).multiply(monthsThisYear).divide(12), `${base} × 50% × ${monthsThisYear}/12`);

  const yearsOfService = Math.max(1, Math.floor(monthsBetween(input.hireDate, input.lastDay) / 12));
  if (input.reason === 'OBJECTIVE_DISMISSAL') {
    const months = input.compensationMonthsPerYear ?? 1;
    add('R060', 'Indemnização por despedimento por causas objectivas', base.multiply(months).multiply(yearsOfService), `${base} × ${months} × ${yearsOfService} anos de serviço`);
  }
  if (input.reason === 'CONTRACT_EXPIRY') {
    add('R061', 'Compensação por caducidade', base.multiply(0.5).multiply(yearsOfService), `${base} × 50% × ${yearsOfService} anos de serviço`);
  }

  if (input.reason === 'EMPLOYEE_RESIGNATION') {
    const required = input.requiredNoticeDays ?? 30;
    const given = Math.round((input.lastDay.getTime() - input.noticeDate.getTime()) / 86_400_000);
    const missing = Math.max(0, required - given);
    add('D060', 'Aviso prévio em falta', day.multiply(missing).multiply(-1), `${base} / 30 × ${missing} dias em falta (aviso de ${required} dias)`);
  }

  const loans = Money.of(input.outstandingLoans);
  add('D021', 'Saldo de empréstimos e adiantamentos', loans.multiply(-1), 'Saldo em dívida à data de cessação');

  const total = lines.reduce((sum, line) => sum.add(line.amount), Money.zero());
  return { lines, total: total.round().toString() };
}
