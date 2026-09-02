import { Injectable } from '@nestjs/common';
import { Currency, TransactionType } from '@prisma/client';
import { pktToday, toDateKey } from '../budget/cycle';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';

/** One frozen row per completed budget cycle, kept forever so the companion
 *  can say whether patterns actually corrected over 3/6/9/12 months. */

export interface SnapshotData {
  incomePkr: number;
  incomeUsd: number;
  spentPkr: number;
  spentUsd: number;
  savingsPkr: number;
  capPkr: number;
  capUsedPct: number;
  categories: { name: string; spentPkr: number }[];
  topShops: { name: string; totalPkr: number }[];
  debtsEnd: { iOwePkr: number; owedToMePkr: number; iOweUsd: number; owedToMeUsd: number };
  entries: number;
}

export interface SnapshotRow {
  cycleKey: string;
  cycleEnd: string;
  data: SnapshotData;
  report: string | null;
}

const OUT: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.REPAY_OUT,
  TransactionType.TAKEN,
  TransactionType.CHARITY,
  TransactionType.SALARY,
];
const OUT_IF_WALLET: TransactionType[] = [
  TransactionType.LEND,
  TransactionType.COMMITTEE_PAY,
  TransactionType.INVESTMENT_IN,
];
const IN: TransactionType[] = [
  TransactionType.INCOME,
  TransactionType.REPAY_IN,
  TransactionType.INVESTMENT_OUT,
];
const IN_IF_WALLET: TransactionType[] = [
  TransactionType.BORROW,
  TransactionType.COMMITTEE_PAYOUT,
];

