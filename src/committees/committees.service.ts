import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Committee, TransactionType } from '@prisma/client';
import { parseDateOnly, pktToday, toDateKey } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';

export type MonthStatus = 'PAID' | 'OVERDUE' | 'CURRENT' | 'UPCOMING';

export interface CommitteeMonth {
  monthKey: string;
  turn: number;
  isMine: boolean;
  status: MonthStatus;
}

export interface CommitteeView {
  id: string;
  name: string;
  organizerId: string;
  organizerName: string;
  installmentPkr: number;
  totalMembers: number;
  potPkr: number;
  myTurn: number;
  months: CommitteeMonth[];
  paidCount: number;
  paidTotalPkr: number;
  overdueCount: number;
  payoutReceived: boolean;
  nextUnpaidMonth: string | null;
  archived: boolean;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function shiftMonth(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

@Injectable()
export class CommitteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly transactions: TransactionsService,
  ) {}

  private async view(
    committee: Committee & { organizer: { name: string } },
  ): Promise<CommitteeView> {
    const entries = await this.prisma.transaction.findMany({
      where: { userId: committee.userId, committeeId: committee.id },
      select: { type: true, committeeMonth: true, amount: true },
    });
    const paidMonths = new Set(
      entries
        .filter((entry) => entry.type === TransactionType.COMMITTEE_PAY)
        .map((entry) => (entry.committeeMonth ? toDateKey(entry.committeeMonth) : '')),
    );
    const payoutReceived = entries.some(
      (entry) => entry.type === TransactionType.COMMITTEE_PAYOUT,
    );

    const currentMonth = monthStart(pktToday());
    const months: CommitteeMonth[] = [];
    let paidTotal = 0;
    let overdue = 0;
    let nextUnpaid: string | null = null;
    for (let index = 0; index < committee.totalMembers; index += 1) {
      const month = shiftMonth(monthStart(committee.startMonth), index);
      const monthKey = toDateKey(month);
      const paid = paidMonths.has(monthKey);
      let status: MonthStatus;
      if (paid) {
        status = 'PAID';
        paidTotal += Number(committee.installmentPkr);
      } else if (month < currentMonth) {
        status = 'OVERDUE';
        overdue += 1;
      } else if (month.getTime() === currentMonth.getTime()) {
        status = 'CURRENT';
      } else {
        status = 'UPCOMING';
      }
      if (!paid && nextUnpaid === null && month <= currentMonth) nextUnpaid = monthKey;
      months.push({
        monthKey,
        turn: index + 1,
        isMine: index + 1 === committee.myTurn,
        status,
      });
    }
    if (nextUnpaid === null) {
      nextUnpaid = months.find((month) => month.status !== 'PAID')?.monthKey ?? null;
    }

    return {
      id: committee.id,
      name: committee.name,
      organizerId: committee.organizerId,
      organizerName: committee.organizer.name,
      installmentPkr: Number(committee.installmentPkr),
      totalMembers: committee.totalMembers,
      potPkr: Number(committee.potPkr),
      myTurn: committee.myTurn,
      months,
      paidCount: paidMonths.size,
      paidTotalPkr: paidTotal,
      overdueCount: overdue,
      payoutReceived,
      nextUnpaidMonth: nextUnpaid,
      archived: committee.archivedAt !== null,
    };
  }

  async list(userId: string): Promise<CommitteeView[]> {
    const committees = await this.prisma.committee.findMany({
      where: { userId },
      include: { organizer: { select: { name: true } } },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
    });
    return Promise.all(committees.map((committee) => this.view(committee)));
  }

