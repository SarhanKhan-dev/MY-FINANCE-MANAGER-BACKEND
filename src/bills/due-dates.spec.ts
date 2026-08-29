import { RepeatRule, SubscriptionPeriod } from '@prisma/client';
import { advanceDueDate, advanceRenewal } from './due-dates';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const key = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe('due date math', () => {
  it('moves a monthly bill one month forward', () => {
    expect(key(advanceDueDate(day('2026-08-05'), RepeatRule.MONTHLY))).toBe('2026-09-05');
  });

  it('clamps month-end due days instead of rolling over', () => {
    expect(key(advanceDueDate(day('2026-01-31'), RepeatRule.MONTHLY))).toBe('2026-02-28');
    expect(key(advanceDueDate(day('2026-01-31'), RepeatRule.MONTHLY))).not.toBe('2026-03-03');
  });

  it('moves a weekly bill seven days forward', () => {
    expect(key(advanceDueDate(day('2026-08-28'), RepeatRule.WEEKLY))).toBe('2026-09-04');
  });

  it('finishes a one-off bill', () => {
    expect(advanceDueDate(day('2026-08-28'), RepeatRule.ONCE)).toBeNull();
  });

  it('crosses year boundaries cleanly', () => {
    expect(key(advanceDueDate(day('2026-12-15'), RepeatRule.MONTHLY))).toBe('2027-01-15');
  });

  it('renews subscriptions monthly and yearly', () => {
    expect(key(advanceRenewal(day('2026-08-10'), SubscriptionPeriod.MONTHLY))).toBe('2026-09-10');
    expect(key(advanceRenewal(day('2026-08-10'), SubscriptionPeriod.YEARLY))).toBe('2027-08-10');
  });
});
