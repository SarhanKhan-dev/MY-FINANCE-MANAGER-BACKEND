import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Currency, Subscription, SubscriptionPeriod, TransactionType } from '@prisma/client';
import { advanceRenewal } from '../bills/due-dates';
import { parseDateOnly, pktToday, toDateKey } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TransactionWithRefs } from '../transactions/transaction-with-refs';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly transactions: TransactionsService,
  ) {}

  list(userId: string): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: { userId },
      orderBy: [{ archivedAt: 'asc' }, { renewsOn: 'asc' }],
    });
  }

  async create(
    userId: string,
    input: {
      name: string;
      amount: number;
      currency?: Currency;
      period: SubscriptionPeriod;
      renewsOn: string;
      defaultWalletId?: string;
    },
  ): Promise<Subscription> {
    const subscription = await this.prisma.subscription.create({
      data: {
        userId,
        name: input.name,
        amount: input.amount,
        currency: input.currency ?? Currency.PKR,
        period: input.period,
        renewsOn: parseDateOnly(input.renewsOn),
        defaultWalletId: input.defaultWalletId ?? null,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.SUBSCRIPTION_CREATED,
      entityType: 'Subscription',
      entityId: subscription.id,
      after: { name: subscription.name, renews: toDateKey(subscription.renewsOn) },
    });
    return subscription;
  }

  async update(
    userId: string,
    subscriptionId: string,
    changes: {
      name?: string;
      amount?: number;
      renewsOn?: string;
      defaultWalletId?: string | null;
    },
  ): Promise<Subscription> {
    const subscription = await this.findOrFail(userId, subscriptionId);
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        name: changes.name,
        amount: changes.amount,
        renewsOn: changes.renewsOn ? parseDateOnly(changes.renewsOn) : undefined,
        defaultWalletId: changes.defaultWalletId,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.SUBSCRIPTION_UPDATED,
      entityType: 'Subscription',
      entityId: subscription.id,
      before: { name: subscription.name, renews: toDateKey(subscription.renewsOn) },
      after: { name: updated.name, renews: toDateKey(updated.renewsOn) },
    });
    return updated;
  }

  /** Confirmed renewal: one expense through the single engine, renewal date advances. */
  async renew(
    userId: string,
    subscriptionId: string,
    input: { walletId: string; date?: string },
  ): Promise<{ subscription: Subscription; transaction: TransactionWithRefs }> {
    const subscription = await this.findOrFail(userId, subscriptionId);
    if (subscription.archivedAt) {
      throw new BadRequestException('This subscription is archived');
    }
    const date = input.date ?? toDateKey(pktToday());

    const transaction = await this.transactions.create(
      userId,
      {
        type: TransactionType.EXPENSE,
        date,
        amount: Number(subscription.amount),
        currency: subscription.currency,
        fromWalletId: input.walletId,
        note: subscription.name,
        force: true,
      },
      undefined,
      { subscriptionId: subscription.id },
    );

    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { renewsOn: advanceRenewal(subscription.renewsOn, subscription.period) },
    });
    await this.events.record({
      userId,
      type: EventTypes.SUBSCRIPTION_RENEWED,
      entityType: 'Subscription',
      entityId: subscription.id,
      after: { name: subscription.name, paidOn: date, nextRenewal: toDateKey(updated.renewsOn) },
    });
    return { subscription: updated, transaction };
  }

  async archive(userId: string, subscriptionId: string): Promise<Subscription> {
    const subscription = await this.findOrFail(userId, subscriptionId);
    return this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { archivedAt: new Date() },
    });
  }

  async remove(userId: string, subscriptionId: string): Promise<void> {
    const subscription = await this.findOrFail(userId, subscriptionId);
    const used = await this.prisma.transaction.count({
      where: { userId, subscriptionId: subscription.id },
    });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.subscription.delete({ where: { id: subscription.id } });
  }

  private async findOrFail(userId: string, subscriptionId: string): Promise<Subscription> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, userId },
    });
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    return subscription;
  }
}
