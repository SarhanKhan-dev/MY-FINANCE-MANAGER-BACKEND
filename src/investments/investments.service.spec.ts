import { BadRequestException } from '@nestjs/common';
import { Currency, InvestmentKind, Prisma } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { FxService } from '../fx/fx.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { InvestmentsService } from './investments.service';

describe('InvestmentsService', () => {
  let service: InvestmentsService;

  const prisma = {
    investment: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    investmentSnapshot: { findMany: jest.fn(), upsert: jest.fn() },
    transaction: { findMany: jest.fn(), count: jest.fn() },
  };
  const events = { record: jest.fn() };
  const transactions = { create: jest.fn() };
  const fx = { usdToPkrOrNull: jest.fn().mockResolvedValue(280) };

  const stock = (over: Record<string, unknown> = {}) => ({
    id: 'inv1',
    userId: 'u1',
    name: 'HBL',
    kind: InvestmentKind.STOCK,
    currency: Currency.PKR,
    units: new Prisma.Decimal(100),
    currentUnitPrice: new Prisma.Decimal(36),
    costBasis: new Prisma.Decimal(3600),
    currentValue: new Prisma.Decimal(3600),
    realizedPnl: new Prisma.Decimal(0),
    zakatable: false,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.investmentSnapshot.upsert.mockResolvedValue({});
    prisma.investmentSnapshot.findMany.mockResolvedValue([]);
    transactions.create.mockResolvedValue({ id: 't1' });
    service = new InvestmentsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
      transactions as unknown as TransactionsService,
      fx as unknown as FxService,
    );
  });

  it('the owner case: bought at 36, price drops to 30 — unrealized loss shows honestly', async () => {
    prisma.investment.findFirst.mockResolvedValue(stock());
    prisma.investment.update.mockImplementation(({ data }) =>
      Promise.resolve(stock({ ...data, currentValue: new Prisma.Decimal(data.currentValue) })),
    );

    await service.updateValue('u1', 'inv1', { unitPrice: 30 });

    expect(prisma.investment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ currentValue: 3000, currentUnitPrice: 30 }),
      }),
    );
  });

  it('takes the exact statement total for a fund and derives the NAV from it', async () => {
    prisma.investment.findFirst.mockResolvedValue(
      stock({
        kind: InvestmentKind.FUND,
        units: new Prisma.Decimal(1555.43),
        currentUnitPrice: new Prisma.Decimal(66),
      }),
    );
    prisma.investment.update.mockImplementation(({ data }) =>
      Promise.resolve(stock({ ...data, currentValue: new Prisma.Decimal(data.currentValue) })),
    );

    await service.updateValue('u1', 'inv1', { value: 103382 });

    expect(prisma.investment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentValue: 103382,
          currentUnitPrice: Math.round((103382 / 1555.43) * 10000) / 10000,
        }),
      }),
    );
  });

  it('then sold at 40 — realized gain of 4 per share on average cost', async () => {
    prisma.investment.findFirst.mockResolvedValue(stock());
    prisma.investment.update.mockImplementation(({ data }) => Promise.resolve(stock(data)));

    const { realized } = await service.sell('u1', 'inv1', {
      walletId: 'w1',
      units: 100,
      unitPrice: 40,
    });

    expect(realized).toBe(400);
    expect(transactions.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ type: 'INVESTMENT_OUT', amount: 4000, toWalletId: 'w1' }),
      undefined,
      { investmentId: 'inv1' },
    );
    expect(prisma.investment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          units: 0,
          costBasis: 0,
          currentValue: 0,
          realizedPnl: 400,
        }),
      }),
    );
  });

  it('partial sells use average cost and keep the rest tracking', async () => {
    prisma.investment.findFirst.mockResolvedValue(stock());
    prisma.investment.update.mockImplementation(({ data }) => Promise.resolve(stock(data)));

    const { realized } = await service.sell('u1', 'inv1', {
      walletId: 'w1',
      units: 40,
      unitPrice: 40,
    });

    expect(realized).toBe(160);
    expect(prisma.investment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          units: 60,
          costBasis: 2160,
          currentValue: 2400,
        }),
      }),
    );
  });

  it('blocks selling more shares than held', async () => {
    prisma.investment.findFirst.mockResolvedValue(stock());

    await expect(
      service.sell('u1', 'inv1', { walletId: 'w1', units: 150, unitPrice: 40 }),
    ).rejects.toThrow('You do not hold that many shares');
    expect(transactions.create).not.toHaveBeenCalled();
  });

  it('account withdrawals realize proportional profit', async () => {
    prisma.investment.findFirst.mockResolvedValue(
      stock({
        kind: InvestmentKind.ACCOUNT,
        units: null,
        currentUnitPrice: null,
        costBasis: new Prisma.Decimal(10000),
        currentValue: new Prisma.Decimal(12000),
      }),
    );
    prisma.investment.update.mockImplementation(({ data }) => Promise.resolve(stock(data)));

    const { realized } = await service.sell('u1', 'inv1', { walletId: 'w1', amount: 6000 });

    expect(realized).toBe(1000);
    expect(prisma.investment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ costBasis: 5000, currentValue: 6000 }),
      }),
    );
  });

  it('buying a stock adds units at cost and snapshots the value', async () => {
    prisma.investment.findFirst.mockResolvedValue(
      stock({ units: new Prisma.Decimal(0), costBasis: new Prisma.Decimal(0), currentValue: new Prisma.Decimal(0) }),
    );
    prisma.investment.update.mockImplementation(({ data }) => Promise.resolve(stock(data)));

    await service.buy('u1', 'inv1', { walletId: 'w1', units: 100, unitPrice: 36 });

    expect(transactions.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ type: 'INVESTMENT_IN', amount: 3600, fromWalletId: 'w1' }),
      undefined,
      { investmentId: 'inv1' },
    );
    expect(prisma.investmentSnapshot.upsert).toHaveBeenCalled();
  });

  it('refuses to archive a holding that still has value', async () => {
    prisma.investment.findFirst.mockResolvedValue(stock());

    await expect(service.archive('u1', 'inv1')).rejects.toThrow(BadRequestException);
  });
});
