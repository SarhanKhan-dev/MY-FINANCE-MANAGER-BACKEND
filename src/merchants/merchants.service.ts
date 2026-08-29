import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Currency, Merchant, Prisma, TransactionType } from '@prisma/client';
import { BudgetService } from '../budget/budget.service';
import { parseDateOnly } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { transactionInclude, TransactionWithRefs } from '../transactions/transaction-with-refs';

export interface MerchantDetail {
  id: string;
  name: string;
  spentAllTimePkr: number;
  spentThisCyclePkr: number;
  tripCount: number;
  avgTripPkr: number;
  entries: TransactionWithRefs[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function toPkr(amount: Prisma.Decimal, currency: Currency, fxRate: Prisma.Decimal | null) {
  if (currency === Currency.PKR) return Number(amount);
  return fxRate ? Number(amount) * Number(fxRate) : 0;
}

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly budget: BudgetService,
  ) {}

  async detail(userId: string, merchantId: string): Promise<MerchantDetail> {
    const merchant = await this.findOrFail(userId, merchantId);
    const [budget, rows, entries] = await Promise.all([
      this.budget.current(userId),
      this.prisma.transaction.findMany({
        where: { userId, merchantId: merchant.id, type: TransactionType.EXPENSE },
        select: { amount: true, currency: true, fxRate: true, date: true },
      }),
      this.prisma.transaction.findMany({
        where: { userId, merchantId: merchant.id },
        include: transactionInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 30,
      }),
    ]);

    const cycleStart = parseDateOnly(budget.cycleStart);
    const cycleEnd = parseDateOnly(budget.cycleEnd);
    let allTime = 0;
    let thisCycle = 0;
    for (const row of rows) {
      const pkr = toPkr(row.amount, row.currency, row.fxRate);
      allTime += pkr;
      if (row.date >= cycleStart && row.date < cycleEnd) thisCycle += pkr;
    }

    return {
      id: merchant.id,
      name: merchant.name,
      spentAllTimePkr: round2(allTime),
      spentThisCyclePkr: round2(thisCycle),
      tripCount: rows.length,
      avgTripPkr: rows.length > 0 ? round2(allTime / rows.length) : 0,
      entries,
    };
  }

  list(userId: string): Promise<Merchant[]> {
    return this.prisma.merchant.findMany({
      where: { userId, archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, name: string): Promise<Merchant> {
    const existing = await this.prisma.merchant.findFirst({
      where: { userId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('This shop already exists');
    }
    const merchant = await this.prisma.merchant.create({ data: { userId, name } });
    await this.events.record({
      userId,
      type: EventTypes.MERCHANT_CREATED,
      entityType: 'Merchant',
      entityId: merchant.id,
      after: { name },
    });
    return merchant;
  }

  async rename(userId: string, merchantId: string, name: string): Promise<Merchant> {
    const merchant = await this.findOrFail(userId, merchantId);
    const updated = await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { name },
    });
    await this.events.record({
      userId,
      type: EventTypes.MERCHANT_UPDATED,
      entityType: 'Merchant',
      entityId: merchant.id,
      before: { name: merchant.name },
      after: { name },
    });
    return updated;
  }

  /** Hard delete is only for shops with no history — otherwise archive (sec 46). */
  async remove(userId: string, merchantId: string): Promise<void> {
    const merchant = await this.findOrFail(userId, merchantId);
    const used = await this.prisma.transaction.count({
      where: { userId, merchantId: merchant.id },
    });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.merchant.delete({ where: { id: merchant.id } });
  }

  async archive(userId: string, merchantId: string): Promise<Merchant> {
    const merchant = await this.findOrFail(userId, merchantId);
    return this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { archivedAt: new Date() },
    });
  }

  async findOrFail(userId: string, merchantId: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findFirst({
      where: { id: merchantId, userId },
    });
    if (!merchant) {
      throw new NotFoundException('Shop not found');
    }
    return merchant;
  }
}
