import { Injectable } from '@nestjs/common';
import { Currency, TransactionType } from '@prisma/client';
import { FxService } from '../fx/fx.service';
import { GoldService } from '../gold/gold.service';
import { InvestmentsService } from '../investments/investments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';

const GOLD_NISAB_GRAMS = 87.48;
const ZAKAT_RATE = 0.025;
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface ZakatLine {
  label: string;
  amountPkr: number;
}

export interface ZakatView {
  lines: ZakatLine[];
  zakatablePkr: number;
  nisabPkr: number | null;
  nisabSource: 'manual' | 'gold-rate' | null;
  aboveNisab: boolean | null;
  duePkr: number | null;
  charityThisYearPkr: number;
  zakatPaidThisYearPkr: number;
}

@Injectable()
export class ZakatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallets: WalletsService,
    private readonly fx: FxService,
    private readonly gold: GoldService,
    private readonly investments: InvestmentsService,
  ) {}

  async view(userId: string): Promise<ZakatView> {
    const [walletRows, usdRate, goldPkr, portfolio, settings, charityRows] = await Promise.all([
      this.wallets.list(userId),
      this.fx.usdToPkrOrNull(),
      this.gold.valuePkr(userId),
      this.investments.list(userId),
      this.prisma.userSettings.findUnique({ where: { userId } }),
      this.charityThisYear(userId),
    ]);

    let cash = 0;
    let banks = 0;
    let mobile = 0;
    for (const { wallet, balance } of walletRows.filter((row) => !row.wallet.archivedAt)) {
      const value = Number(balance);
      const pkr = wallet.currency === Currency.PKR ? value : usdRate ? value * usdRate : 0;
      if (wallet.kind === 'CASH') cash += pkr;
      if (wallet.kind === 'BANK') banks += pkr;
      if (wallet.kind === 'MOBILE') mobile += pkr;
    }

    const zakatableInvestments = portfolio.holdings
      .filter((holding) => !holding.archived && holding.zakatable)
      .reduce((total, holding) => {
        const factor = holding.currency === Currency.PKR ? 1 : (usdRate ?? 0);
        return total + holding.currentValue * factor;
      }, 0);

    const lines: ZakatLine[] = [
      { label: 'Cash', amountPkr: round2(cash) },
      { label: 'Banks', amountPkr: round2(banks) },
      { label: 'Mobile wallets', amountPkr: round2(mobile) },
      { label: 'Zakatable investments', amountPkr: round2(zakatableInvestments) },
      { label: 'Gold', amountPkr: round2(goldPkr ?? 0) },
    ].filter((line) => line.amountPkr !== 0);

    const zakatable = round2(
      lines.reduce((total, line) => total + line.amountPkr, 0),
    );

    let nisab: number | null = null;
    let nisabSource: ZakatView['nisabSource'] = null;
    if (settings?.zakatNisabPkr) {
      nisab = Number(settings.zakatNisabPkr);
      nisabSource = 'manual';
    } else if (settings?.goldRatePkrPerGram) {
      nisab = round2(GOLD_NISAB_GRAMS * Number(settings.goldRatePkrPerGram));
      nisabSource = 'gold-rate';
    }

    const aboveNisab = nisab === null ? null : zakatable >= nisab;
    return {
      lines,
      zakatablePkr: zakatable,
      nisabPkr: nisab,
      nisabSource,
      aboveNisab,
      duePkr: aboveNisab ? round2(zakatable * ZAKAT_RATE) : aboveNisab === false ? 0 : null,
      charityThisYearPkr: charityRows.charity,
      zakatPaidThisYearPkr: charityRows.zakat,
    };
  }

  private async charityThisYear(userId: string): Promise<{ charity: number; zakat: number }> {
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const rows = await this.prisma.transaction.findMany({
      where: { userId, type: TransactionType.CHARITY, date: { gte: yearStart } },
      select: { amount: true, currency: true, fxRate: true, isZakat: true },
    });
    let charity = 0;
    let zakat = 0;
    for (const row of rows) {
      const pkr =
        row.currency === Currency.PKR
          ? Number(row.amount)
          : row.fxRate
            ? Number(row.amount) * Number(row.fxRate)
            : 0;
      charity += pkr;
      if (row.isZakat) zakat += pkr;
    }
    return { charity: round2(charity), zakat: round2(zakat) };
  }
}
