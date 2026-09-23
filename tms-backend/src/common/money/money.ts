import { Decimal } from 'decimal.js';
import type { ColumnOptions } from 'typeorm';

/** Money crosses every boundary as a string: DTOs, JSON, and the database. */
export type Money = string;

/** Basis points are whole numbers; 10000 bps = 100%. */
export type BasisPoints = number;

const PRECISION = 38;
const SCALE = 18;
const BASIS_POINTS_DIVISOR = 10_000;

// Enough significant digits that numeric(38, 18) never rounds on the way in.
Decimal.set({ precision: PRECISION, rounding: Decimal.ROUND_HALF_UP });

/** Spread into `@Column` so every monetary column is declared identically. */
export const moneyColumn: ColumnOptions = {
  type: 'numeric',
  precision: PRECISION,
  scale: SCALE,
};

export function toDecimal(value: Money): Decimal {
  let decimal: Decimal;

  // decimal.js throws its own DecimalError; restate it in the caller's terms.
  try {
    decimal = new Decimal(value);
  } catch {
    throw new Error(`Not a finite monetary value: ${value}`);
  }

  if (!decimal.isFinite()) {
    throw new Error(`Not a finite monetary value: ${value}`);
  }

  return decimal;
}

/** Always full scale, so equal amounts have equal strings. */
export function toMoney(value: Decimal): Money {
  return value.toFixed(SCALE);
}

export function addMoney(a: Money, b: Money): Money {
  return toMoney(toDecimal(a).plus(toDecimal(b)));
}

export function subtractMoney(a: Money, b: Money): Money {
  return toMoney(toDecimal(a).minus(toDecimal(b)));
}

export function negateMoney(value: Money): Money {
  return toMoney(toDecimal(value).negated());
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  return toDecimal(a).comparedTo(toDecimal(b)) as -1 | 0 | 1;
}

export function isZeroMoney(value: Money): boolean {
  return toDecimal(value).isZero();
}

export function isNegativeMoney(value: Money): boolean {
  return toDecimal(value).isNegative();
}

/** Margins and fees are quoted in basis points, never as a float rate. */
export function applyBasisPoints(amount: Money, basisPoints: BasisPoints): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new Error(`Basis points must be an integer: ${basisPoints}`);
  }

  return toMoney(toDecimal(amount).times(basisPoints).dividedBy(BASIS_POINTS_DIVISOR));
}
