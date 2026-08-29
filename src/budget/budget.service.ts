import { Injectable } from '@nestjs/common';
import { Currency, TransactionType } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetCycle, cycleFor, daysBetween, pktToday } from './cycle';

const THRESHOLDS = [50, 80, 90, 100];

export interface BudgetStatus {
  cycleStart: string;
  cycleEnd: string;
  capPkr: number;
  spentPkr: number;
  remainingPkr: number;
  pct: number;
  daysLeft: number;
  dailyPacePkr: number;
  safePacePkr: number;
}

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async current(userId: string): Promise<BudgetStatus> {
    const settings = await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const cycle = cycleFor(settings.budgetCycleStartDay);
    const spent = await this.spentInCycle(userId, cycle);
    const cap = Number(settings.budgetCapPkr);
    const remaining = cap - spent;

    const today = pktToday();
    const daysElapsed = Math.max(1, daysBetween(cycle.start, today) + 1);
    const daysLeft = Math.max(0, daysBetween(today, cycle.end));

    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      cycleStart: cycle.key,
      cycleEnd: cycle.end.toISOString().slice(0, 10),
      capPkr: round(cap),
      spentPkr: round(spent),
      remainingPkr: round(remaining),
      pct: cap > 0 ? round((spent / cap) * 100) : 0,
      daysLeft,
      dailyPacePkr: round(spent / daysElapsed),
      safePacePkr: daysLeft > 0 ? round(Math.max(0, remaining) / daysLeft) : 0,
    };
  }

  /** Records newly crossed thresholds for this cycle; each fires once per cycle. */
  async checkAlerts(userId: string): Promise<number[]> {
    const status = await this.current(userId);
    const crossed = THRESHOLDS.filter((threshold) => status.pct >= threshold);
    if (crossed.length === 0) return [];

    const existing = await this.prisma.alertLog.findMany({
      where: { userId, cycleKey: status.cycleStart, threshold: { in: crossed } },
      select: { threshold: true },
    });
    const alreadyFired = new Set(existing.map((row) => row.threshold));
    const fresh = crossed.filter((threshold) => !alreadyFired.has(threshold));
    if (fresh.length === 0) return [];

    await this.prisma.alertLog.createMany({
      data: fresh.map((threshold) => ({ userId, cycleKey: status.cycleStart, threshold })),
      skipDuplicates: true,
    });
    for (const threshold of fresh) {
      await this.events.record({
        userId,
        type: EventTypes.BUDGET_THRESHOLD_CROSSED,
        entityType: 'Budget',
        after: { cycle: status.cycleStart, threshold, spentPkr: status.spentPkr },
      });
    }
    return fresh;
  }

  private async spentInCycle(userId: string, cycle: BudgetCycle): Promise<number> {
    const expenses = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        date: { gte: cycle.start, lt: cycle.end },
      },
      select: { amount: true, currency: true, fxRate: true },
    });
    let total = 0;
    for (const expense of expenses) {
      if (expense.currency === Currency.PKR) {
        total += Number(expense.amount);
      } else if (expense.fxRate) {
        total += Number(expense.amount) * Number(expense.fxRate);
      }
    }
    return total;
  }
}
