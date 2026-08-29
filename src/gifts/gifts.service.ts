import { Injectable } from '@nestjs/common';
import { Currency, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface GiftEntry {
  id: string;
  date: string;
  amountPkr: number;
  direction: 'GIVEN' | 'RECEIVED';
  personName: string | null;
  detail: string | null;
}

export interface GiftsView {
  givenPkr: number;
  receivedPkr: number;
  givenThisYearPkr: number;
  receivedThisYearPkr: number;
  entries: GiftEntry[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function toPkr(amount: Prisma.Decimal, currency: Currency, fxRate: Prisma.Decimal | null) {
  if (currency === Currency.PKR) return Number(amount);
  return fxRate ? Number(amount) * Number(fxRate) : 0;
}

/**
 * Gifts are derived, never stored: given = expense money that lands in the
 * Gifts category or Gifts product group; received = income typed as a gift.
 */
@Injectable()
export class GiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async view(userId: string): Promise<GiftsView> {
    const [expenses, incomes] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: TransactionType.EXPENSE,
          OR: [
            { category: { name: { equals: 'Gifts', mode: 'insensitive' } } },
            {
              items: {
                some: {
                  product: {
                    productCategory: { name: { equals: 'Gifts', mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        },
        select: {
          id: true,
          date: true,
          amount: true,
          currency: true,
          fxRate: true,
          note: true,
          person: { select: { name: true } },
          merchant: { select: { name: true } },
          category: { select: { name: true } },
          items: {
            select: {
              lineTotal: true,
              label: true,
              product: {
                select: { name: true, productCategory: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
      }),
      this.prisma.transaction.findMany({
        where: {
          userId,
          type: TransactionType.INCOME,
          incomeType: { in: ['Gift', 'Gifts', 'Eidi'], mode: 'insensitive' },
        },
        select: {
          id: true,
          date: true,
          amount: true,
          currency: true,
          fxRate: true,
          note: true,
          incomeSource: true,
          person: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
      }),
    ]);

    const entries: GiftEntry[] = [];
    let given = 0;
    let received = 0;
    let givenYear = 0;
    let receivedYear = 0;
    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));

    for (const row of expenses) {
      const factor =
        row.currency === Currency.PKR ? 1 : row.fxRate ? Number(row.fxRate) : 0;
      const headerIsGifts = row.category?.name?.toLowerCase() === 'gifts';
      const giftLines = row.items.filter(
        (item) => item.product?.productCategory?.name?.toLowerCase() === 'gifts',
      );
      // Itemized: only the gift lines count. Plain entry under Gifts: the whole amount.
      const pkr =
        giftLines.length > 0
          ? giftLines.reduce((sum, item) => sum + Number(item.lineTotal), 0) * factor
          : headerIsGifts
            ? toPkr(row.amount, row.currency, row.fxRate)
            : 0;
      if (pkr <= 0) continue;
      given += pkr;
      if (row.date >= yearStart) givenYear += pkr;
      const what =
        giftLines
          .map((item) => item.product?.name ?? item.label)
          .filter(Boolean)
          .join(', ') || null;
      entries.push({
        id: row.id,
        date: row.date.toISOString().slice(0, 10),
        amountPkr: round2(pkr),
        direction: 'GIVEN',
        personName: row.person?.name ?? null,
        detail: what ?? row.note ?? row.merchant?.name ?? null,
      });
    }

    for (const row of incomes) {
      const pkr = toPkr(row.amount, row.currency, row.fxRate);
      received += pkr;
      if (row.date >= yearStart) receivedYear += pkr;
      entries.push({
        id: row.id,
        date: row.date.toISOString().slice(0, 10),
        amountPkr: round2(pkr),
        direction: 'RECEIVED',
        personName: row.person?.name ?? row.incomeSource ?? null,
        detail: row.note ?? null,
      });
    }

    entries.sort((a, b) => b.date.localeCompare(a.date));

    return {
      givenPkr: round2(given),
      receivedPkr: round2(received),
      givenThisYearPkr: round2(givenYear),
      receivedThisYearPkr: round2(receivedYear),
      entries: entries.slice(0, 100),
    };
  }
}
