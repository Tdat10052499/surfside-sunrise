// Money is always an integer number of cents. Never use floats for amounts.

export type Cents = number;

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents, got ${value}`);
  }
  return value;
}

/** Percentage of an amount in basis points (1100 = 11%), rounded half up to the cent. */
export function percentOf(amount: Cents, basisPoints: number): Cents {
  assertCents(amount);
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new RangeError(`basisPoints must be a non-negative integer, got ${basisPoints}`);
  }
  return Math.floor((amount * basisPoints + 5_000) / 10_000);
}

export function formatUsd(amount: Cents): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
}
