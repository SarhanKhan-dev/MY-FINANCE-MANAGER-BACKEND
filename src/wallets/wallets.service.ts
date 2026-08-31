import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, Prisma, TransactionType, Wallet } from '@prisma/client';
import { pktToday } from '../budget/cycle';
import { DebtsService } from '../debts/debts.service';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CreateWalletDto, UpdateWalletDto } from './dto/create-wallet.dto';

const ZERO = new Prisma.Decimal(0);

export interface WalletLoanSlash {
  stillOwePkr: number;
  stillOwedToMePkr: number;
}

export interface WalletLoanPerson extends WalletLoanSlash {
  personId: string;
  name: string;
  borrowedInPkr: number;
  lentOutPkr: number;
}

export interface WalletLoansView extends WalletLoanSlash {
  borrowedInPkr: number;
  lentOutPkr: number;
  people: WalletLoanPerson[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly transactions: TransactionsService,
    private readonly debts: DebtsService,
  ) {}

  /** Balance per wallet id, derived entirely from transactions. */
  async balances(userId: string): Promise<Map<string, Prisma.Decimal>> {
    const [outgoing, incomingPlain, incomingConversions] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['fromWalletId'],
        where: { userId, fromWalletId: { not: null } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['toWalletId'],
        where: { userId, toWalletId: { not: null }, type: { not: TransactionType.CONVERSION } },
        _sum: { amount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['toWalletId'],
        where: { userId, toWalletId: { not: null }, type: TransactionType.CONVERSION },
        _sum: { toAmount: true },
      }),
    ]);

    const totals = new Map<string, Prisma.Decimal>();
    const add = (walletId: string | null, value: Prisma.Decimal | null) => {
      if (!walletId || !value) return;
      totals.set(walletId, (totals.get(walletId) ?? ZERO).add(value));
    };
    for (const row of incomingPlain) add(row.toWalletId, row._sum.amount);
    for (const row of incomingConversions) add(row.toWalletId, row._sum.toAmount);
    for (const row of outgoing) {
      if (!row.fromWalletId || !row._sum.amount) continue;
      totals.set(
        row.fromWalletId,
        (totals.get(row.fromWalletId) ?? ZERO).sub(row._sum.amount),
      );
    }
    return totals;
  }

  async list(userId: string): Promise<{ wallet: Wallet; balance: Prisma.Decimal }[]> {
    const [wallets, balanceMap] = await Promise.all([
      this.prisma.wallet.findMany({
        where: { userId },
        orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.balances(userId),
    ]);
    return wallets.map((wallet) => ({
      wallet,
      balance: balanceMap.get(wallet.id) ?? ZERO,
    }));
  }

  async create(userId: string, dto: CreateWalletDto): Promise<Wallet> {
    const existing = await this.prisma.wallet.findFirst({
      where: { userId, name: { equals: dto.name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('A wallet with this name already exists');
    }
    if (dto.openingBalance && dto.currency === Currency.USD && !dto.openingFxRate) {
      throw new BadRequestException('Enter the USD rate for the starting balance');
    }
    const wallet = await this.prisma.wallet.create({
      data: { userId, name: dto.name, kind: dto.kind, currency: dto.currency },
    });
    await this.events.record({
      userId,
      type: EventTypes.WALLET_CREATED,
      entityType: 'Wallet',
      entityId: wallet.id,
      after: { name: wallet.name, kind: wallet.kind, currency: wallet.currency },
    });
    if (dto.openingBalance) {
      await this.transactions.create(userId, {
        type: TransactionType.OPENING,
        date: pktToday().toISOString().slice(0, 10),
        amount: dto.openingBalance,
        currency: wallet.currency,
        fxRate: wallet.currency === Currency.USD ? dto.openingFxRate : undefined,
        toWalletId: wallet.id,
        note: 'Opening balance',
      });
    }
    return wallet;
  }

  async update(userId: string, walletId: string, dto: UpdateWalletDto): Promise<Wallet> {
    const wallet = await this.findOrFail(userId, walletId);
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { name: dto.name },
    });
    await this.events.record({
      userId,
      type: EventTypes.WALLET_UPDATED,
      entityType: 'Wallet',
      entityId: wallet.id,
      before: { name: wallet.name },
      after: { name: updated.name },
    });
    return updated;
  }

  async archive(userId: string, walletId: string): Promise<Wallet> {
    const wallet = await this.findOrFail(userId, walletId);
    if (wallet.archivedAt) return wallet;
    const balance = (await this.balances(userId)).get(wallet.id) ?? ZERO;
    if (!balance.isZero()) {
      throw new BadRequestException('Move the money out first — balance must be zero');
    }
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { archivedAt: new Date() },
    });
    await this.events.record({
      userId,
      type: EventTypes.WALLET_ARCHIVED,
      entityType: 'Wallet',
      entityId: wallet.id,
      before: { name: wallet.name },
    });
    return updated;
  }

  async unarchive(userId: string, walletId: string): Promise<Wallet> {
    const wallet = await this.findOrFail(userId, walletId);
    const updated = await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { archivedAt: null },
    });
    await this.events.record({
      userId,
      type: EventTypes.WALLET_UNARCHIVED,
      entityType: 'Wallet',
      entityId: wallet.id,
      after: { name: wallet.name },
    });
    return updated;
  }

  async findOrFail(userId: string, walletId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findFirst({ where: { id: walletId, userId } });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  /** What each wallet still carries of loan money, both directions.
   *  A person's outstanding position is split across wallets in proportion to
   *  where their loan money actually landed (or left from), so nothing is
   *  counted twice and walletless backfills stay out of wallet views. */
  private async loanAttribution(userId: string): Promise<Map<string, Map<string, WalletLoanPerson>>> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        personId: { not: null },
        OR: [
          { type: TransactionType.BORROW, toWalletId: { not: null } },
          { type: TransactionType.LEND, fromWalletId: { not: null } },
        ],
      },
      select: {
        type: true,
        amount: true,
        currency: true,
        fxRate: true,
        toWalletId: true,
        fromWalletId: true,
        person: { select: { id: true, name: true } },
      },
    });

    const byWallet = new Map<string, Map<string, WalletLoanPerson>>();
    if (rows.length === 0) return byWallet;

    interface PersonFlows {
      name: string;
      borrow: Map<string, number>;
      lend: Map<string, number>;
    }
    const flows = new Map<string, PersonFlows>();
    for (const row of rows) {
      const person = row.person as { id: string; name: string };
      const entry = flows.get(person.id) ?? {
        name: person.name,
        borrow: new Map<string, number>(),
        lend: new Map<string, number>(),
      };
      const pkr =
        row.currency === Currency.PKR
          ? Number(row.amount)
          : row.fxRate
            ? Number(row.amount) * Number(row.fxRate)
            : 0;
      if (row.type === TransactionType.BORROW && row.toWalletId) {
        entry.borrow.set(row.toWalletId, (entry.borrow.get(row.toWalletId) ?? 0) + pkr);
      } else if (row.type === TransactionType.LEND && row.fromWalletId) {
        entry.lend.set(row.fromWalletId, (entry.lend.get(row.fromWalletId) ?? 0) + pkr);
      }
      flows.set(person.id, entry);
    }

    const positions = await this.debts.positions(userId);
    const walletPerson = (walletId: string, personId: string, name: string): WalletLoanPerson => {
      const wallet = byWallet.get(walletId) ?? new Map<string, WalletLoanPerson>();
      byWallet.set(walletId, wallet);
      const entry =
        wallet.get(personId) ??
        ({
          personId,
          name,
          borrowedInPkr: 0,
          lentOutPkr: 0,
          stillOwePkr: 0,
          stillOwedToMePkr: 0,
        } as WalletLoanPerson);
      wallet.set(personId, entry);
      return entry;
    };

    for (const [personId, personFlows] of flows) {
      const position = positions.get(personId);
      const borrowTotal = [...personFlows.borrow.values()].reduce((sum, value) => sum + value, 0);
      for (const [walletId, amount] of personFlows.borrow) {
        const entry = walletPerson(walletId, personId, personFlows.name);
        entry.borrowedInPkr = round2(entry.borrowedInPkr + amount);
        if (position && borrowTotal > 0) {
          entry.stillOwePkr = round2(
            entry.stillOwePkr + position.iOwePkr * (amount / borrowTotal),
          );
        }
      }
      const lendTotal = [...personFlows.lend.values()].reduce((sum, value) => sum + value, 0);
      for (const [walletId, amount] of personFlows.lend) {
        const entry = walletPerson(walletId, personId, personFlows.name);
        entry.lentOutPkr = round2(entry.lentOutPkr + amount);
        if (position && lendTotal > 0) {
          entry.stillOwedToMePkr = round2(
            entry.stillOwedToMePkr + position.owedToMePkr * (amount / lendTotal),
          );
        }
      }
    }

    return byWallet;
  }

  /** The "you owe / owed to you" slash for every wallet at once. */
  async loanSlashes(userId: string): Promise<Map<string, WalletLoanSlash>> {
    const attribution = await this.loanAttribution(userId);
    const slashes = new Map<string, WalletLoanSlash>();
    for (const [walletId, people] of attribution) {
      let stillOwe = 0;
      let stillOwedToMe = 0;
      for (const entry of people.values()) {
        stillOwe += entry.stillOwePkr;
        stillOwedToMe += entry.stillOwedToMePkr;
      }
      slashes.set(walletId, {
        stillOwePkr: round2(stillOwe),
        stillOwedToMePkr: round2(stillOwedToMe),
      });
    }
    return slashes;
  }

  /** Per-person loan traffic for one wallet: who funded it, who it funded. */
  async loanFlows(userId: string, walletId: string): Promise<WalletLoansView> {
    await this.findOrFail(userId, walletId);
    const attribution = await this.loanAttribution(userId);
    const people = [...(attribution.get(walletId)?.values() ?? [])].sort(
      (a, b) => Math.max(b.borrowedInPkr, b.lentOutPkr) - Math.max(a.borrowedInPkr, a.lentOutPkr),
    );
    let borrowedIn = 0;
    let lentOut = 0;
    let stillOwe = 0;
    let stillOwedToMe = 0;
    for (const entry of people) {
      borrowedIn += entry.borrowedInPkr;
      lentOut += entry.lentOutPkr;
      stillOwe += entry.stillOwePkr;
      stillOwedToMe += entry.stillOwedToMePkr;
    }
    return {
      borrowedInPkr: round2(borrowedIn),
      lentOutPkr: round2(lentOut),
      stillOwePkr: round2(stillOwe),
      stillOwedToMePkr: round2(stillOwedToMe),
      people,
    };
  }
}
