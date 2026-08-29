import { Injectable } from '@nestjs/common';
import { Currency, WalletKind } from '@prisma/client';
import { BudgetService, BudgetStatus } from '../budget/budget.service';
import { FxService } from '../fx/fx.service';
import { PrismaService } from '../prisma/prisma.service';
import { transactionInclude, TransactionWithRefs } from '../transactions/transaction-with-refs';
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
  usdRate: number | null;
}

export interface Overview {
  budget: BudgetStatus;
  wallets: OverviewWallet[];
  totals: OverviewTotals;
  recent: TransactionWithRefs[];
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budget: BudgetService,
    private readonly wallets: WalletsService,
    private readonly fx: FxService,
  ) {}

  async overview(userId: string): Promise<Overview> {
    const [budget, walletRows, usdRate, recent] = await Promise.all([
      this.budget.current(userId),
      this.wallets.list(userId),
      this.fx.usdToPkrOrNull(),
      this.prisma.transaction.findMany({
        where: { userId },
        include: transactionInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 10,
      }),
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
        usdRate,
      },
      recent,
    };
  }
}
