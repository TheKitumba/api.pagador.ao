/** Read-model formatting shared by query handlers (dates and money travel as strings, docs/09 9.6). */

/** YYYY-MM-DD from a Prisma @db.Date value. */
export function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Midnight UTC for a YYYY-MM-DD string. */
export function toDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Prisma Decimal → string with 2 decimals. */
export function decimal(value: { toFixed(digits: number): string } | null | undefined): string | null {
  return value ? value.toFixed(2) : null;
}
