import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, Investment, InvestmentKind, TransactionType } from '@prisma/client';
import { parseDateOnly, pktToday, toDateKey } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { FxService } from '../fx/fx.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10000) / 10000;

export interface HoldingView {
  id: string;
  name: string;
  kind: InvestmentKind;
  currency: Currency;
  units: number | null;
  currentUnitPrice: number | null;
  costBasis: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPct: number | null;
  realizedPnl: number;
  todayChange: number | null;
  zakatable: boolean;
  archived: boolean;
}

export interface PortfolioSummary {
  investedPkr: number;
  valuePkr: number;
  unrealizedPkr: number;
  realizedPkr: number;
  todayChangePkr: number | null;
  usdRate: number | null;
}

@Injectable()
export class InvestmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly transactions: TransactionsService,
    private readonly fx: FxService,
  ) {}

  private view(
    investment: Investment,
    previousValue: number | null,
  ): HoldingView {
    const costBasis = Number(investment.costBasis);
    const currentValue = Number(investment.currentValue);
    const unrealized = round2(currentValue - costBasis);
    return {
      id: investment.id,
      name: investment.name,
      kind: investment.kind,
      currency: investment.currency,
      units: investment.units ? Number(investment.units) : null,
      currentUnitPrice: investment.currentUnitPrice
        ? Number(investment.currentUnitPrice)
        : null,
      costBasis: round2(costBasis),
      currentValue: round2(currentValue),
      unrealizedPnl: unrealized,
      unrealizedPct: costBasis > 0 ? round2((unrealized / costBasis) * 100) : null,
      realizedPnl: round2(Number(investment.realizedPnl)),
      todayChange:
        previousValue === null ? null : round2(currentValue - previousValue),
      zakatable: investment.zakatable,
      archived: investment.archivedAt !== null,
    };
  }

  /** Latest snapshot value strictly before today, per investment. */
  private async previousValues(userId: string): Promise<Map<string, number>> {
    const today = pktToday();
    const snapshots = await this.prisma.investmentSnapshot.findMany({
      where: { userId, date: { lt: today } },
      orderBy: { date: 'desc' },
      select: { investmentId: true, value: true },
    });
    const previous = new Map<string, number>();
    for (const snapshot of snapshots) {
      if (!previous.has(snapshot.investmentId)) {
        previous.set(snapshot.investmentId, Number(snapshot.value));
      }
    }
    return previous;
  }

  async list(userId: string): Promise<{ holdings: HoldingView[]; summary: PortfolioSummary }> {
    const [investments, previous, usdRate] = await Promise.all([
      this.prisma.investment.findMany({
        where: { userId },
        orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.previousValues(userId),
      this.fx.usdToPkrOrNull(),
    ]);

    const holdings = investments.map((investment) =>
      this.view(investment, previous.get(investment.id) ?? null),
    );

    let invested = 0;
    let value = 0;
    let realized = 0;
    let todayChange: number | null = 0;
    for (const holding of holdings.filter((h) => !h.archived)) {
      const factor = holding.currency === Currency.PKR ? 1 : (usdRate ?? 0);
      invested += holding.costBasis * factor;
      value += holding.currentValue * factor;
      realized += holding.realizedPnl * factor;
      if (todayChange !== null) {
        todayChange =
          holding.todayChange === null
            ? todayChange
            : todayChange + holding.todayChange * factor;
      }
    }
    for (const holding of holdings.filter((h) => h.archived)) {
      const factor = holding.currency === Currency.PKR ? 1 : (usdRate ?? 0);
      realized += holding.realizedPnl * factor;
    }

    return {
      holdings,
      summary: {
        investedPkr: round2(invested),
        valuePkr: round2(value),
        unrealizedPkr: round2(value - invested),
        realizedPkr: round2(realized),
        todayChangePkr: todayChange === null ? null : round2(todayChange),
        usdRate,
      },
    };
  }

  async create(
    userId: string,
    input: { name: string; kind: InvestmentKind; currency?: Currency; zakatable?: boolean },
  ): Promise<Investment> {
    const existing = await this.prisma.investment.findFirst({
      where: { userId, name: { equals: input.name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('This investment already exists');
    }
    const investment = await this.prisma.investment.create({
      data: {
        userId,
        name: input.name,
        kind: input.kind,
        currency: input.currency ?? Currency.PKR,
        zakatable: input.zakatable ?? false,
        units: input.kind === InvestmentKind.STOCK ? 0 : null,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.INVESTMENT_CREATED,
      entityType: 'Investment',
      entityId: investment.id,
      after: { name: investment.name, kind: investment.kind },
    });
    return investment;
  }

  async buy(
    userId: string,
    investmentId: string,
    input: {
      walletId?: string;
      amount?: number;
      units?: number;
      unitPrice?: number;
      date?: string;
      fxRate?: number;
    },
  ): Promise<Investment> {
    const investment = await this.activeOrFail(userId, investmentId);
    const isStock = investment.kind === InvestmentKind.STOCK;

    let amount = input.amount;
    if (isStock) {
      if (!input.units || !input.unitPrice) {
        throw new BadRequestException('Enter shares and price per share');
      }
      amount = round2(input.units * input.unitPrice);
    }
    if (!amount || amount <= 0) {
      throw new BadRequestException('Enter an amount');
    }
    const date = input.date ?? toDateKey(pktToday());

    await this.transactions.create(
      userId,
      {
        type: TransactionType.INVESTMENT_IN,
        date,
        amount,
        currency: investment.currency,
        fromWalletId: input.walletId,
        fxRate: input.fxRate,
        note: investment.name,
        force: true,
      },
      undefined,
      { investmentId: investment.id },
    );

    const updated = await this.prisma.investment.update({
      where: { id: investment.id },
      data: {
        costBasis: round2(Number(investment.costBasis) + amount),
        currentValue: round2(Number(investment.currentValue) + amount),
        ...(isStock
          ? {
              units: round4(Number(investment.units ?? 0) + (input.units ?? 0)),
              currentUnitPrice: input.unitPrice,
            }
          : {}),
      },
    });
    await this.snapshot(userId, updated.id, date, Number(updated.currentValue));
    return updated;
  }

  async sell(
    userId: string,
    investmentId: string,
    input: {
      // Optional in the type so TradeDto fits; the engine demands it for the proceeds.
      walletId?: string;
      amount?: number;
      units?: number;
      unitPrice?: number;
      date?: string;
      fxRate?: number;
    },
  ): Promise<{ investment: Investment; realized: number }> {
    const investment = await this.activeOrFail(userId, investmentId);
    const isStock = investment.kind === InvestmentKind.STOCK;
    const date = input.date ?? toDateKey(pktToday());

    let proceeds: number;
    let costOfSold: number;
    let data: Record<string, unknown>;

    if (isStock) {
      const heldUnits = Number(investment.units ?? 0);
      if (!input.units || !input.unitPrice) {
        throw new BadRequestException('Enter shares and price per share');
      }
      if (input.units > heldUnits + 1e-9) {
        throw new BadRequestException('You do not hold that many shares');
      }
      proceeds = round2(input.units * input.unitPrice);
      const avgCost = heldUnits > 0 ? Number(investment.costBasis) / heldUnits : 0;
      costOfSold = round2(avgCost * input.units);
      const remainingUnits = round4(heldUnits - input.units);
      data = {
        units: remainingUnits,
        currentUnitPrice: input.unitPrice,
        costBasis: round2(Number(investment.costBasis) - costOfSold),
        currentValue: round2(remainingUnits * input.unitPrice),
      };
    } else {
      const currentValue = Number(investment.currentValue);
      if (!input.amount || input.amount <= 0) {
        throw new BadRequestException('Enter an amount');
      }
      if (input.amount > currentValue + 0.01) {
        throw new BadRequestException('More than this holding is worth');
      }
      proceeds = round2(input.amount);
      const proportion = currentValue > 0 ? proceeds / currentValue : 0;
      costOfSold = round2(Number(investment.costBasis) * proportion);
      data = {
        costBasis: round2(Number(investment.costBasis) - costOfSold),
        currentValue: round2(currentValue - proceeds),
      };
    }

    const realized = round2(proceeds - costOfSold);

    await this.transactions.create(
      userId,
      {
        type: TransactionType.INVESTMENT_OUT,
        date,
        amount: proceeds,
        currency: investment.currency,
        toWalletId: input.walletId,
        fxRate: input.fxRate,
        note: investment.name,
        force: true,
      },
      undefined,
      { investmentId: investment.id },
    );

    const updated = await this.prisma.investment.update({
      where: { id: investment.id },
      data: {
        ...data,
        realizedPnl: round2(Number(investment.realizedPnl) + realized),
      },
    });
    await this.snapshot(userId, updated.id, date, Number(updated.currentValue));
    await this.events.record({
      userId,
      type: EventTypes.INVESTMENT_SOLD,
      entityType: 'Investment',
      entityId: investment.id,
      after: { name: investment.name, proceeds, realized },
    });
    return { investment: updated, realized };
  }

  async updateValue(
    userId: string,
    investmentId: string,
    input: { value?: number; unitPrice?: number; date?: string },
  ): Promise<Investment> {
    const investment = await this.activeOrFail(userId, investmentId);
    const isStock = investment.kind === InvestmentKind.STOCK;
    const date = input.date ?? toDateKey(pktToday());

    let value: number;
    let unitPrice: number | undefined;
    if (isStock) {
      if (!input.unitPrice || input.unitPrice <= 0) {
        throw new BadRequestException('Enter the price per share');
      }
      unitPrice = input.unitPrice;
      value = round2(Number(investment.units ?? 0) * input.unitPrice);
    } else {
      if (input.value === undefined || input.value < 0) {
        throw new BadRequestException('Enter the value');
      }
      value = round2(input.value);
    }

    const updated = await this.prisma.investment.update({
      where: { id: investment.id },
      data: { currentValue: value, ...(unitPrice ? { currentUnitPrice: unitPrice } : {}) },
    });
    await this.snapshot(userId, updated.id, date, value);
    await this.events.record({
      userId,
      type: EventTypes.INVESTMENT_VALUE_UPDATED,
      entityType: 'Investment',
      entityId: investment.id,
      before: { value: Number(investment.currentValue) },
      after: { value },
    });
    return updated;
  }

  async detail(userId: string, investmentId: string) {
    const investment = await this.findOrFail(userId, investmentId);
    const [snapshots, previous, entries] = await Promise.all([
      this.prisma.investmentSnapshot.findMany({
        where: { userId, investmentId },
        orderBy: { date: 'desc' },
        take: 90,
      }),
      this.previousValues(userId),
      this.prisma.transaction.findMany({
        where: { userId, investmentId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, type: true, date: true, amount: true, currency: true },
      }),
    ]);
    return {
      holding: this.view(investment, previous.get(investment.id) ?? null),
      snapshots: snapshots.map((snapshot) => ({
        date: toDateKey(snapshot.date),
        value: Number(snapshot.value),
      })),
      entries: entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        date: toDateKey(entry.date),
        amount: entry.amount.toFixed(2),
        currency: entry.currency,
      })),
    };
  }

  async archive(userId: string, investmentId: string): Promise<Investment> {
    const investment = await this.findOrFail(userId, investmentId);
    if (Number(investment.currentValue) > 0.009) {
      throw new BadRequestException('Sell it down to zero first');
    }
    return this.prisma.investment.update({
      where: { id: investment.id },
      data: { archivedAt: new Date() },
    });
  }

  async remove(userId: string, investmentId: string): Promise<void> {
    const investment = await this.findOrFail(userId, investmentId);
    const used = await this.prisma.transaction.count({
      where: { userId, investmentId: investment.id },
    });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.investment.delete({ where: { id: investment.id } });
  }

  private async snapshot(
    userId: string,
    investmentId: string,
    date: string,
    value: number,
  ): Promise<void> {
    await this.prisma.investmentSnapshot.upsert({
      where: { investmentId_date: { investmentId, date: parseDateOnly(date) } },
      create: { userId, investmentId, date: parseDateOnly(date), value },
      update: { value },
    });
  }

  private async activeOrFail(userId: string, investmentId: string): Promise<Investment> {
    const investment = await this.findOrFail(userId, investmentId);
    if (investment.archivedAt) {
      throw new BadRequestException('This investment is closed');
    }
    return investment;
  }

  private async findOrFail(userId: string, investmentId: string): Promise<Investment> {
    const investment = await this.prisma.investment.findFirst({
      where: { id: investmentId, userId },
    });
    if (!investment) {
      throw new NotFoundException('Investment not found');
    }
    return investment;
  }
}
