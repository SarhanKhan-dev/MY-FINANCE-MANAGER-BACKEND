import { Injectable } from '@nestjs/common';
import { Currency, TransactionType, WalletKind } from '@prisma/client';
import { BudgetService, BudgetStatus } from '../budget/budget.service';
import { parseDateOnly, pktToday } from '../budget/cycle';
import { DebtsService } from '../debts/debts.service';
import { FxService } from '../fx/fx.service';
import { GoldService } from '../gold/gold.service';
import { InvestmentsService } from '../investments/investments.service';
import { PrismaService } from '../prisma/prisma.service';
import { transactionInclude, TransactionWithRefs } from '../transactions/transaction-with-refs';
import { TransactionsService } from '../transactions/transactions.service';
import { WalletsService } from '../wallets/wallets.service';

export interface OverviewWallet {
  id: string;
  name: string;
  kind: WalletKind;
  currency: Currency;
  balance: string;
  archived: boolean;
}

export interface OverviewTotals {
  netWorthPkr: number | null;
  banksPkr: number;
  mobilePkr: number;
  cashPkr: number;
  /** USD wallet balances, kept in dollars — never converted into the PKR totals. */
  dollarsUsd: number;
  investmentsPkr: number;
  goldPkr: number | null;
  usdRate: number | null;
}

export interface CategoryLeader {
  name: string;
  spentPkr: number;
}

export interface UpcomingItem {
  kind: 'bill' | 'subscription';
  id: string;
  name: string;
  dueOn: string;
  amountPkr: number | null;
  overdue: boolean;
}

export interface Overview {
  budget: BudgetStatus;
  wallets: OverviewWallet[];
  totals: OverviewTotals;
  debts: { iOwePkr: number; owedToMePkr: number; iOweUsd: number; owedToMeUsd: number };
  categoryLeaders: CategoryLeader[];
  missedDays: string[];
  upcoming: UpcomingItem[];
  recent: TransactionWithRefs[];
}

export interface MonthFlow {
  monthKey: string;
  spentPkr: number;
  receivedPkr: number;
}

export interface NamedTotal {
  name: string;
  totalPkr: number;
}

