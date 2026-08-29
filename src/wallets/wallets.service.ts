import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType, Wallet } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWalletDto, UpdateWalletDto } from './dto/create-wallet.dto';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
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
}