  async create(
    userId: string,
    input: {
      name: string;
      organizerId: string;
      installmentPkr: number;
      totalMembers: number;
      potPkr?: number;
      startMonth: string;
      myTurn: number;
    },
  ): Promise<Committee> {
    const organizer = await this.prisma.person.findFirst({
      where: { id: input.organizerId, userId },
    });
    if (!organizer) {
      throw new NotFoundException('Organizer not found');
    }
    if (input.myTurn > input.totalMembers) {
      throw new BadRequestException('Your turn cannot be after the last month');
    }
    const committee = await this.prisma.committee.create({
      data: {
        userId,
        name: input.name,
        organizerId: input.organizerId,
        installmentPkr: input.installmentPkr,
        totalMembers: input.totalMembers,
        potPkr: input.potPkr ?? input.installmentPkr * input.totalMembers,
        startMonth: monthStart(parseDateOnly(input.startMonth)),
        myTurn: input.myTurn,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.COMMITTEE_CREATED,
      entityType: 'Committee',
      entityId: committee.id,
      after: { name: committee.name, members: committee.totalMembers },
    });
    return committee;
  }

  /**
   * Pay one month — cash from a wallet, settled against the organizer's ledger,
   * or marked as already paid before tracking started (no money moves).
   */
  async pay(
    userId: string,
    committeeId: string,
    input: {
      monthKey?: string;
      walletId?: string;
      viaLedger?: boolean;
      alreadyPaid?: boolean;
      date?: string;
    },
  ) {
    const committee = await this.activeOrFail(userId, committeeId);
    if (!input.walletId && !input.viaLedger && !input.alreadyPaid) {
      throw new BadRequestException('Pick a wallet, or settle it from their ledger');
    }

    const committeeView = await this.view(committee);
    const monthKey = input.monthKey ?? committeeView.nextUnpaidMonth;
    if (!monthKey) {
      throw new BadRequestException('Every month is already paid');
    }
    const month = committeeView.months.find((entry) => entry.monthKey === monthKey);
    if (!month) {
      throw new BadRequestException('That month is not part of this committee');
    }
    if (month.status === 'PAID') {
      throw new ConflictException(`Already paid for ${monthKey.slice(0, 7)}`);
    }

    const transaction = await this.transactions.create(
      userId,
      {
        type: TransactionType.COMMITTEE_PAY,
        date: input.date ?? (input.alreadyPaid ? monthKey : toDateKey(pktToday())),
        amount: Number(committee.installmentPkr),
        currency: 'PKR',
        fromWalletId: input.viaLedger || input.alreadyPaid ? undefined : input.walletId,
        // A backfilled month touches neither a wallet nor the organizer's ledger.
        personId: input.alreadyPaid ? undefined : committee.organizerId,
        note: `${committee.name} — installment${input.alreadyPaid ? ' (before tracking)' : ''}`,
        force: true,
      },
      undefined,
      { committeeId: committee.id, committeeMonth: parseDateOnly(monthKey) },
    );

    await this.events.record({
      userId,
      type: EventTypes.COMMITTEE_PAID,
      entityType: 'Committee',
      entityId: committee.id,
      after: {
        name: committee.name,
        month: monthKey.slice(0, 7),
        viaLedger: Boolean(input.viaLedger),
        alreadyPaid: Boolean(input.alreadyPaid),
      },
    });
    return transaction;
  }

  async payout(
    userId: string,
    committeeId: string,
    input: { walletId?: string; amount?: number; alreadyReceived?: boolean; date?: string },
  ) {
    const committee = await this.activeOrFail(userId, committeeId);
    if (!input.walletId && !input.alreadyReceived) {
      throw new BadRequestException('Into which wallet?');
    }
    const myMonth = shiftMonth(monthStart(committee.startMonth), committee.myTurn - 1);

    const transaction = await this.transactions.create(
      userId,
      {
        type: TransactionType.COMMITTEE_PAYOUT,
        date: input.date ?? (input.alreadyReceived ? toDateKey(myMonth) : toDateKey(pktToday())),
        amount: input.amount ?? Number(committee.potPkr),
        currency: 'PKR',
        toWalletId: input.alreadyReceived ? undefined : input.walletId,
        // Received before tracking: the cash already sits in an opening balance.
        personId: input.alreadyReceived ? undefined : committee.organizerId,
        note: `${committee.name} — payout${input.alreadyReceived ? ' (before tracking)' : ''}`,
        force: true,
      },
      undefined,
      { committeeId: committee.id, committeeMonth: myMonth },
    );

    await this.events.record({
      userId,
      type: EventTypes.COMMITTEE_PAYOUT_RECEIVED,
      entityType: 'Committee',
      entityId: committee.id,
      after: { name: committee.name, amount: Number(transaction.amount) },
    });
    return transaction;
  }

  async archive(userId: string, committeeId: string): Promise<Committee> {
    const committee = await this.findOrFail(userId, committeeId);
    return this.prisma.committee.update({
      where: { id: committee.id },
      data: { archivedAt: new Date() },
    });
  }

  async remove(userId: string, committeeId: string): Promise<void> {
    const committee = await this.findOrFail(userId, committeeId);
    const used = await this.prisma.transaction.count({
      where: { userId, committeeId: committee.id },
    });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.committee.delete({ where: { id: committee.id } });
  }

  private async activeOrFail(userId: string, committeeId: string) {
    const committee = await this.findOrFail(userId, committeeId);
    if (committee.archivedAt) {
      throw new BadRequestException('This committee is closed');
    }
    return committee;
  }

  private async findOrFail(userId: string, committeeId: string) {
    const committee = await this.prisma.committee.findFirst({
      where: { id: committeeId, userId },
      include: { organizer: { select: { name: true } } },
    });
    if (!committee) {
      throw new NotFoundException('Committee not found');
    }
    return committee;
  }
}