export interface ChartsView {
  months: MonthFlow[];
  categories: CategoryLeader[];
  topShops: NamedTotal[];
  topProducts: NamedTotal[];
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: BudgetService,
    private readonly wallets: WalletsService,
    private readonly fx: FxService,
    private readonly debts: DebtsService,
    private readonly investments: InvestmentsService,
    private readonly gold: GoldService,
    private readonly transactions: TransactionsService,
  ) {}

  async overview(userId: string): Promise<Overview> {
    const [budget, walletRows, usdRate, debtsSummary, upcoming, portfolio, goldPkr, recent] =
      await Promise.all([
        this.budget.current(userId),
        this.wallets.list(userId),
        this.fx.usdToPkrOrNull(),
        this.debts.summary(userId),
        this.upcoming(userId),
        this.investments.list(userId),
        this.gold.valuePkr(userId),
        this.prisma.transaction.findMany({
          where: { userId },
          include: transactionInclude,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 10,
        }),
      ]);
    const [categoryLeaders, missedDays] = await Promise.all([
      this.categoryLeaders(userId, budget.cycleStart, budget.cycleEnd),
      this.transactions.missingDays(userId, budget.cycleStart),
    ]);

    const active = walletRows.filter(({ wallet }) => !wallet.archivedAt);
    let netWorth = 0;
    let banks = 0;
    let mobile = 0;
    let cash = 0;
    let dollars = 0;

    for (const { wallet, balance } of active) {
      const value = Number(balance);
      // Dollars stay dollars: shown as their own figure, never folded into
      // the PKR totals. The only PKR they become is an explicit conversion.
      if (wallet.currency !== Currency.PKR) {
        dollars += value;
        continue;
      }
      netWorth += value;
      if (wallet.kind === WalletKind.BANK) banks += value;
      if (wallet.kind === WalletKind.MOBILE) mobile += value;
      if (wallet.kind === WalletKind.CASH) cash += value;
    }

    const investmentsPkr = portfolio.summary.valuePkr;
    netWorth += investmentsPkr;
    if (goldPkr !== null) netWorth += goldPkr;

    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      budget,
      wallets: walletRows.map(({ wallet, balance }) => ({
        id: wallet.id,
        name: wallet.name,
        kind: wallet.kind,
        currency: wallet.currency,
        balance: balance.toFixed(2),
        archived: wallet.archivedAt !== null,
      })),
      totals: {
        netWorthPkr: round(netWorth),
        banksPkr: round(banks),
        mobilePkr: round(mobile),
        cashPkr: round(cash),
        dollarsUsd: round(dollars),
        investmentsPkr: round(investmentsPkr),
        goldPkr,
        usdRate,
      },
      debts: {
        iOwePkr: debtsSummary.iOwePkr,
        owedToMePkr: debtsSummary.owedToMePkr,
        iOweUsd: debtsSummary.iOweUsd,
        owedToMeUsd: debtsSummary.owedToMeUsd,
      },
      categoryLeaders,
      missedDays,
      upcoming,
      recent,
    };
  }

  /** Analyst charts: 6-month money flow, cycle categories, top shops and items. */
  async charts(userId: string): Promise<ChartsView> {
    const budget = await this.budget.current(userId);
    const today = pktToday();
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));

    const OUT: TransactionType[] = [
      TransactionType.EXPENSE,
      TransactionType.REPAY_OUT,
      TransactionType.TAKEN,
      TransactionType.CHARITY,
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

    const rows = await this.prisma.transaction.findMany({
      where: { userId, date: { gte: start } },
      select: {
        type: true,
        amount: true,
        currency: true,
        fxRate: true,
        fromWalletId: true,
        toWalletId: true,
        date: true,
      },
    });

    const byMonth = new Map<string, { spent: number; received: number }>();
    for (let index = 0; index < 6; index += 1) {
      const month = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5 + index, 1),
      );
      byMonth.set(month.toISOString().slice(0, 7), { spent: 0, received: 0 });
    }
    const toPkr = (amount: unknown, currency: Currency, fxRate: unknown) =>
      currency === Currency.PKR
        ? Number(amount)
        : fxRate
          ? Number(amount) * Number(fxRate)
          : 0;
    for (const row of rows) {
      const bucket = byMonth.get(row.date.toISOString().slice(0, 7));
      if (!bucket) continue;
      const pkr = toPkr(row.amount, row.currency, row.fxRate);
      if (
        OUT.includes(row.type) ||
        (OUT_IF_WALLET.includes(row.type) && row.fromWalletId !== null)
      ) {
        bucket.spent += pkr;
      }
      if (
        IN.includes(row.type) ||
        (IN_IF_WALLET.includes(row.type) && row.toWalletId !== null)
      ) {
        bucket.received += pkr;
      }
    }

    const round = (value: number) => Math.round(value * 100) / 100;
    const cycleStart = parseDateOnly(budget.cycleStart);
    const cycleEnd = parseDateOnly(budget.cycleEnd);

    const [categories, shopRows, itemRows] = await Promise.all([
      this.categoryTotals(userId, budget.cycleStart, budget.cycleEnd),
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: TransactionType.EXPENSE,
          merchantId: { not: null },
          date: { gte: cycleStart, lt: cycleEnd },
        },
        select: {
          amount: true,
          currency: true,
          fxRate: true,
          merchant: { select: { name: true } },
        },
      }),
      this.prisma.transactionItem.findMany({
        where: {
          transaction: {
            userId,
            type: TransactionType.EXPENSE,
            date: { gte: cycleStart, lt: cycleEnd },
          },
          productId: { not: null },
        },
        select: { lineTotal: true, product: { select: { name: true } } },
      }),
    ]);

    const shopTotals = new Map<string, number>();
    for (const row of shopRows) {
      const name = row.merchant?.name ?? 'Unknown';
      shopTotals.set(
        name,
        (shopTotals.get(name) ?? 0) + toPkr(row.amount, row.currency, row.fxRate),
      );
    }
    const productTotals = new Map<string, number>();
    for (const item of itemRows) {
      const name = item.product?.name ?? 'Other';
      productTotals.set(name, (productTotals.get(name) ?? 0) + Number(item.lineTotal));
    }
    const top = (totals: Map<string, number>, count: number): NamedTotal[] =>
      [...totals.entries()]
        .map(([name, totalPkr]) => ({ name, totalPkr: round(totalPkr) }))
        .sort((a, b) => b.totalPkr - a.totalPkr)
        .slice(0, count);

    return {
      months: [...byMonth.entries()].map(([monthKey, flow]) => ({
        monthKey,
        spentPkr: round(flow.spent),
        receivedPkr: round(flow.received),
      })),
      categories: categories.slice(0, 8),
      topShops: top(shopTotals, 5),
      topProducts: top(productTotals, 5),
    };
  }

  /**
   * Top-5 spend categories in the current cycle (sec 54). Itemized trips are
   * split line by line onto each product's group — one receipt at one shop can
   * feed many categories; only the uncovered remainder stays on the header.
   */
  private async categoryLeaders(
    userId: string,
    cycleStart: string,
    cycleEnd: string,
  ): Promise<CategoryLeader[]> {
    return (await this.categoryTotals(userId, cycleStart, cycleEnd)).slice(0, 5);
  }

  async categoryTotals(
    userId: string,
    cycleStart: string,
    cycleEnd: string,
  ): Promise<CategoryLeader[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        date: { gte: parseDateOnly(cycleStart), lt: parseDateOnly(cycleEnd) },
      },
      select: {
        amount: true,
        currency: true,
        fxRate: true,
        category: { select: { name: true } },
        items: {
          select: {
            lineTotal: true,
            product: { select: { productCategory: { select: { name: true } } } },
          },
        },
      },
    });
    const totals = new Map<string, number>();
    const add = (name: string, pkr: number) => {
      if (pkr === 0) return;
      totals.set(name, (totals.get(name) ?? 0) + pkr);
    };
    for (const row of rows) {
      const factor =
        row.currency === Currency.PKR ? 1 : row.fxRate ? Number(row.fxRate) : 0;
      const headerName = row.category?.name ?? 'Uncategorized';
      if (row.items.length === 0) {
        add(headerName, Number(row.amount) * factor);
        continue;
      }
      let covered = 0;
      for (const item of row.items) {
        const line = Number(item.lineTotal);
        covered += line;
        add(item.product?.productCategory?.name ?? headerName, line * factor);
      }
      const remainder = Number(row.amount) - covered;
      if (Math.abs(remainder) > 0.009) {
        add(headerName, remainder * factor);
      }
    }
    return Array.from(totals.entries())
      .map(([name, spentPkr]) => ({ name, spentPkr: Math.round(spentPkr * 100) / 100 }))
      .sort((a, b) => b.spentPkr - a.spentPkr);
  }

  /** Bills and renewals due in the next 7 days, overdue first (sec 39 #8). */
  private async upcoming(userId: string): Promise<UpcomingItem[]> {
    const horizon = new Date(pktToday().getTime() + 8 * 24 * 60 * 60 * 1000);
    const today = pktToday();
    const [bills, subscriptions] = await Promise.all([
      this.prisma.bill.findMany({
        where: { userId, archivedAt: null, nextDueOn: { lt: horizon } },
      }),
      this.prisma.subscription.findMany({
        where: { userId, archivedAt: null, renewsOn: { lt: horizon } },
      }),
    ]);

    const items: UpcomingItem[] = [
      ...bills
        .filter((bill) => !(bill.repeat === 'ONCE' && bill.lastPaidOn))
        .map((bill) => ({
          kind: 'bill' as const,
          id: bill.id,
          name: bill.name,
          dueOn: bill.nextDueOn.toISOString().slice(0, 10),
          amountPkr:
            bill.amount && bill.currency === Currency.PKR ? Number(bill.amount) : null,
          overdue: bill.nextDueOn < today,
        })),
      ...subscriptions.map((subscription) => ({
        kind: 'subscription' as const,
        id: subscription.id,
        name: subscription.name,
        dueOn: subscription.renewsOn.toISOString().slice(0, 10),
        amountPkr:
          subscription.currency === Currency.PKR ? Number(subscription.amount) : null,
        overdue: subscription.renewsOn < today,
      })),
    ];
    return items.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  }
}
