const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BudgetCycle {
  /** inclusive start, as a UTC-midnight date */
  start: Date;
  /** exclusive end, as a UTC-midnight date */
  end: Date;
  /** YYYY-MM-DD of the start — used to dedupe alerts per cycle */
  key: string;
}

/** The user's current PKT calendar date, normalized to UTC midnight. */
export function pktToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()),
  );
}

/** Parse a YYYY-MM-DD string to a UTC-midnight date. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The budget cycle containing the given PKT day. Cycles run from the user's
 * chosen start day (1-28) to the day before the next cycle's start.
 */
export function cycleFor(startDay: number, now: Date = new Date()): BudgetCycle {
  const today = pktToday(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  let start = new Date(Date.UTC(year, month, startDay));
  if (today.getUTCDate() < startDay) {
    start = new Date(Date.UTC(year, month - 1, startDay));
  }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, startDay));

  return { start, end, key: toDateKey(start) };
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}
