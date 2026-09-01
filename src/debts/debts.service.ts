import { Injectable } from '@nestjs/common';
import { Currency, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const DEBT_TYPES: TransactionType[] = [
  TransactionType.BORROW,
  TransactionType.LEND,
  TransactionType.REPAY_IN,
  TransactionType.REPAY_OUT,
  TransactionType.WORK_OFFSET,
  TransactionType.TAKEN,
  TransactionType.WRITE_OFF,
  TransactionType.BALANCE_OUT,
  TransactionType.COMMITTEE_PAY,
];

/** Debts are kept per currency and never converted: a dollar debt stays a
 *  dollar debt until an explicit conversion moves the money itself. Each
 *  currency nets independently — repaying rupees can never shrink dollars. */
export interface PersonPosition {
  personId: string;
  iOwePkr: number;
  owedToMePkr: number;
  takenPkr: number;
  writtenOffPkr: number;
  iOweUsd: number;
  owedToMeUsd: number;
  takenUsd: number;
  writtenOffUsd: number;
}

export interface DebtsSummary {
  iOwePkr: number;
  owedToMePkr: number;
  iOweUsd: number;
  owedToMeUsd: number;
  people: (PersonPosition & { name: string })[];
}

const round = (value: number) => Math.round(value * 100) / 100;

const emptyPosition = (personId: string): PersonPosition => ({
  personId,
  iOwePkr: 0,
  owedToMePkr: 0,
  takenPkr: 0,
  writtenOffPkr: 0,
  iOweUsd: 0,
  owedToMeUsd: 0,
  takenUsd: 0,
  writtenOffUsd: 0,
});

interface Bucket {
  iOwe: number;
  owedToMe: number;
  taken: number;
  writtenOff: number;
}

@Injectable()
export class DebtsService {
  constructor(private readonly prisma: PrismaService) {}

  async positions(userId: string): Promise<Map<string, PersonPosition>> {
    const rows = await this.prisma.transaction.findMany({
      where: { userId, type: { in: DEBT_TYPES }, personId: { not: null } },
      select: {
        personId: true,
        type: true,
        amount: true,
        currency: true,
        fromWalletId: true,
      },
    });

    const buckets = new Map<string, { pkr: Bucket; usd: Bucket }>();
    for (const row of rows) {
      const personId = row.personId as string;
      const pair =
        buckets.get(personId) ??
        ({
          pkr: { iOwe: 0, owedToMe: 0, taken: 0, writtenOff: 0 },
          usd: { iOwe: 0, owedToMe: 0, taken: 0, writtenOff: 0 },
        } as { pkr: Bucket; usd: Bucket });
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
          bucket.owedToMe -= amount;
          break;
        case TransactionType.WRITE_OFF:
          bucket.owedToMe -= amount;
          bucket.writtenOff += amount;
          break;
        case TransactionType.TAKEN:
          bucket.taken += amount;
          bucket.writtenOff += amount;
          break;
        case TransactionType.BALANCE_OUT:
          bucket.iOwe -= amount;
          bucket.owedToMe -= amount;
          break;
        case TransactionType.COMMITTEE_PAY:
          // Paid through the ledger (no wallet): the organizer kept my installment
          // out of what they owed me (sec 15).
          if (!row.fromWalletId) {
            bucket.owedToMe -= amount;
          }
          break;
        default:
          break;
      }
      buckets.set(personId, pair);
    }

    const positions = new Map<string, PersonPosition>();
    for (const [personId, pair] of buckets) {
      // An over-repayment flips the direction (confirmed at entry) — fold
      // negatives across, within the same currency only.
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
      positions.set(personId, {
        personId,
        iOwePkr: round(pair.pkr.iOwe),
        owedToMePkr: round(pair.pkr.owedToMe),
        takenPkr: round(pair.pkr.taken),
        writtenOffPkr: round(pair.pkr.writtenOff),
        iOweUsd: round(pair.usd.iOwe),
        owedToMeUsd: round(pair.usd.owedToMe),
        takenUsd: round(pair.usd.taken),
        writtenOffUsd: round(pair.usd.writtenOff),
      });
    }
    return positions;
  }

  async positionFor(userId: string, personId: string): Promise<PersonPosition> {
    const positions = await this.positions(userId);
    return positions.get(personId) ?? emptyPosition(personId);
  }

  async summary(userId: string): Promise<DebtsSummary> {
    const [positions, people] = await Promise.all([
      this.positions(userId),
      this.prisma.person.findMany({ where: { userId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(people.map((person) => [person.id, person.name]));

    let iOwePkr = 0;
    let owedToMePkr = 0;
    let iOweUsd = 0;
    let owedToMeUsd = 0;
    const rows: DebtsSummary['people'] = [];
    for (const position of positions.values()) {
      iOwePkr += position.iOwePkr;
      owedToMePkr += position.owedToMePkr;
      iOweUsd += position.iOweUsd;
      owedToMeUsd += position.owedToMeUsd;
      const active =
        position.iOwePkr !== 0 ||
        position.owedToMePkr !== 0 ||
        position.takenPkr !== 0 ||
        position.writtenOffPkr !== 0 ||
        position.iOweUsd !== 0 ||
        position.owedToMeUsd !== 0 ||
        position.takenUsd !== 0 ||
        position.writtenOffUsd !== 0;
      if (active) {
        rows.push({ ...position, name: names.get(position.personId) ?? 'Unknown' });
      }
    }
    rows.sort(
      (a, b) =>
        Math.max(b.iOwePkr, b.owedToMePkr, b.iOweUsd, b.owedToMeUsd) -
        Math.max(a.iOwePkr, a.owedToMePkr, a.iOweUsd, a.owedToMeUsd),
    );
    return {
      iOwePkr: round(iOwePkr),
      owedToMePkr: round(owedToMePkr),
      iOweUsd: round(iOweUsd),
      owedToMeUsd: round(owedToMeUsd),
      people: rows,
    };
  }
}
