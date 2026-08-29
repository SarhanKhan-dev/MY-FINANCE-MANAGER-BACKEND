import { cycleFor, daysBetween, parseDateOnly, pktToday } from './cycle';

describe('budget cycle math (Asia/Karachi, UTC+5)', () => {
  it('computes the PKT calendar date, rolling over at 19:00 UTC', () => {
    expect(pktToday(new Date('2026-08-28T18:59:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-08-28',
    );
    expect(pktToday(new Date('2026-08-28T19:00:00Z')).toISOString().slice(0, 10)).toBe(
      '2026-08-29',
    );
  });

  it('runs a day-1 cycle over the calendar month', () => {
    const cycle = cycleFor(1, new Date('2026-08-15T10:00:00Z'));
    expect(cycle.key).toBe('2026-08-01');
    expect(cycle.end.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('starts a day-5 cycle in the previous month before the 5th', () => {
    const cycle = cycleFor(5, new Date('2026-08-03T10:00:00Z'));
    expect(cycle.key).toBe('2026-07-05');
    expect(cycle.end.toISOString().slice(0, 10)).toBe('2026-08-05');
  });

  it('starts a day-5 cycle in the current month on and after the 5th', () => {
    const onStart = cycleFor(5, new Date('2026-08-05T10:00:00Z'));
    expect(onStart.key).toBe('2026-08-05');
    const later = cycleFor(5, new Date('2026-08-28T10:00:00Z'));
    expect(later.key).toBe('2026-08-05');
    expect(later.end.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('crosses year boundaries', () => {
    const cycle = cycleFor(15, new Date('2026-01-03T10:00:00Z'));
    expect(cycle.key).toBe('2025-12-15');
    expect(cycle.end.toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('counts days between date-only values', () => {
    expect(daysBetween(parseDateOnly('2026-08-01'), parseDateOnly('2026-08-31'))).toBe(30);
    expect(daysBetween(parseDateOnly('2026-08-01'), parseDateOnly('2026-08-01'))).toBe(0);
  });
});
