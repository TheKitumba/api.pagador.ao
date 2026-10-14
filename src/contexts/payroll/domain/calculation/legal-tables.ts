import Decimal from 'decimal.js';

/** Shapes of the versioned legal tables used by the engine (docs/02; docs/06 LegalTable.data). */

export interface IrtBracket {
  /** Lower bound (exclusive, except the first bracket). */
  from: number;
  /** Upper bound (inclusive), null = no limit. */
  to: number | null;
  fixed: number;
  rate: number;
  excessOver: number;
}

export interface SocialSecurityRates {
  employeeRate: number;
  employerRate: number;
}

export interface OvertimeRates {
  weekday: number;
  restDay: number;
  holiday: number;
  night: number;
  monthlyLimitHours: number;
  annualLimitHours: number;
}

export interface LegalParameters {
  irt: { version: string; brackets: IrtBracket[] };
  socialSecurity: { version: string } & SocialSecurityRates;
  overtime: { version: string } & OvertimeRates;
  minimumWage: { version: string; amount: number } | null;
  /** Share of the net pay that can be used for loans/garnishments (impenhorável = the rest). */
  maxDeductibleRatio: number;
}

/** IRT Group A (docs/02, 2.3.3): IRT = fixed + (base − excessOver) × rate. */
export function irtFor(taxableBase: Decimal, brackets: IrtBracket[]): { irt: Decimal; bracket: number; trace: string } {
  if (taxableBase.lessThanOrEqualTo(0)) return { irt: new Decimal(0), bracket: 1, trace: 'Matéria colectável nula' };
  const sorted = [...brackets].sort((a, b) => a.from - b.from);
  const index = Math.max(
    0,
    sorted.findIndex((bracket) => taxableBase.greaterThan(bracket.from) && (bracket.to === null || taxableBase.lessThanOrEqualTo(bracket.to))),
  );
  const bracket = sorted[index];
  if (bracket.rate === 0) return { irt: new Decimal(0), bracket: index + 1, trace: `Escalão ${index + 1}: isento` };
  const irt = new Decimal(bracket.fixed).plus(taxableBase.minus(bracket.excessOver).times(bracket.rate));
  return {
    irt: irt.toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    bracket: index + 1,
    trace: `Escalão ${index + 1}: ${bracket.fixed} + (${taxableBase.toFixed(2)} − ${bracket.excessOver}) × ${new Decimal(bracket.rate).times(100).toString()}%`,
  };
}
