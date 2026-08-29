import { RepeatRule, SubscriptionPeriod } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

function clampedMonthShift(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget)));
}

/** The due date after paying — null when a one-off is done. */
export function advanceDueDate(current: Date, repeat: RepeatRule): Date | null {
  switch (repeat) {
    case RepeatRule.WEEKLY:
      return new Date(current.getTime() + 7 * DAY_MS);
    case RepeatRule.MONTHLY:
      return clampedMonthShift(current, 1);
    case RepeatRule.ONCE:
      return null;
  }
}

export function advanceRenewal(current: Date, period: SubscriptionPeriod): Date {
  return period === SubscriptionPeriod.YEARLY
    ? clampedMonthShift(current, 12)
    : clampedMonthShift(current, 1);
}
