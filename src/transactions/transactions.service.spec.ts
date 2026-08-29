import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Currency, TransactionType, WalletKind } from '@prisma/client';
import { BudgetService } from '../budget/budget.service';
import { DebtsService } from '../debts/debts.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionsService } from './transactions.service';

describe('TransactionsService', () => {
  let service: TransactionsService;

  const tx = { transaction: { create: jest.fn(), update: jest.fn(), delete: jest.fn() } };
  const prisma = {
    wallet: { findMany: jest.fn() },
    category: { findFirst: jest.fn() },
    merchant: { findFirst: jest.fn() },
    person: { findFirst: jest.fn() },
    product: { findFirst: jest.fn(), count: jest.fn() },
    transaction: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const events = { record: jest.fn() };
  const budget = { checkAlerts: jest.fn() };
  const debts = { positionFor: jest.fn() };

  const cashPkr = {
    id: 'cash',
    userId: 'u1',
    name: 'Cash',
    kind: WalletKind.CASH,
    currency: Currency.PKR,
    archivedAt: null,
  };
  const bankPkr = {
    id: 'bank',
    userId: 'u1',
    name: 'Bank',
    kind: WalletKind.BANK,
    currency: Currency.PKR,
    archivedAt: null,
  };
  const cashUsd = {
    id: 'usd',
    userId: 'u1',
    name: 'Cash (USD)',
    kind: WalletKind.CASH,
    currency: Currency.USD,
    archivedAt: null,
  };

  const createdRow = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    type: TransactionType.EXPENSE,
    date: new Date('2026-08-28T00:00:00Z'),
    amount: { toString: () => '2500', toFixed: () => '2500.00' },
    currency: Currency.PKR,
    fxRate: null,
    toAmount: null,
    fromWallet: { id: 'cash', name: 'Cash', currency: Currency.PKR },
    toWallet: null,
    category: null,
    merchant: null,
    person: null,
    incomeSource: null,
    incomeType: null,
    note: null,
    items: [],
    createdAt: new Date(),
    ...over,
  });

  function dto(over: Partial<CreateTransactionDto>): CreateTransactionDto {
    return {
      type: TransactionType.EXPENSE,
      date: '2026-08-28',
      amount: 2500,
      currency: Currency.PKR,
      ...over,
    } as CreateTransactionDto;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.wallet.findMany.mockResolvedValue([cashPkr, bankPkr, cashUsd]);
    prisma.person.findFirst.mockResolvedValue({ id: 'p1', userId: 'u1', name: 'Ali' });
    prisma.transaction.findFirst.mockResolvedValue(null);
    tx.transaction.create.mockResolvedValue(createdRow());
    budget.checkAlerts.mockResolvedValue([]);
    debts.positionFor.mockResolvedValue({
      personId: 'p1',
      iOwePkr: 0,
      owedToMePkr: 0,
      takenPkr: 0,
      writtenOffPkr: 0,
    });
    service = new TransactionsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
      budget as unknown as BudgetService,
      debts as unknown as DebtsService,
    );
  });

  describe('spending', () => {
    it('creates an expense and checks the budget thresholds', async () => {
      await service.create('u1', dto({ fromWalletId: 'cash' }));

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: TransactionType.EXPENSE,
            fromWalletId: 'cash',
            toWalletId: null,
          }),
        }),
      );
      expect(budget.checkAlerts).toHaveBeenCalledWith('u1');
      expect(events.record).toHaveBeenCalled();
    });

    it('demands a from-wallet on every outflow', async () => {
      await expect(service.create('u1', dto({ fromWalletId: undefined }))).rejects.toThrow(
        'Paid from which wallet?',
      );
    });

    it('rejects a currency that does not match the wallet', async () => {
      await expect(
        service.create('u1', dto({ fromWalletId: 'cash', currency: Currency.USD })),
      ).rejects.toThrow('Amount currency must match the wallet');
    });

    it('demands the USD rate on a USD expense', async () => {
      await expect(
        service.create('u1', dto({ fromWalletId: 'usd', currency: Currency.USD })),
      ).rejects.toThrow('Enter the USD rate');
    });

    it('refuses an archived wallet', async () => {
      prisma.wallet.findMany.mockResolvedValue([{ ...cashPkr, archivedAt: new Date() }]);

      await expect(service.create('u1', dto({ fromWalletId: 'cash' }))).rejects.toThrow(
        'From wallet is archived',
      );
    });
  });

  describe('receiving', () => {
    it('demands the destination wallet and the source', async () => {
      await expect(
        service.create('u1', dto({ type: TransactionType.INCOME, toWalletId: 'cash' })),
      ).rejects.toThrow('Say who it came from');
    });

    it('creates income with a free-text source', async () => {
      tx.transaction.create.mockResolvedValue(
        createdRow({ type: TransactionType.INCOME, fromWallet: null }),
      );

      await service.create(
        'u1',
        dto({ type: TransactionType.INCOME, toWalletId: 'cash', incomeSource: 'Freelance client' }),
      );

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            incomeSource: 'Freelance client',
            incomeType: 'Other',
            fromWalletId: null,
          }),
        }),
      );
    });
  });

  describe('moving money', () => {
    it('rejects a transfer to the same wallet', async () => {
      await expect(
        service.create(
          'u1',
          dto({ type: TransactionType.TRANSFER, fromWalletId: 'cash', toWalletId: 'cash' }),
        ),
      ).rejects.toThrow('Pick two different wallets');
    });

    it('rejects a cross-currency transfer and points to conversion', async () => {
      await expect(
        service.create(
          'u1',
          dto({ type: TransactionType.TRANSFER, fromWalletId: 'cash', toWalletId: 'usd' }),
        ),
      ).rejects.toThrow('Use Converted currency for different currencies');
    });

    it('strips spending-only fields from a transfer', async () => {
      tx.transaction.create.mockResolvedValue(createdRow({ type: TransactionType.TRANSFER }));

      await service.create(
        'u1',
        dto({
          type: TransactionType.TRANSFER,
          fromWalletId: 'bank',
          toWalletId: 'cash',
          categoryId: 'c1',
          merchantId: 'm1',
        }),
      );

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ categoryId: null, merchantId: null }),
        }),
      );
      expect(budget.checkAlerts).not.toHaveBeenCalled();
    });
  });

  describe('converting currency', () => {
    it('computes the converted amount from the rate when not given', async () => {
      tx.transaction.create.mockResolvedValue(createdRow({ type: TransactionType.CONVERSION }));

      await service.create(
        'u1',
        dto({
          type: TransactionType.CONVERSION,
          fromWalletId: 'usd',
          toWalletId: 'cash',
          currency: Currency.USD,
          amount: 50,
          fxRate: 278.5,
        }),
      );

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ toAmount: 13925 }),
        }),
      );
    });

    it('rejects a conversion between same-currency wallets', async () => {
      await expect(
        service.create(
          'u1',
          dto({
            type: TransactionType.CONVERSION,
            fromWalletId: 'bank',
            toWalletId: 'cash',
            fxRate: 1,
          }),
        ),
      ).rejects.toThrow('Use Moved money for the same currency');
    });
  });

  describe('debts', () => {
    it('demands a person on every debt entry', async () => {
      await expect(
        service.create('u1', dto({ type: TransactionType.BORROW, toWalletId: 'cash' })),
      ).rejects.toThrow('Pick a person');
    });

    it('borrowing needs the receiving wallet and moves money in', async () => {
      tx.transaction.create.mockResolvedValue(createdRow({ type: TransactionType.BORROW }));

      await service.create(
        'u1',
        dto({ type: TransactionType.BORROW, toWalletId: 'cash', personId: 'p1' }),
      );

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            toWalletId: 'cash',
            fromWalletId: null,
            personId: 'p1',
          }),
        }),
      );
    });

    it('a work offset moves no wallet money', async () => {
      debts.positionFor.mockResolvedValue({ iOwePkr: 100, owedToMePkr: 0 });
      tx.transaction.create.mockResolvedValue(createdRow({ type: TransactionType.WORK_OFFSET }));

      await service.create(
        'u1',
        dto({ type: TransactionType.WORK_OFFSET, personId: 'p1', amount: 40 }),
      );

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromWalletId: null, toWalletId: null }),
        }),
      );
    });

    it('asks before an over-repayment flips the direction', async () => {
      debts.positionFor.mockResolvedValue({ iOwePkr: 100, owedToMePkr: 0 });

      await expect(
        service.create(
          'u1',
          dto({
            type: TransactionType.REPAY_OUT,
            fromWalletId: 'cash',
            personId: 'p1',
            amount: 300,
          }),
        ),
      ).rejects.toThrow('More than you owe — this flips it. Save anyway?');
    });

    it('saves the flip when forced', async () => {
      debts.positionFor.mockResolvedValue({ iOwePkr: 100, owedToMePkr: 0 });
      tx.transaction.create.mockResolvedValue(createdRow({ type: TransactionType.REPAY_OUT }));

      await service.create(
        'u1',
        dto({
          type: TransactionType.REPAY_OUT,
          fromWalletId: 'cash',
          personId: 'p1',
          amount: 300,
          force: true,
        }),
      );

      expect(tx.transaction.create).toHaveBeenCalled();
    });

    it('blocks writing off more than they owe', async () => {
      debts.positionFor.mockResolvedValue({ iOwePkr: 0, owedToMePkr: 150 });

      await expect(
        service.create(
          'u1',
          dto({ type: TransactionType.WRITE_OFF, personId: 'p1', amount: 200 }),
        ),
      ).rejects.toThrow('Only up to what they owe');
    });

    it('blocks balancing out more than the smaller side', async () => {
      debts.positionFor.mockResolvedValue({ iOwePkr: 20, owedToMePkr: 500 });

      await expect(
        service.create(
          'u1',
          dto({ type: TransactionType.BALANCE_OUT, personId: 'p1', amount: 100 }),
        ),
      ).rejects.toThrow('Only up to the smaller side');
    });

    it('counts taken money toward budget alerts', async () => {
      tx.transaction.create.mockResolvedValue(createdRow({ type: TransactionType.TAKEN }));

      await service.create(
        'u1',
        dto({ type: TransactionType.TAKEN, fromWalletId: 'cash', personId: 'p1' }),
      );

      expect(budget.checkAlerts).toHaveBeenCalledWith('u1');
    });
  });

  describe('receipt items', () => {
    it('creates nested items when they add up to the amount', async () => {
      prisma.product.count.mockResolvedValue(1);

      await service.create(
        'u1',
        dto({
          fromWalletId: 'cash',
          amount: 640,
          items: [{ productId: 'prod1', quantity: 2, unitPrice: 320, lineTotal: 640 }],
        }),
      );

      expect(tx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: {
              create: [
                expect.objectContaining({ productId: 'prod1', lineTotal: 640, userId: 'u1' }),
              ],
            },
          }),
        }),
      );
    });

    it('rejects items that do not add up', async () => {
      await expect(
        service.create(
          'u1',
          dto({
            fromWalletId: 'cash',
            amount: 1000,
            items: [{ productId: 'prod1', quantity: 1, unitPrice: 640, lineTotal: 640 }],
          }),
        ),
      ).rejects.toThrow('Items must add up to the amount');
    });

    it('rejects items on anything except spending', async () => {
      await expect(
        service.create(
          'u1',
          dto({
            type: TransactionType.INCOME,
            toWalletId: 'cash',
            incomeSource: 'x',
            amount: 640,
            items: [{ label: 'Other', quantity: 1, unitPrice: 640, lineTotal: 640 }],
          }),
        ),
      ).rejects.toThrow('Items are only for spending');
    });

    it('rejects a line with neither product nor label', async () => {
      await expect(
        service.create(
          'u1',
          dto({
            fromWalletId: 'cash',
            amount: 640,
            items: [{ quantity: 1, unitPrice: 640, lineTotal: 640 }],
          }),
        ),
      ).rejects.toThrow('Every line needs a product or a label');
    });
  });

  describe('safety rails', () => {
    it('flags a likely duplicate within two minutes', async () => {
      prisma.transaction.findFirst.mockResolvedValue({ id: 'earlier' });

      await expect(service.create('u1', dto({ fromWalletId: 'cash' }))).rejects.toThrow(
        'Looks like a duplicate — save anyway?',
      );
    });

    it('saves anyway when forced', async () => {
      prisma.transaction.findFirst.mockResolvedValue({ id: 'earlier' });

      await service.create('u1', dto({ fromWalletId: 'cash', force: true }));

      expect(tx.transaction.create).toHaveBeenCalled();
    });

    it('returns the existing entry for a repeated idempotency key', async () => {
      const existing = createdRow();
      prisma.transaction.findUnique.mockResolvedValue(existing);

      const result = await service.create('u1', dto({ fromWalletId: 'cash' }), 'key-1');

      expect(result).toBe(existing);
      expect(tx.transaction.create).not.toHaveBeenCalled();
    });

    it('rejects references to entities the user does not own', async () => {
      prisma.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create('u1', dto({ fromWalletId: 'cash', categoryId: 'not-mine' })),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