const round2 = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class SnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  /** Cycle windows from the user's first entry up to (excluding) the running cycle. */
  async completedCycles(userId: string): Promise<{ start: Date; end: Date }[]> {
    const [settings, first] = await Promise.all([
      this.prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} }),
      this.prisma.transaction.findFirst({ where: { userId }, orderBy: { date: 'asc' } }),
    ]);
    if (!first) return [];
    const startDay = settings.budgetCycleStartDay;
    const today = pktToday();

    const cycleStartFor = (date: Date): Date => {
      let start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), startDay));
      if (date.getUTCDate() < startDay) {
        start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, startDay));
      }
      return start;
    };

    const currentStart = cycleStartFor(today);
    const windows: { start: Date; end: Date }[] = [];
    let start = cycleStartFor(first.date);
    while (start < currentStart) {
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, startDay));
      windows.push({ start, end });
      start = end;
    }
    return windows;
  }

  async compute(userId: string, start: Date, end: Date): Promise<SnapshotData> {
    const [rows, settings, categories] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId, date: { gte: start, lt: end } },
        select: {
          type: true,
          amount: true,
          currency: true,
          fromWalletId: true,
          toWalletId: true,
          merchant: { select: { name: true } },
        },
      }),
      this.prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} }),
      this.reports.categoryTotals(userId, toDateKey(start), toDateKey(end)),
    ]);

    let incomePkr = 0;
    let incomeUsd = 0;
    let spentPkr = 0;
    let spentUsd = 0;
    const shopTotals = new Map<string, number>();
    for (const row of rows) {
      const usd = row.currency === Currency.USD;
      const amount = Number(row.amount);
      const isOut =
        OUT.includes(row.type) ||
        (OUT_IF_WALLET.includes(row.type) && row.fromWalletId !== null);
      const isIn =
        IN.includes(row.type) ||
        (IN_IF_WALLET.includes(row.type) && row.toWalletId !== null);
      if (isOut) {
        if (usd) spentUsd += amount;
        else spentPkr += amount;
        if (row.type === TransactionType.EXPENSE && row.merchant && !usd) {
          shopTotals.set(row.merchant.name, (shopTotals.get(row.merchant.name) ?? 0) + amount);
        }
      }
      if (isIn) {
        if (usd) incomeUsd += amount;
        else incomePkr += amount;
      }
    }

    const debtsEnd = await this.debtsAt(userId, end);
    const capPkr = Number(settings.budgetCapPkr);
    const topShops = [...shopTotals.entries()]
      .map(([name, totalPkr]) => ({ name, totalPkr: round2(totalPkr) }))
      .sort((a, b) => b.totalPkr - a.totalPkr)
      .slice(0, 5);

    return {
      incomePkr: round2(incomePkr),
      incomeUsd: round2(incomeUsd),
      spentPkr: round2(spentPkr),
      spentUsd: round2(spentUsd),
      savingsPkr: round2(incomePkr - spentPkr),
      capPkr: round2(capPkr),
      capUsedPct: capPkr > 0 ? round2((spentPkr / capPkr) * 100) : 0,
      categories: categories.map((row) => ({ name: row.name, spentPkr: row.spentPkr })),
      topShops,
      debtsEnd,
      entries: rows.length,
    };
  }

  /** Debt position as of a date: same per-currency netting as DebtsService, windowed. */
  private async debtsAt(userId: string, before: Date): Promise<SnapshotData['debtsEnd']> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        personId: { not: null },
        date: { lt: before },
        type: {
          in: [
            TransactionType.BORROW,
            TransactionType.LEND,
            TransactionType.REPAY_IN,
            TransactionType.REPAY_OUT,
            TransactionType.WORK_OFFSET,
            TransactionType.WRITE_OFF,
            TransactionType.BALANCE_OUT,
            TransactionType.COMMITTEE_PAY,
          ],
        },
      },
      select: { personId: true, type: true, amount: true, currency: true, fromWalletId: true },
    });

    interface Pair {
      iOwe: number;
      owedToMe: number;
    }
    const buckets = new Map<string, { pkr: Pair; usd: Pair }>();
    for (const row of rows) {
      const key = row.personId as string;
      const pair =
        buckets.get(key) ?? { pkr: { iOwe: 0, owedToMe: 0 }, usd: { iOwe: 0, owedToMe: 0 } };
      const bucket = row.currency === Currency.USD ? pair.usd : pair.pkr;
      const amount = Number(row.amount);
      switch (row.type) {
        case TransactionType.BORROW:
          bucket.iOwe += amount;
          break;
        case TransactionType.REPAY_OUT:
        case TransactionType.WORK_OFFSET:
          bucket.iOwe -= amount;
          break;
        case TransactionType.LEND:
          bucket.owedToMe += amount;
          break;
        case TransactionType.REPAY_IN:
        case TransactionType.WRITE_OFF:
          bucket.owedToMe -= amount;
          break;
        case TransactionType.BALANCE_OUT:
          bucket.iOwe -= amount;
          bucket.owedToMe -= amount;
          break;
        case TransactionType.COMMITTEE_PAY:
          if (!row.fromWalletId) bucket.owedToMe -= amount;
          break;
        default:
          break;
      }
      buckets.set(key, pair);
    }

    const totals = { iOwePkr: 0, owedToMePkr: 0, iOweUsd: 0, owedToMeUsd: 0 };
    for (const pair of buckets.values()) {
      for (const bucket of [pair.pkr, pair.usd]) {
        if (bucket.iOwe < 0) {
          bucket.owedToMe += -bucket.iOwe;
          bucket.iOwe = 0;
        }
        if (bucket.owedToMe < 0) {
          bucket.iOwe += -bucket.owedToMe;
          bucket.owedToMe = 0;
        }
      }
      totals.iOwePkr += pair.pkr.iOwe;
      totals.owedToMePkr += pair.pkr.owedToMe;
      totals.iOweUsd += pair.usd.iOwe;
      totals.owedToMeUsd += pair.usd.owedToMe;
    }
    return {
      iOwePkr: round2(totals.iOwePkr),
      owedToMePkr: round2(totals.owedToMePkr),
      iOweUsd: round2(totals.iOweUsd),
      owedToMeUsd: round2(totals.owedToMeUsd),
    };
  }

  /** Idempotent: (re)computes and stores every completed cycle. */
  async backfill(userId: string): Promise<number> {
    const windows = await this.completedCycles(userId);
    for (const window of windows) {
      const data = await this.compute(userId, window.start, window.end);
      await this.prisma.monthlySnapshot.upsert({
        where: { userId_cycleKey: { userId, cycleKey: toDateKey(window.start) } },
        create: {
          userId,
          cycleKey: toDateKey(window.start),
          cycleEnd: toDateKey(window.end),
          data: data as unknown as object,
        },
        update: { data: data as unknown as object, cycleEnd: toDateKey(window.end) },
      });
    }
    return windows.length;
  }

  async list(userId: string): Promise<SnapshotRow[]> {
    const rows = await this.prisma.monthlySnapshot.findMany({
      where: { userId },
      orderBy: { cycleKey: 'desc' },
      take: 24,
    });
    return rows.map((row) => ({
      cycleKey: row.cycleKey,
      cycleEnd: row.cycleEnd,
      data: row.data as unknown as SnapshotData,
      report: row.report,
    }));
  }

  async saveReport(userId: string, cycleKey: string, report: string): Promise<void> {
    await this.prisma.monthlySnapshot.update({
      where: { userId_cycleKey: { userId, cycleKey } },
      data: { report },
    });
  }

  /** Deterministic pattern deltas the AI narrates but never invents. */
  progress(snapshots: SnapshotRow[]): Record<string, unknown> {
    if (snapshots.length === 0) return {};
    const latest = snapshots[0];
    const compare = (monthsBack: number) => {
      const other = snapshots[monthsBack];
      if (!other) return null;
      const names = new Set([
        ...latest.data.categories.map((row) => row.name),
        ...other.data.categories.map((row) => row.name),
      ]);
      const movers = [...names]
        .map((name) => {
          const now = latest.data.categories.find((row) => row.name === name)?.spentPkr ?? 0;
          const then = other.data.categories.find((row) => row.name === name)?.spentPkr ?? 0;
          return { name, deltaPkr: round2(now - then) };
        })
        .filter((row) => Math.abs(row.deltaPkr) > 0.009)
        .sort((a, b) => Math.abs(b.deltaPkr) - Math.abs(a.deltaPkr))
        .slice(0, 5);
      return {
        vsCycle: other.cycleKey,
        spentDeltaPkr: round2(latest.data.spentPkr - other.data.spentPkr),
        savingsDeltaPkr: round2(latest.data.savingsPkr - other.data.savingsPkr),
        debtDeltaPkr: round2(latest.data.debtsEnd.iOwePkr - other.data.debtsEnd.iOwePkr),
        biggestCategoryMoves: movers,
      };
    };
    return {
      latestCycle: latest.cycleKey,
      vs3Months: compare(3),
      vs6Months: compare(6),
      vs9Months: compare(9),
      vs12Months: compare(12),
    };
  }
}
