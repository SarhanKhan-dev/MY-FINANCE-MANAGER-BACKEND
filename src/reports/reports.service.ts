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
  debts: { iOwePkr: number; owedToMePkr: number };
  categoryLeaders: CategoryLeader[];
  missedDays: string[];
  upcoming: UpcomingItem[];
  recent: TransactionWithRefs[];
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
    let netWorth: number | null = 0;
    let banks = 0;
    let mobile = 0;
    let cash = 0;

    for (const { wallet, balance } of active) {
      const value = Number(balance);
      let pkrValue: number | null;
      if (wallet.currency === Currency.PKR) {
        pkrValue = value;
      } else if (usdRate) {
        pkrValue = value * usdRate;
      } else {
        pkrValue = null;
      }
      if (pkrValue === null) {
        netWorth = null;
        continue;
      }
      if (netWorth !== null) netWorth += pkrValue;
      if (wallet.kind === WalletKind.BANK) banks += pkrValue;
      if (wallet.kind === WalletKind.MOBILE) mobile += pkrValue;
      if (wallet.kind === WalletKind.CASH) cash += pkrValue;
    }

    const investmentsPkr = portfolio.summary.valuePkr;
    if (netWorth !== null) {
      netWorth += investmentsPkr;
      if (goldPkr !== null) netWorth += goldPkr;
    }

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
        netWorthPkr: netWorth === null ? null : round(netWorth),
        banksPkr: round(banks),
        mobilePkr: round(mobile),
        cashPkr: round(cash),
        investmentsPkr: round(investmentsPkr),
        goldPkr,
        usdRate,
      },
      debts: { iOwePkr: debtsSummary.iOwePkr, owedToMePkr: debtsSummary.owedToMePkr },
      categoryLeaders,
      missedDays,
      upcoming,
      recent,
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
      .sort((a, b) => b.spentPkr - a.spentPkr)
      .slice(0, 5);
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
