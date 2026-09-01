import { BadRequestException } from '@nestjs/common';
import { Currency, Prisma, TransactionType, WalletKind } from '@prisma/client';
import { DebtsService } from '../debts/debts.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { WalletsService } from './wallets.service';

describe('WalletsService', () => {
  let service: WalletsService;

  const prisma = {
    wallet: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    transaction: { groupBy: jest.fn(), findMany: jest.fn() },
  };
  const events = { record: jest.fn() };
  const transactions = { create: jest.fn() };
  const debts = { positions: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.transaction.findMany.mockResolvedValue([]);
    debts.positions.mockResolvedValue(new Map());
    service = new WalletsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
      transactions as unknown as TransactionsService,
      debts as unknown as DebtsService,
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

  describe('starting balances', () => {
    it('records an OPENING entry when a wallet starts with money', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        id: 'w1',
        userId: 'u1',
        name: 'Meezan Bank',
        kind: WalletKind.BANK,
        currency: Currency.PKR,
      });

      await service.create('u1', {
        name: 'Meezan Bank',
        kind: WalletKind.BANK,
        currency: Currency.PKR,
        openingBalance: 250000,
      });

      expect(transactions.create).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          type: TransactionType.OPENING,
          amount: 250000,
          currency: Currency.PKR,
          toWalletId: 'w1',
          note: 'Opening balance',
        }),
      );
    });

    it('skips the OPENING entry when no starting balance is given', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        id: 'w1',
        userId: 'u1',
        name: 'Cash',
        kind: WalletKind.CASH,
        currency: Currency.PKR,
      });

      await service.create('u1', {
        name: 'Cash',
        kind: WalletKind.CASH,
        currency: Currency.PKR,
      });

      expect(transactions.create).not.toHaveBeenCalled();
    });

    it('demands the USD rate before opening a USD wallet with money', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);

      await expect(
        service.create('u1', {
          name: 'Dollar stash',
          kind: WalletKind.CASH,
          currency: Currency.USD,
          openingBalance: 300,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.wallet.create).not.toHaveBeenCalled();
    });

    it('passes the rate through for a USD starting balance', async () => {
      prisma.wallet.findFirst.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        id: 'w2',
        userId: 'u1',
        name: 'Dollar stash',
        kind: WalletKind.CASH,
        currency: Currency.USD,
      });

      await service.create('u1', {
        name: 'Dollar stash',
        kind: WalletKind.CASH,
        currency: Currency.USD,
        openingBalance: 300,
        openingFxRate: 278,
      });

      expect(transactions.create).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          type: TransactionType.OPENING,
          amount: 300,
          currency: Currency.USD,
          fxRate: 278,
          toWalletId: 'w2',
        }),
      );
    });
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

  describe('loan slashes', () => {
    const borrowRow = (
      walletId: string,
      amount: number,
      personId: string,
      name: string,
      currency: Currency = Currency.PKR,
      fxRate: number | null = null,
    ) => ({
      type: TransactionType.BORROW,
      amount: new Prisma.Decimal(amount),
      currency,
      fxRate: fxRate === null ? null : new Prisma.Decimal(fxRate),
      toWalletId: walletId,
      fromWalletId: null,
      person: { id: personId, name },
    });
    const lendRow = (walletId: string, amount: number, personId: string, name: string) => ({
      type: TransactionType.LEND,
      amount: new Prisma.Decimal(amount),
      currency: Currency.PKR,
      fxRate: null,
      toWalletId: null,
      fromWalletId: walletId,
      person: { id: personId, name },
    });

    it('splits an outstanding debt across wallets by where the loan landed', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        borrowRow('bank', 40000, 'ali', 'Ali'),
        borrowRow('cash', 20000, 'ali', 'Ali'),
        lendRow('bank', 10000, 'sara', 'Sara'),
      ]);
      debts.positions.mockResolvedValue(
        new Map([
          ['ali', { personId: 'ali', iOwePkr: 30000, owedToMePkr: 0, takenPkr: 0, writtenOffPkr: 0 }],
          ['sara', { personId: 'sara', iOwePkr: 0, owedToMePkr: 4000, takenPkr: 0, writtenOffPkr: 0 }],
        ]),
      );

      const slashes = await service.loanSlashes('u1');
      expect(slashes.get('bank')).toEqual({ stillOwe: 20000, stillOwedToMe: 4000 });
      expect(slashes.get('cash')).toEqual({ stillOwe: 10000, stillOwedToMe: 0 });
    });

    it('keeps dollar loans in dollars, never converted', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        borrowRow('usd-wallet', 600, 'john', 'John', Currency.USD, 280),
      ]);
      // Half repaid in dollars: $300 still outstanding on the dollar ledger.
      debts.positions.mockResolvedValue(
        new Map([
          [
            'john',
            {
              personId: 'john',
              iOwePkr: 0,
              owedToMePkr: 0,
              takenPkr: 0,
              writtenOffPkr: 0,
              iOweUsd: 300,
              owedToMeUsd: 0,
              takenUsd: 0,
              writtenOffUsd: 0,
            },
          ],
        ]),
      );

      const slashes = await service.loanSlashes('u1');
      expect(slashes.get('usd-wallet')).toEqual({ stillOwe: 300, stillOwedToMe: 0 });
    });

    it('reports per-person flows for one wallet in its own currency', async () => {
      prisma.wallet.findFirst.mockResolvedValue({ id: 'bank', userId: 'u1', currency: Currency.PKR });
      prisma.transaction.findMany.mockResolvedValue([
        borrowRow('bank', 40000, 'ali', 'Ali'),
        borrowRow('cash', 20000, 'ali', 'Ali'),
        lendRow('bank', 10000, 'sara', 'Sara'),
      ]);
      debts.positions.mockResolvedValue(
        new Map([
          ['ali', { personId: 'ali', iOwePkr: 30000, owedToMePkr: 0, takenPkr: 0, writtenOffPkr: 0 }],
          ['sara', { personId: 'sara', iOwePkr: 0, owedToMePkr: 4000, takenPkr: 0, writtenOffPkr: 0 }],
        ]),
      );

      const view = await service.loanFlows('u1', 'bank');
      expect(view.currency).toBe(Currency.PKR);
      expect(view.borrowedIn).toBe(40000);
      expect(view.lentOut).toBe(10000);
      expect(view.stillOwe).toBe(20000);
      expect(view.stillOwedToMe).toBe(4000);
      expect(view.people[0]).toMatchObject({ personId: 'ali', borrowedIn: 40000, stillOwe: 20000 });
      expect(view.people[1]).toMatchObject({ personId: 'sara', lentOut: 10000, stillOwedToMe: 4000 });
    });

    it('leaves fully repaid wallets clean', async () => {
      prisma.transaction.findMany.mockResolvedValue([borrowRow('bank', 40000, 'ali', 'Ali')]);
      debts.positions.mockResolvedValue(new Map());
      const slashes = await service.loanSlashes('u1');
      expect(slashes.get('bank')).toEqual({ stillOwe: 0, stillOwedToMe: 0 });
    });
  });
});
