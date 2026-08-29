import { ConflictException } from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { CommitteesService } from './committees.service';

function monthShift(offset: number): Date {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

describe('CommitteesService', () => {
  let service: CommitteesService;

  const prisma = {
    committee: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    transaction: { findMany: jest.fn(), count: jest.fn() },
    person: { findFirst: jest.fn() },
  };
  const events = { record: jest.fn() };
  const transactions = { create: jest.fn() };

  const committee = () => ({
    id: 'c1',
    userId: 'u1',
    name: 'Office BC',
    organizerId: 'p1',
    organizer: { name: 'Bilal' },
    installmentPkr: new Prisma.Decimal(10000),
    totalMembers: 4,
    potPkr: new Prisma.Decimal(40000),
    startMonth: monthShift(-2),
    myTurn: 3,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    transactions.create.mockResolvedValue({ id: 't1', amount: new Prisma.Decimal(10000) });
    service = new CommitteesService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
      transactions as unknown as TransactionsService,
    );
  });

  it('builds the month schedule with paid, overdue, current, mine, and upcoming', async () => {
    prisma.committee.findMany.mockResolvedValue([committee()]);
    prisma.transaction.findMany.mockResolvedValue([
      { type: TransactionType.COMMITTEE_PAY, committeeMonth: monthShift(-2), amount: new Prisma.Decimal(10000) },
    ]);

    const [view] = await service.list('u1');

    expect(view.months.map((month) => month.status)).toEqual([
      'PAID',
      'OVERDUE',
      'CURRENT',
      'UPCOMING',
    ]);
    expect(view.months[2].isMine).toBe(true);
    expect(view.paidTotalPkr).toBe(10000);
    expect(view.overdueCount).toBe(1);
    expect(view.nextUnpaidMonth).toBe(monthShift(-1).toISOString().slice(0, 10));
  });

  it('pays the first unpaid month through the single engine, linked to the organizer', async () => {
    prisma.committee.findFirst.mockResolvedValue(committee());
    prisma.transaction.findMany.mockResolvedValue([]);

    await service.pay('u1', 'c1', { walletId: 'w1' });

    expect(transactions.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        type: TransactionType.COMMITTEE_PAY,
        amount: 10000,
        fromWalletId: 'w1',
        personId: 'p1',
      }),
      undefined,
      expect.objectContaining({ committeeId: 'c1', committeeMonth: monthShift(-2) }),
    );
  });

  it('a ledger settlement sends no wallet at all', async () => {
    prisma.committee.findFirst.mockResolvedValue(committee());
    prisma.transaction.findMany.mockResolvedValue([]);

    await service.pay('u1', 'c1', { viaLedger: true });

    expect(transactions.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ fromWalletId: undefined, personId: 'p1' }),
      undefined,
      expect.anything(),
    );
  });

  it('refuses to pay the same month twice', async () => {
    prisma.committee.findFirst.mockResolvedValue(committee());
    prisma.transaction.findMany.mockResolvedValue([
      { type: TransactionType.COMMITTEE_PAY, committeeMonth: monthShift(-2), amount: new Prisma.Decimal(10000) },
    ]);

    await expect(
      service.pay('u1', 'c1', {
        walletId: 'w1',
        monthKey: monthShift(-2).toISOString().slice(0, 10),
      }),
    ).rejects.toThrow(ConflictException);
  });
});
