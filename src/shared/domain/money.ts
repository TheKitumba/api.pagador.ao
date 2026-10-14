import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalInput = Decimal.Value | { toString(): string };

const toDecimal = (value: DecimalInput) => new Decimal(typeof value === 'object' && !(value instanceof Decimal) ? value.toString() : (value as Decimal.Value));

/**
 * Exact monetary amount in Kwanza (or another ISO 4217 currency). Never uses floating point.
 * Rounding is commercial (half up) to cents, as required by docs/04 (4.4).
 */
export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: string,
  ) {}

  static of(value: DecimalInput, currency = 'AOA') {
    return new Money(toDecimal(value), currency);
  }

  static zero(currency = 'AOA') {
    return new Money(new Decimal(0), currency);
  }

  add(other: Money | DecimalInput) {
    return new Money(this.amount.plus(other instanceof Money ? other.amount : toDecimal(other)), this.currency);
  }

  subtract(other: Money | DecimalInput) {
    return new Money(this.amount.minus(other instanceof Money ? other.amount : toDecimal(other)), this.currency);
  }

  multiply(factor: DecimalInput) {
    return new Money(this.amount.times(toDecimal(factor)), this.currency);
  }

  divide(divisor: DecimalInput) {
    return new Money(this.amount.dividedBy(toDecimal(divisor)), this.currency);
  }

  /** Rounded to cents (half up). */
  round() {
    return new Money(this.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), this.currency);
  }

  max(other: Money) {
    return this.amount.greaterThanOrEqualTo(other.amount) ? this : other;
  }

  isNegative() {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  isZero() {
    return this.amount.isZero();
  }

  greaterThan(other: Money | DecimalInput) {
    return this.amount.greaterThan(other instanceof Money ? other.amount : toDecimal(other));
  }

  lessThan(other: Money | DecimalInput) {
    return this.amount.lessThan(other instanceof Money ? other.amount : toDecimal(other));
  }

  /** "371800.70" — the JSON/API representation of money (docs/07, 7.9). */
  toString() {
    return this.amount.toFixed(2);
  }

  toJSON() {
    return this.toString();
  }
}

export { Decimal };
