import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Bill, Currency, RepeatRule, TransactionType } from '@prisma/client';
import { parseDateOnly, pktToday, toDateKey } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionWithRefs } from '../transactions/transaction-with-refs';
import { advanceDueDate } from './due-dates';

export type BillStatus = 'OVERDUE' | 'DUE_SOON' | 'UPCOMING' | 'PAID';

export interface BillWithStatus {
  bill: Bill;
  status: BillStatus;
}

export interface PayBillInput {
  walletId: string;
  amount?: number;
  date?: string;
}

@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly transactions: TransactionsService,
  ) {}

  private status(bill: Bill): BillStatus {
    if (bill.repeat === RepeatRule.ONCE && bill.lastPaidOn) return 'PAID';
    const today = pktToday();
    if (bill.nextDueOn < today) return 'OVERDUE';
    const daysAway =
      (bill.nextDueOn.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
    return daysAway <= bill.reminderDays ? 'DUE_SOON' : 'UPCOMING';
  }

  async list(userId: string): Promise<BillWithStatus[]> {
    const bills = await this.prisma.bill.findMany({
      where: { userId },
      orderBy: [{ archivedAt: 'asc' }, { nextDueOn: 'asc' }],
    });
    return bills.map((bill) => ({ bill, status: this.status(bill) }));
  }

  async create(
    userId: string,
    input: {
      name: string;
      amount?: number;
      currency?: Currency;
      repeat: RepeatRule;
      firstDueOn: string;
      reminderDays?: number;
      defaultWalletId?: string;
      categoryId?: string;
    },
  ): Promise<Bill> {
    const bill = await this.prisma.bill.create({
      data: {
        userId,
        name: input.name,
        amount: input.amount ?? null,
        currency: input.currency ?? Currency.PKR,
        repeat: input.repeat,
        nextDueOn: parseDateOnly(input.firstDueOn),
        reminderDays: input.reminderDays ?? 2,
        defaultWalletId: input.defaultWalletId ?? null,
        categoryId: input.categoryId ?? null,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.BILL_CREATED,
      entityType: 'Bill',
      entityId: bill.id,
      after: { name: bill.name, due: toDateKey(bill.nextDueOn), repeat: bill.repeat },
    });
    return bill;
  }

  async update(
    userId: string,
    billId: string,
    changes: {
      name?: string;
      amount?: number | null;
      nextDueOn?: string;
      reminderDays?: number;
      defaultWalletId?: string | null;
      categoryId?: string | null;
    },
  ): Promise<Bill> {
    const bill = await this.findOrFail(userId, billId);
    const updated = await this.prisma.bill.update({
      where: { id: bill.id },
      data: {
        name: changes.name,
        amount: changes.amount,
        nextDueOn: changes.nextDueOn ? parseDateOnly(changes.nextDueOn) : undefined,
        reminderDays: changes.reminderDays,
        defaultWalletId: changes.defaultWalletId,
        categoryId: changes.categoryId,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.BILL_UPDATED,
      entityType: 'Bill',
      entityId: bill.id,
      before: { name: bill.name, due: toDateKey(bill.nextDueOn) },
      after: { name: updated.name, due: toDateKey(updated.nextDueOn) },
    });
    return updated;
  }

  /** Mark paid: one expense through the single engine, then the due date advances. */
  async pay(
    userId: string,
    billId: string,
    input: PayBillInput,
  ): Promise<{ bill: Bill; transaction: TransactionWithRefs }> {
    const bill = await this.findOrFail(userId, billId);
    if (bill.archivedAt) {
      throw new BadRequestException('This bill is archived');
    }
    const amount = input.amount ?? (bill.amount ? Number(bill.amount) : undefined);
    if (!amount) {
      throw new BadRequestException('Enter the amount for this bill');
    }
    const date = input.date ?? toDateKey(pktToday());

    const transaction = await this.transactions.create(
      userId,
      {
        type: TransactionType.EXPENSE,
        date,
        amount,
        currency: bill.currency,
        fromWalletId: input.walletId,
        categoryId: bill.categoryId ?? undefined,
        note: bill.name,
        force: true,
      },
      undefined,
      { billId: bill.id },
    );

    const nextDueOn = advanceDueDate(bill.nextDueOn, bill.repeat);
    const updated = await this.prisma.bill.update({
      where: { id: bill.id },
      data: {
        lastPaidOn: parseDateOnly(date),
        nextDueOn: nextDueOn ?? bill.nextDueOn,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.BILL_PAID,
      entityType: 'Bill',
      entityId: bill.id,
      after: { name: bill.name, paidOn: date, amount },
    });
    return { bill: updated, transaction };
  }

  async archive(userId: string, billId: string): Promise<Bill> {
    const bill = await this.findOrFail(userId, billId);
    return this.prisma.bill.update({
      where: { id: bill.id },
      data: { archivedAt: new Date() },
    });
  }

  async remove(userId: string, billId: string): Promise<void> {
    const bill = await this.findOrFail(userId, billId);
    const used = await this.prisma.transaction.count({ where: { userId, billId: bill.id } });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.bill.delete({ where: { id: bill.id } });
  }

  private async findOrFail(userId: string, billId: string): Promise<Bill> {
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, userId } });
    if (!bill) {
      throw new NotFoundException('Bill not found');
    }
    return bill;
  }
}
