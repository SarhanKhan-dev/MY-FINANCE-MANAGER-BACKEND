import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, Prisma, TransactionType, Wallet } from '@prisma/client';
import { BudgetService } from '../budget/budget.service';
import { parseDateOnly, pktToday } from '../budget/cycle';
import { DebtsService } from '../debts/debts.service';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { transactionInclude, TransactionWithRefs } from './transaction-with-refs';

const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WALLET_IN_TYPES: TransactionType[] = [
  TransactionType.INCOME,
  TransactionType.REPAY_IN,
  TransactionType.INVESTMENT_OUT,
  TransactionType.OPENING,
];
const WALLET_OUT_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.REPAY_OUT,
  TransactionType.TAKEN,
  TransactionType.CHARITY,
  TransactionType.SALARY,
];
// Money that may move a wallet — or be a backfill record from before tracking
// started (old loans, committee months already settled, holdings owned).
const WALLET_OPTIONAL_OUT: TransactionType[] = [
  TransactionType.LEND,
  TransactionType.COMMITTEE_PAY,
  TransactionType.INVESTMENT_IN,
];
const WALLET_OPTIONAL_IN: TransactionType[] = [
  TransactionType.BORROW,
  TransactionType.COMMITTEE_PAYOUT,
];
const NO_WALLET_TYPES: TransactionType[] = [
  TransactionType.WORK_OFFSET,
  TransactionType.WRITE_OFF,
  TransactionType.BALANCE_OUT,
];
// Committee entries carry a person only when a wallet or the organizer's
// ledger is involved — backfilled months from before tracking carry neither.
const PERSON_REQUIRED_TYPES: TransactionType[] = [
  TransactionType.BORROW,
  TransactionType.LEND,
  TransactionType.REPAY_IN,
  TransactionType.REPAY_OUT,
  TransactionType.WORK_OFFSET,
  TransactionType.TAKEN,
  TransactionType.WRITE_OFF,
  TransactionType.BALANCE_OUT,
  TransactionType.SALARY,
];
const CAP_TYPES: TransactionType[] = [
  TransactionType.EXPENSE,
  TransactionType.LEND,
  TransactionType.TAKEN,
  TransactionType.COMMITTEE_PAY,
  TransactionType.CHARITY,
];

