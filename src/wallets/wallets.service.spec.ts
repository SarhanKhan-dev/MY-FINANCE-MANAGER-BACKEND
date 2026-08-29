import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletsService } from './wallets.service';

describe('WalletsService', () => {
  let service: WalletsService;

  const prisma = {
    wallet: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    transaction: { groupBy: jest.fn() },
  };
  const events = { record: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WalletsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
    );
  });

  function mockLedger({
    outgoing = [],
    incoming = [],
    conversionsIn = [],
  }: {
    outgoing?: { fromWalletId: string; amount: number }[];
    incoming?: { toWalletId: string; amount: number }[];
    conversionsIn?: { toWalletId: string; toAmount: number }[];
  }) {
    prisma.transaction.groupBy.mockImplementation((args: { where: { type?: unknown } }) => {
      const typeFilter = args.where.type as { not?: string } | string | undefined;
      if (typeFilter === undefined) {
        return Promise.resolve(
          outgoing.map((row) => ({
            fromWalletId: row.fromWalletId,
            _sum: { amount: new Prisma.Decimal(row.amount) },
          })),
        );
      }
      if (typeof typeFilter === 'object' && typeFilter.not) {
        return Promise.resolve(
          incoming.map((row) => ({
            toWalletId: row.toWalletId,
            _sum: { amount: new Prisma.Decimal(row.amount) },
          })),
        );
      }
      return Promise.resolve(
        conversionsIn.map((row) => ({
          toWalletId: row.toWalletId,
          _sum: { toAmount: new Prisma.Decimal(row.toAmount) },
        })),
      );
    });
  }

  it('adds income, subtracts spending', async () => {
    mockLedger({
      incoming: [{ toWalletId: 'w1', amount: 50000 }],
      outgoing: [{ fromWalletId: 'w1', amount: 12000 }],
    });

    const balances = await service.balances('u1');

    expect(balances.get('w1')?.toFixed(2)).toBe('38000.00');
  });

  it('moves money once on a transfer — out of one wallet, into the other, total unchanged', async () => {
    mockLedger({
      incoming: [
        { toWalletId: 'bank', amount: 100000 },
        { toWalletId: 'cash', amount: 10000 },
      ],
      outgoing: [{ fromWalletId: 'bank', amount: 10000 }],
    });

    const balances = await service.balances('u1');

    expect(balances.get('bank')?.toFixed(2)).toBe('90000.00');
    expect(balances.get('cash')?.toFixed(2)).toBe('10000.00');
    const total = balances.get('bank')!.add(balances.get('cash')!);
    expect(total.toFixed(2)).toBe('100000.00');
  });

  it('credits a conversion by its converted amount, not the source amount', async () => {
    mockLedger({
      incoming: [{ toWalletId: 'usd', amount: 100 }],
      outgoing: [{ fromWalletId: 'usd', amount: 50 }],
      conversionsIn: [{ toWalletId: 'pkr', toAmount: 13925 }],
    });

    const balances = await service.balances('u1');

    expect(balances.get('usd')?.toFixed(2)).toBe('50.00');
    expect(balances.get('pkr')?.toFixed(2)).toBe('13925.00');
  });

  it('refuses to archive a wallet that still holds money', async () => {
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      name: 'Cash',
      archivedAt: null,
    });
    mockLedger({ incoming: [{ toWalletId: 'w1', amount: 500 }] });

    await expect(service.archive('u1', 'w1')).rejects.toThrow(
      'Move the money out first — balance must be zero',
    );
    expect(prisma.wallet.update).not.toHaveBeenCalled();
  });

  it('archives a wallet at exactly zero', async () => {
    prisma.wallet.findFirst.mockResolvedValue({
      id: 'w1',
      userId: 'u1',
      name: 'Cash',
      archivedAt: null,
    });
    mockLedger({
      incoming: [{ toWalletId: 'w1', amount: 500 }],
      outgoing: [{ fromWalletId: 'w1', amount: 500 }],
    });
    prisma.wallet.update.mockResolvedValue({ id: 'w1', archivedAt: new Date() });

    await service.archive('u1', 'w1');

    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { archivedAt: expect.any(Date) },
    });
  });
});
