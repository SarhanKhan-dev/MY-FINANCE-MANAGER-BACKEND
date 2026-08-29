import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, Prisma, TransactionType, Wallet } from '@prisma/client';
import { BudgetService } from '../budget/budget.service';
import { parseDateOnly } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { transactionInclude, TransactionWithRefs } from './transaction-with-refs';

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface NormalizedTransaction {
  type: TransactionType;
  date: Date;
  amount: number;
  currency: Currency;
  fxRate: number | null;
  toAmount: number | null;
  fromWalletId: string | null;
  toWalletId: string | null;
  categoryId: string | null;
  merchantId: string | null;
  personId: string | null;
  incomeSource: string | null;
  incomeType: string | null;
  note: string | null;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly budget: BudgetService,
  ) {}

  async create(
    userId: string,
    dto: CreateTransactionDto,
    idempotencyKey?: string,
  ): Promise<TransactionWithRefs> {
    if (idempotencyKey) {
      const existing = await this.prisma.transaction.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        include: transactionInclude,
      });
      if (existing) return existing;
    }

    const data = await this.normalizeAndValidate(userId, {
      type: dto.type,
      date: parseDateOnly(dto.date),
      amount: dto.amount,
      currency: dto.currency,
      fxRate: dto.fxRate ?? null,
      toAmount: dto.toAmount ?? null,
      fromWalletId: dto.fromWalletId ?? null,
      toWalletId: dto.toWalletId ?? null,
      categoryId: dto.categoryId ?? null,
      merchantId: dto.merchantId ?? null,
      personId: dto.personId ?? null,
      incomeSource: dto.incomeSource?.trim() || null,
      incomeType: dto.incomeType?.trim() || null,
      note: dto.note?.trim() || null,
    });

    if (!dto.force) {
      await this.guardDuplicates(userId, data);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.create({
        data: { ...data, userId, idempotencyKey: idempotencyKey ?? null },
        include: transactionInclude,
      });
      await this.events.record({
        userId,
        type: EventTypes.TRANSACTION_CREATED,
        entityType: 'Transaction',
        entityId: transaction.id,
        after: this.snapshot(transaction),
        tx,
      });
      return transaction;
    });

    if (created.type === TransactionType.EXPENSE) {
      await this.budget.checkAlerts(userId);
    }
    return created;
  }

  async list(
    userId: string,
    query: QueryTransactionsDto,
  ): Promise<{ items: TransactionWithRefs[]; total: number }> {
    const where = this.buildWhere(userId, query);
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: transactionInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { items, total };
  }

  async get(userId: string, id: string): Promise<TransactionWithRefs> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: transactionInclude,
    });
    if (!transaction) {
      throw new NotFoundException('Entry not found');
    }
    return transaction;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTransactionDto,
  ): Promise<TransactionWithRefs> {
    const existing = await this.get(userId, id);

    const data = await this.normalizeAndValidate(userId, {
      type: existing.type,
      date: dto.date ? parseDateOnly(dto.date) : existing.date,
      amount: dto.amount ?? Number(existing.amount),
      currency: dto.currency ?? existing.currency,
      fxRate:
        dto.fxRate !== undefined ? dto.fxRate : existing.fxRate ? Number(existing.fxRate) : null,
      toAmount:
        dto.toAmount !== undefined
          ? dto.toAmount
          : existing.toAmount
            ? Number(existing.toAmount)
            : null,
      fromWalletId:
        dto.fromWalletId !== undefined ? dto.fromWalletId : existing.fromWalletId,
      toWalletId: dto.toWalletId !== undefined ? dto.toWalletId : existing.toWalletId,
      categoryId: dto.categoryId !== undefined ? dto.categoryId : existing.categoryId,
      merchantId: dto.merchantId !== undefined ? dto.merchantId : existing.merchantId,
      personId: dto.personId !== undefined ? dto.personId : existing.personId,
      incomeSource:
        dto.incomeSource !== undefined
          ? dto.incomeSource.trim() || null
          : existing.incomeSource,
      incomeType:
        dto.incomeType !== undefined ? dto.incomeType.trim() || null : existing.incomeType,
      note: dto.note !== undefined ? dto.note.trim() || null : existing.note,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.update({
        where: { id: existing.id },
        data,
        include: transactionInclude,
      });
      await this.events.record({
        userId,
        type: EventTypes.TRANSACTION_UPDATED,
        entityType: 'Transaction',
        entityId: transaction.id,
        before: this.snapshot(existing),
        after: this.snapshot(transaction),
        tx,
      });
      return transaction;
    });

    if (existing.type === TransactionType.EXPENSE) {
      await this.budget.checkAlerts(userId);
    }
    return updated;
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await this.get(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.transaction.delete({ where: { id: existing.id } });
      await this.events.record({
        userId,
        type: EventTypes.TRANSACTION_DELETED,
        entityType: 'Transaction',
        entityId: existing.id,
        before: this.snapshot(existing),
        tx,
      });
    });
  }

  async summary(userId: string, query: QueryTransactionsDto) {
    const where = this.buildWhere(userId, query);
    const rows = await this.prisma.transaction.findMany({
      where,
      select: { type: true, amount: true, currency: true, fxRate: true },
    });

    let spent = 0;
    let received = 0;
    let biggest: number | null = null;
    for (const row of rows) {
      const pkr = this.toPkr(row.amount, row.currency, row.fxRate);
      if (row.type === TransactionType.EXPENSE && pkr !== null) {
        spent += pkr;
        if (biggest === null || pkr > biggest) biggest = pkr;
      }
      if (row.type === TransactionType.INCOME && pkr !== null) {
        received += pkr;
      }
    }
    return {
      spentPkr: Math.round(spent * 100) / 100,
      receivedPkr: Math.round(received * 100) / 100,
      entries: rows.length,
      biggestExpensePkr: biggest === null ? null : Math.round(biggest * 100) / 100,
    };
  }

  private toPkr(
    amount: Prisma.Decimal,
    currency: Currency,
    fxRate: Prisma.Decimal | null,
  ): number | null {
    if (currency === Currency.PKR) return Number(amount);
    if (fxRate) return Number(amount) * Number(fxRate);
    return null;
  }

  private buildWhere(
    userId: string,
    query: QueryTransactionsDto,
  ): Prisma.TransactionWhereInput {
    const where: Prisma.TransactionWhereInput = { userId };
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: parseDateOnly(query.from) } : {}),
        ...(query.to ? { lt: new Date(parseDateOnly(query.to).getTime() + DAY_MS) } : {}),
      };
    }
    if (query.type) where.type = query.type;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.merchantId) where.merchantId = query.merchantId;
    if (query.personId) where.personId = query.personId;
    if (query.walletId) {
      where.OR = [{ fromWalletId: query.walletId }, { toWalletId: query.walletId }];
    }
    if (query.q) where.note = { contains: query.q, mode: 'insensitive' };
    return where;
  }

  private async normalizeAndValidate(
    userId: string,
    data: NormalizedTransaction,
  ): Promise<NormalizedTransaction> {
    const walletIds = [data.fromWalletId, data.toWalletId].filter(
      (id): id is string => id !== null,
    );
    const wallets = await this.prisma.wallet.findMany({
      where: { id: { in: walletIds }, userId },
    });
    const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]));

    const resolve = (id: string | null, label: string): Wallet | null => {
      if (!id) return null;
      const wallet = walletById.get(id);
      if (!wallet) throw new NotFoundException(`${label} wallet not found`);
      if (wallet.archivedAt) throw new BadRequestException(`${label} wallet is archived`);
      return wallet;
    };

    const fromWallet = resolve(data.fromWalletId, 'From');
    const toWallet = resolve(data.toWalletId, 'To');

    switch (data.type) {
      case TransactionType.EXPENSE: {
        if (!fromWallet) throw new BadRequestException('Paid from which wallet?');
        if (data.currency !== fromWallet.currency) {
          throw new BadRequestException('Amount currency must match the wallet');
        }
        if (data.currency === Currency.USD && !data.fxRate) {
          throw new BadRequestException('Enter the USD rate');
        }
        data.toWalletId = null;
        data.toAmount = null;
        break;
      }
      case TransactionType.INCOME: {
        if (!toWallet) throw new BadRequestException('Into which wallet?');
        if (data.currency !== toWallet.currency) {
          throw new BadRequestException('Amount currency must match the wallet');
        }
        if (!data.personId && !data.incomeSource) {
          throw new BadRequestException('Say who it came from');
        }
        data.fromWalletId = null;
        data.toAmount = null;
        data.categoryId = null;
        data.merchantId = null;
        break;
      }
      case TransactionType.TRANSFER: {
        if (!fromWallet || !toWallet) {
          throw new BadRequestException('Pick both wallets');
        }
        if (fromWallet.id === toWallet.id) {
          throw new BadRequestException('Pick two different wallets');
        }
        if (fromWallet.currency !== toWallet.currency) {
          throw new BadRequestException('Use Converted currency for different currencies');
        }
        if (data.currency !== fromWallet.currency) {
          throw new BadRequestException('Amount currency must match the wallets');
        }
        data.toAmount = null;
        data.categoryId = null;
        data.merchantId = null;
        data.personId = null;
        break;
      }
      case TransactionType.CONVERSION: {
        if (!fromWallet || !toWallet) {
          throw new BadRequestException('Pick both wallets');
        }
        if (fromWallet.currency === toWallet.currency) {
          throw new BadRequestException('Use Moved money for the same currency');
        }
        if (data.currency !== fromWallet.currency) {
          throw new BadRequestException('Amount currency must match the from-wallet');
        }
        if (!data.fxRate) {
          throw new BadRequestException('Enter the rate used');
        }
        if (!data.toAmount) {
          const converted =
            fromWallet.currency === Currency.USD
              ? data.amount * data.fxRate
              : data.amount / data.fxRate;
          data.toAmount = Math.round(converted * 100) / 100;
        }
        data.categoryId = null;
        data.merchantId = null;
        data.personId = null;
        break;
      }
    }

    if (data.type !== TransactionType.EXPENSE) {
      data.incomeType = data.type === TransactionType.INCOME ? (data.incomeType ?? 'Other') : null;
      if (data.type !== TransactionType.INCOME) {
        data.incomeSource = null;
      }
    } else {
      data.incomeSource = null;
      data.incomeType = null;
    }

    if (data.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: data.categoryId, userId },
      });
      if (!category) throw new NotFoundException('Category not found');
    }
    if (data.merchantId) {
      const merchant = await this.prisma.merchant.findFirst({
        where: { id: data.merchantId, userId },
      });
      if (!merchant) throw new NotFoundException('Shop not found');
    }
    if (data.personId) {
      const person = await this.prisma.person.findFirst({
        where: { id: data.personId, userId },
      });
      if (!person) throw new NotFoundException('Person not found');
    }

    return data;
  }

  private async guardDuplicates(userId: string, data: NormalizedTransaction): Promise<void> {
    const recent = await this.prisma.transaction.findFirst({
      where: {
        userId,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        fromWalletId: data.fromWalletId,
        toWalletId: data.toWalletId,
        merchantId: data.merchantId,
        personId: data.personId,
        createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
    });
    if (recent) {
      throw new ConflictException('Looks like a duplicate — save anyway?');
    }
  }

  private snapshot(tx: TransactionWithRefs): Record<string, unknown> {
    return {
      type: tx.type,
      date: tx.date.toISOString().slice(0, 10),
      amount: tx.amount.toString(),
      currency: tx.currency,
      fxRate: tx.fxRate?.toString() ?? null,
      toAmount: tx.toAmount?.toString() ?? null,
      fromWallet: tx.fromWallet?.name ?? null,
      toWallet: tx.toWallet?.name ?? null,
      category: tx.category?.name ?? null,
      merchant: tx.merchant?.name ?? null,
      person: tx.person?.name ?? null,
      incomeSource: tx.incomeSource,
      incomeType: tx.incomeType,
      note: tx.note,
    };
  }
}
