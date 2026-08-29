import { Injectable } from '@nestjs/common';
import { Currency, Prisma, TransactionType } from '@prisma/client';
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

export interface PersonPosition {
  personId: string;
  iOwePkr: number;
  owedToMePkr: number;
  takenPkr: number;
  writtenOffPkr: number;
}

export interface DebtsSummary {
  iOwePkr: number;
  owedToMePkr: number;
  people: (PersonPosition & { name: string })[];
}

const round = (value: number) => Math.round(value * 100) / 100;

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
        fxRate: true,
        fromWalletId: true,
      },
    });

    const positions = new Map<string, PersonPosition>();
    for (const row of rows) {
      const personId = row.personId as string;
      const position =
        positions.get(personId) ??
        ({ personId, iOwePkr: 0, owedToMePkr: 0, takenPkr: 0, writtenOffPkr: 0 } as PersonPosition);
      const pkr = this.toPkr(row.amount, row.currency, row.fxRate);

      switch (row.type) {
        case TransactionType.BORROW:
          position.iOwePkr += pkr;
          break;
        case TransactionType.REPAY_OUT:
        case TransactionType.WORK_OFFSET:
          position.iOwePkr -= pkr;
          break;
        case TransactionType.LEND:
          position.owedToMePkr += pkr;
          break;
        case TransactionType.REPAY_IN:
          position.owedToMePkr -= pkr;
          break;
        case TransactionType.WRITE_OFF:
          position.owedToMePkr -= pkr;
          position.writtenOffPkr += pkr;
          break;
        case TransactionType.TAKEN:
          position.takenPkr += pkr;
          position.writtenOffPkr += pkr;
          break;
        case TransactionType.BALANCE_OUT:
          position.iOwePkr -= pkr;
          position.owedToMePkr -= pkr;
          break;
        case TransactionType.COMMITTEE_PAY:
          // Paid through the ledger (no wallet): the organizer kept my installment
          // out of what they owed me (sec 15).
          if (!row.fromWalletId) {
            position.owedToMePkr -= pkr;
          }
          break;
        default:
          break;
      }
      positions.set(personId, position);
    }

    // An over-repayment flips the direction (confirmed at entry) — fold negatives across.
    for (const position of positions.values()) {
      if (position.iOwePkr < 0) {
        position.owedToMePkr += -position.iOwePkr;
        position.iOwePkr = 0;
      }
      if (position.owedToMePkr < 0) {
        position.iOwePkr += -position.owedToMePkr;
        position.owedToMePkr = 0;
      }
      position.iOwePkr = round(position.iOwePkr);
      position.owedToMePkr = round(position.owedToMePkr);
      position.takenPkr = round(position.takenPkr);
      position.writtenOffPkr = round(position.writtenOffPkr);
    }
    return positions;
  }

  async positionFor(userId: string, personId: string): Promise<PersonPosition> {
    const positions = await this.positions(userId);
    return (
      positions.get(personId) ?? {
        personId,
        iOwePkr: 0,
        owedToMePkr: 0,
        takenPkr: 0,
        writtenOffPkr: 0,
      }
    );
  }

  async summary(userId: string): Promise<DebtsSummary> {
    const [positions, people] = await Promise.all([
      this.positions(userId),
      this.prisma.person.findMany({ where: { userId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(people.map((person) => [person.id, person.name]));

    let iOwe = 0;
    let owedToMe = 0;
    const rows: DebtsSummary['people'] = [];
    for (const position of positions.values()) {
      iOwe += position.iOwePkr;
      owedToMe += position.owedToMePkr;
      if (
        position.iOwePkr !== 0 ||
        position.owedToMePkr !== 0 ||
        position.takenPkr !== 0 ||
        position.writtenOffPkr !== 0
      ) {
        rows.push({ ...position, name: names.get(position.personId) ?? 'Unknown' });
      }
    }
    rows.sort(
      (a, b) =>
        Math.max(b.iOwePkr, b.owedToMePkr) - Math.max(a.iOwePkr, a.owedToMePkr),
    );
    return { iOwePkr: round(iOwe), owedToMePkr: round(owedToMe), people: rows };
  }

  private toPkr(
    amount: Prisma.Decimal,
    currency: Currency,
    fxRate: Prisma.Decimal | null,
  ): number {
    if (currency === Currency.PKR) return Number(amount);
    return fxRate ? Number(amount) * Number(fxRate) : 0;
  }
}