interface NormalizedItem {
  productId: string | null;
  label: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

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
  isZakat: boolean;
  items?: NormalizedItem[];
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly budget: BudgetService,
    private readonly debts: DebtsService,
  ) {}

  async create(
    userId: string,
    dto: CreateTransactionDto,
    idempotencyKey?: string,
    links?: {
      billId?: string;
      subscriptionId?: string;
      investmentId?: string;
      committeeId?: string;
      committeeMonth?: Date;
    },
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
      isZakat: dto.isZakat ?? false,
      items: dto.items?.map((item) => ({
        productId: item.productId ?? null,
        label: item.label?.trim() || null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    });

    await this.guardDebtLimits(userId, data, dto.force ?? false);
    if (!dto.force) {
      await this.guardDuplicates(userId, data);
    }

    const forPersonIds = await this.validForPeople(userId, dto.forPersonIds);

    const created = await this.prisma.$transaction(async (tx) => {
      const { items, ...fields } = data;
      const transaction = await tx.transaction.create({
        data: {
          ...fields,
          userId,
          idempotencyKey: idempotencyKey ?? null,
          billId: links?.billId ?? null,
          subscriptionId: links?.subscriptionId ?? null,
          investmentId: links?.investmentId ?? null,
          committeeId: links?.committeeId ?? null,
          committeeMonth: links?.committeeMonth ?? null,
          ...(items && items.length > 0
            ? { items: { create: items.map((item) => ({ ...item, userId })) } }
            : {}),
          ...(forPersonIds.length > 0
            ? { forPeople: { create: forPersonIds.map((personId) => ({ personId })) } }
            : {}),
        },
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

    if (CAP_TYPES.includes(created.type)) {
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
      isZakat: dto.isZakat !== undefined ? dto.isZakat : existing.isZakat,
      items: dto.items?.map((item) => ({
        productId: item.productId ?? null,
        label: item.label?.trim() || null,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
    });

    const forPersonIds =
      dto.forPersonIds !== undefined
        ? await this.validForPeople(userId, dto.forPersonIds)
        : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const { items, ...fields } = data;
      const transaction = await tx.transaction.update({
        where: { id: existing.id },
        data: {
          ...fields,
          ...(items !== undefined
            ? {
                items: {
                  deleteMany: {},
                  create: items.map((item) => ({ ...item, userId })),
                },
              }
            : {}),
          ...(forPersonIds !== undefined
            ? {
                forPeople: {
                  deleteMany: {},
                  create: forPersonIds.map((personId) => ({ personId })),
                },
              }
            : {}),
        },
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

    if (CAP_TYPES.includes(existing.type)) {
      await this.budget.checkAlerts(userId);
    }
    return updated;
  }

  /** Keeps only tags pointing at people this user actually owns, deduplicated. */
  private async validForPeople(userId: string, ids?: string[]): Promise<string[]> {
    if (!ids || ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const people = await this.prisma.person.findMany({
      where: { userId, id: { in: unique } },
      select: { id: true },
    });
    return people.map((person) => person.id);
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

  /** Calendar days in the range (up to yesterday, PKT) with zero entries (sec 55). */
  async missingDays(userId: string, from?: string, to?: string): Promise<string[]> {
    const first = await this.prisma.transaction.findFirst({
      where: { userId },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    if (!first) return [];

    const pktYesterday = new Date(pktToday().getTime() - DAY_MS);

    let start = first.date;
    if (from) {
      const parsed = parseDateOnly(from);
      if (parsed > start) start = parsed;
    }
    let end = pktYesterday;
    if (to) {
      const parsed = parseDateOnly(to);
      if (parsed < end) end = parsed;
    }
    if (start > end) return [];

    const rows = await this.prisma.transaction.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: { date: true },
      distinct: ['date'],
    });
    const have = new Set(rows.map((row) => row.date.toISOString().slice(0, 10)));

    const missing: string[] = [];
    for (
      let cursor = start.getTime();
      cursor <= end.getTime() && missing.length < 62;
      cursor += DAY_MS
    ) {
      const key = new Date(cursor).toISOString().slice(0, 10);
      if (!have.has(key)) missing.push(key);
    }
    return missing;
  }

  async summary(userId: string, query: QueryTransactionsDto) {
    const where = this.buildWhere(userId, query);
    const rows = await this.prisma.transaction.findMany({
      where,
      select: {
        type: true,
        amount: true,
        currency: true,
        fxRate: true,
        fromWalletId: true,
        toWalletId: true,
      },
    });

    let spent = 0;
    let received = 0;
    let biggest: number | null = null;
    for (const row of rows) {
      const pkr = this.toPkr(row.amount, row.currency, row.fxRate);
      if (pkr === null) continue;
      const isOut =
        WALLET_OUT_TYPES.includes(row.type) ||
        (WALLET_OPTIONAL_OUT.includes(row.type) && row.fromWalletId !== null);
      if (isOut) {
        spent += pkr;
        if (biggest === null || pkr > biggest) biggest = pkr;
      }
      // Opening balances seed a wallet and backfilled records moved no money —
      // neither is money received.
      const isIn =
        (WALLET_IN_TYPES.includes(row.type) && row.type !== TransactionType.OPENING) ||
        (WALLET_OPTIONAL_IN.includes(row.type) && row.toWalletId !== null);
      if (isIn) {
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
    if (query.personId) {
      // Matches whether they are the counterparty or just tagged "for whom".
      where.AND = [
        {
          OR: [
            { personId: query.personId },
            { forPeople: { some: { personId: query.personId } } },
          ],
        },
      ];
    }
    if (query.walletId) {
      where.OR = [{ fromWalletId: query.walletId }, { toWalletId: query.walletId }];
    }
    if (query.q) where.note = { contains: query.q, mode: 'insensitive' };
    if (query.itemized) where.items = { some: {} };
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
    const requireUsdRate = () => {
      if (data.currency === Currency.USD && !data.fxRate) {
        throw new BadRequestException('Enter the USD rate');
      }
    };

    if (data.type === TransactionType.TRANSFER) {
      if (!fromWallet || !toWallet) throw new BadRequestException('Pick both wallets');
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
    } else if (data.type === TransactionType.CONVERSION) {
      if (!fromWallet || !toWallet) throw new BadRequestException('Pick both wallets');
      if (fromWallet.currency === toWallet.currency) {
        throw new BadRequestException('Use Moved money for the same currency');
      }
      if (data.currency !== fromWallet.currency) {
        throw new BadRequestException('Amount currency must match the from-wallet');
      }
      if (!data.fxRate) throw new BadRequestException('Enter the rate used');
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
    } else if (WALLET_OUT_TYPES.includes(data.type)) {
      if (!fromWallet) throw new BadRequestException('Paid from which wallet?');
      if (data.currency !== fromWallet.currency) {
        throw new BadRequestException('Amount currency must match the wallet');
      }
      requireUsdRate();
      data.toWalletId = null;
      data.toAmount = null;
    } else if (WALLET_IN_TYPES.includes(data.type)) {
      if (!toWallet) throw new BadRequestException('Into which wallet?');
      if (data.currency !== toWallet.currency) {
        throw new BadRequestException('Amount currency must match the wallet');
      }
      requireUsdRate();
      data.fromWalletId = null;
      data.toAmount = null;
    } else if (NO_WALLET_TYPES.includes(data.type)) {
      requireUsdRate();
      data.fromWalletId = null;
      data.toWalletId = null;
      data.toAmount = null;
    } else if (WALLET_OPTIONAL_OUT.includes(data.type)) {
      if (fromWallet && data.currency !== fromWallet.currency) {
        throw new BadRequestException('Amount currency must match the wallet');
      }
      requireUsdRate();
      data.toWalletId = null;
      data.toAmount = null;
    } else if (WALLET_OPTIONAL_IN.includes(data.type)) {
      if (toWallet && data.currency !== toWallet.currency) {
        throw new BadRequestException('Amount currency must match the wallet');
      }
      requireUsdRate();
      data.fromWalletId = null;
      data.toAmount = null;
    }

    if (PERSON_REQUIRED_TYPES.includes(data.type) && !data.personId) {
      throw new BadRequestException('Pick a person');
    }
    if (data.type === TransactionType.INCOME && !data.personId && !data.incomeSource) {
      throw new BadRequestException('Say who it came from');
    }

    if (data.type !== TransactionType.EXPENSE) {
      data.categoryId = null;
      data.merchantId = null;
    }
    if (data.type === TransactionType.INCOME) {
      data.incomeType = data.incomeType ?? 'Other';
    } else {
      data.incomeSource = null;
      data.incomeType = null;
    }
    if (data.type !== TransactionType.CHARITY) {
      data.isZakat = false;
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

    if (data.items && data.items.length > 0) {
      if (data.type !== TransactionType.EXPENSE) {
        throw new BadRequestException('Items are only for spending');
      }
      for (const item of data.items) {
        if (!item.productId && !item.label) {
          throw new BadRequestException('Every line needs a product or a label');
        }
      }
      const sum = data.items.reduce((total, item) => total + item.lineTotal, 0);
      if (Math.abs(sum - data.amount) > 0.02) {
        throw new BadRequestException('Items must add up to the amount');
      }
      const productIds = data.items
        .map((item) => item.productId)
        .filter((id): id is string => id !== null);
      if (productIds.length > 0) {
        const owned = await this.prisma.product.count({
          where: { id: { in: productIds }, userId },
        });
        if (owned !== new Set(productIds).size) {
          throw new NotFoundException('Product not found');
        }
      }
    }

    return data;
  }

  /** Direction-flip confirms and hard caps for debt entries (secs 46, 51, 44). */
  private async guardDebtLimits(
    userId: string,
    data: NormalizedTransaction,
    force: boolean,
  ): Promise<void> {
    const needsPosition: TransactionType[] = [
      TransactionType.REPAY_IN,
      TransactionType.REPAY_OUT,
      TransactionType.WORK_OFFSET,
      TransactionType.WRITE_OFF,
      TransactionType.BALANCE_OUT,
      TransactionType.COMMITTEE_PAY,
    ];
    if (!needsPosition.includes(data.type) || !data.personId) return;

    const position = await this.debts.positionFor(userId, data.personId);
    const pkr =
      data.currency === Currency.PKR ? data.amount : data.amount * (data.fxRate ?? 0);
    const epsilon = 0.01;

    switch (data.type) {
      case TransactionType.REPAY_OUT:
      case TransactionType.WORK_OFFSET:
        if (!force && pkr > position.iOwePkr + epsilon) {
          throw new ConflictException('More than you owe — this flips it. Save anyway?');
        }
        break;
      case TransactionType.REPAY_IN:
        if (!force && pkr > position.owedToMePkr + epsilon) {
          throw new ConflictException('More than they owe — this flips it. Save anyway?');
        }
        break;
      case TransactionType.WRITE_OFF:
        if (pkr > position.owedToMePkr + epsilon) {
          throw new BadRequestException('Only up to what they owe');
        }
        break;
      case TransactionType.BALANCE_OUT: {
        const limit = Math.min(position.iOwePkr, position.owedToMePkr);
        if (pkr > limit + epsilon) {
          throw new BadRequestException('Only up to the smaller side');
        }
        break;
      }
      case TransactionType.COMMITTEE_PAY:
        if (data.fromWalletId === null && pkr > position.owedToMePkr + epsilon) {
          throw new BadRequestException('Only up to what they owe you');
        }
        break;
      default:
        break;
    }
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
      isZakat: tx.isZakat || undefined,
      items: tx.items.length > 0 ? tx.items.length : undefined,
    };
  }
}
