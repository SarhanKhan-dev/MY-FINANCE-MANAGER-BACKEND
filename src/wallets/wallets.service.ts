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

/** All loan figures are in the WALLET'S OWN currency — a dollar loan shows as
 *  dollars, never silently converted. PKR equivalents (entry-time fx) are used
 *  only internally to work out how much of a debt is still outstanding. */
export interface WalletLoanSlash {
  stillOwe: number;
  stillOwedToMe: number;
}

export interface WalletLoanPerson extends WalletLoanSlash {
  personId: string;
  name: string;
  borrowedIn: number;
  lentOut: number;
}

export interface WalletLoansView extends WalletLoanSlash {
  currency: Currency;
  borrowedIn: number;
  lentOut: number;
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
        toWalletId: true,
        fromWalletId: true,
        person: { select: { id: true, name: true } },
      },
    });

    const byWallet = new Map<string, Map<string, WalletLoanPerson>>();
    if (rows.length === 0) return byWallet;

    interface Flow {
      native: number;
      currency: Currency;
    }
    interface PersonFlows {
      name: string;
      borrow: Map<string, Flow>;
      lend: Map<string, Flow>;
    }
    const flows = new Map<string, PersonFlows>();
    for (const row of rows) {
      const person = row.person as { id: string; name: string };
      const entry = flows.get(person.id) ?? {
        name: person.name,
        borrow: new Map<string, Flow>(),
        lend: new Map<string, Flow>(),
      };
      const bump = (map: Map<string, Flow>, walletId: string) => {
        const flow = map.get(walletId) ?? { native: 0, currency: row.currency };
        flow.native += Number(row.amount);
        map.set(walletId, flow);
      };
      if (row.type === TransactionType.BORROW && row.toWalletId) {
        bump(entry.borrow, row.toWalletId);
      } else if (row.type === TransactionType.LEND && row.fromWalletId) {
        bump(entry.lend, row.fromWalletId);
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
          borrowedIn: 0,
          lentOut: 0,
          stillOwe: 0,
          stillOwedToMe: 0,
        } as WalletLoanPerson);
      wallet.set(personId, entry);
      return entry;
    };
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

    // The outstanding fraction is worked out per currency — dollars against the
    // dollar ledger, rupees against the rupee ledger — then applied to each
    // wallet's flow in that wallet's own currency. No conversion anywhere.
    const totalsByCurrency = (map: Map<string, Flow>) => {
      const totals: Record<Currency, number> = { PKR: 0, USD: 0 };
      for (const flow of map.values()) totals[flow.currency] += flow.native;
      return totals;
    };
    const fractionFor = (outstanding: number, total: number) =>
      total > 0 ? clamp01(outstanding / total) : outstanding > 0 ? 1 : 0;

    for (const [personId, personFlows] of flows) {
      const position = positions.get(personId);
      const owe: Record<Currency, number> = {
        PKR: position?.iOwePkr ?? 0,
        USD: position?.iOweUsd ?? 0,
      };
      const owed: Record<Currency, number> = {
        PKR: position?.owedToMePkr ?? 0,
        USD: position?.owedToMeUsd ?? 0,
      };

      const borrowTotals = totalsByCurrency(personFlows.borrow);
      for (const [walletId, flow] of personFlows.borrow) {
        const entry = walletPerson(walletId, personId, personFlows.name);
        const fraction = fractionFor(owe[flow.currency], borrowTotals[flow.currency]);
        entry.borrowedIn = round2(entry.borrowedIn + flow.native);
        entry.stillOwe = round2(entry.stillOwe + flow.native * fraction);
      }

      const lendTotals = totalsByCurrency(personFlows.lend);
      for (const [walletId, flow] of personFlows.lend) {
        const entry = walletPerson(walletId, personId, personFlows.name);
        const fraction = fractionFor(owed[flow.currency], lendTotals[flow.currency]);
        entry.lentOut = round2(entry.lentOut + flow.native);
        entry.stillOwedToMe = round2(entry.stillOwedToMe + flow.native * fraction);
      }
    }

    return byWallet;
  }

  /** The "you owe / owed to you" slash for every wallet, in each wallet's currency. */
  async loanSlashes(userId: string): Promise<Map<string, WalletLoanSlash>> {
    const attribution = await this.loanAttribution(userId);
    const slashes = new Map<string, WalletLoanSlash>();
    for (const [walletId, people] of attribution) {
      let stillOwe = 0;
      let stillOwedToMe = 0;
      for (const entry of people.values()) {
        stillOwe += entry.stillOwe;
        stillOwedToMe += entry.stillOwedToMe;
      }
      slashes.set(walletId, {
        stillOwe: round2(stillOwe),
        stillOwedToMe: round2(stillOwedToMe),
      });
    }
    return slashes;
  }

  /** Per-person loan traffic for one wallet: who funded it, who it funded. */
  async loanFlows(userId: string, walletId: string): Promise<WalletLoansView> {
    const wallet = await this.findOrFail(userId, walletId);
    const attribution = await this.loanAttribution(userId);
    const people = [...(attribution.get(walletId)?.values() ?? [])].sort(
      (a, b) => Math.max(b.borrowedIn, b.lentOut) - Math.max(a.borrowedIn, a.lentOut),
    );
    let borrowedIn = 0;
    let lentOut = 0;
    let stillOwe = 0;
    let stillOwedToMe = 0;
    for (const entry of people) {
      borrowedIn += entry.borrowedIn;
      lentOut += entry.lentOut;
      stillOwe += entry.stillOwe;
      stillOwedToMe += entry.stillOwedToMe;
    }
    return {
      currency: wallet.currency,
      borrowedIn: round2(borrowedIn),
      lentOut: round2(lentOut),
      stillOwe: round2(stillOwe),
      stillOwedToMe: round2(stillOwedToMe),
      people,
    };
  }
}
