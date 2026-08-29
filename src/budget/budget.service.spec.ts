import { Currency, Prisma, TransactionType } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { BudgetService } from './budget.service';
import { EventTypes } from '../events/event-types';

describe('BudgetService', () => {
  let service: BudgetService;

  const prisma = {
    userSettings: { upsert: jest.fn() },
    transaction: { findMany: jest.fn() },
    alertLog: { findMany: jest.fn(), createMany: jest.fn() },
  };
  const events = { record: jest.fn() };

  const settings = {
    budgetCapPkr: new Prisma.Decimal(100000),
    budgetCycleStartDay: 1,
    countLendingInCap: false,
    countWriteOffsInCap: true,
    countCommitteesInCap: false,
    countCharityInCap: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userSettings.upsert.mockResolvedValue(settings);
    prisma.alertLog.findMany.mockResolvedValue([]);
    prisma.alertLog.createMany.mockResolvedValue({ count: 0 });
    service = new BudgetService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
    );
  });

  it('sums PKR expenses and converts USD ones at their stored rate', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(30000), currency: Currency.PKR, fxRate: null },
      { amount: new Prisma.Decimal(100), currency: Currency.USD, fxRate: new Prisma.Decimal(280) },
    ]);

    const status = await service.current('u1');

    expect(status.spentPkr).toBe(58000);
    expect(status.remainingPkr).toBe(42000);
    expect(status.pct).toBe(58);
  });

  it('counts expenses, taken money, and charity by default, never lending', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);

    await service.current('u1');

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: {
            in: [
              TransactionType.EXPENSE,
              TransactionType.SALARY,
              TransactionType.TAKEN,
              TransactionType.CHARITY,
            ],
          },
        }),
      }),
    );
  });

  it('counts lending toward the cap when the toggle is on', async () => {
    prisma.userSettings.upsert.mockResolvedValue({ ...settings, countLendingInCap: true });
    prisma.transaction.findMany.mockResolvedValue([]);

    await service.current('u1');

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: {
            in: [
              TransactionType.EXPENSE,
              TransactionType.SALARY,
              TransactionType.LEND,
              TransactionType.TAKEN,
              TransactionType.CHARITY,
            ],
          },
        }),
      }),
    );
  });

  it('skips USD expenses with no stored rate instead of guessing', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(50), currency: Currency.USD, fxRate: null },
    ]);

    const status = await service.current('u1');

    expect(status.spentPkr).toBe(0);
  });

  it('fires each crossed threshold once and records events', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(85000), currency: Currency.PKR, fxRate: null },
    ]);

    const fired = await service.checkAlerts('u1');

    expect(fired).toEqual([50, 80]);
    expect(prisma.alertLog.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ threshold: 50 }),
        expect.objectContaining({ threshold: 80 }),
      ],
      skipDuplicates: true,
    });
    expect(events.record).toHaveBeenCalledTimes(2);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: EventTypes.BUDGET_THRESHOLD_CROSSED }),
    );
  });

  it('never re-fires a threshold already alerted this cycle', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(85000), currency: Currency.PKR, fxRate: null },
    ]);
    prisma.alertLog.findMany.mockResolvedValue([{ threshold: 50 }, { threshold: 80 }]);

    const fired = await service.checkAlerts('u1');

    expect(fired).toEqual([]);
    expect(prisma.alertLog.createMany).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('reports nothing when under every threshold', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(10000), currency: Currency.PKR, fxRate: null },
    ]);

    const fired = await service.checkAlerts('u1');

    expect(fired).toEqual([]);
  });
});
