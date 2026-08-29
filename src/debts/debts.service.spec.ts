import { Currency, Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DebtsService } from './debts.service';

describe('DebtsService', () => {
  let service: DebtsService;

  const prisma = {
    transaction: { findMany: jest.fn() },
    person: { findMany: jest.fn() },
  };

  const entry = (
    type: TransactionType,
    amount: number,
    personId = 'p1',
    currency: Currency = Currency.PKR,
    fxRate: number | null = null,
    fromWalletId: string | null = null,
  ) => ({
    personId,
    type,
    amount: new Prisma.Decimal(amount),
    currency,
    fxRate: fxRate ? new Prisma.Decimal(fxRate) : null,
    fromWalletId,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.person.findMany.mockResolvedValue([{ id: 'p1', name: 'Ali' }]);
    service = new DebtsService(prisma as unknown as PrismaService);
  });

  it('keeps the two directions separate — she paying hers never cancels mine', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.BORROW, 20),
      entry(TransactionType.LEND, 30),
      entry(TransactionType.REPAY_IN, 30),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.iOwePkr).toBe(20);
    expect(position.owedToMePkr).toBe(0);
  });

  it('reduces my debt with repayments and work offsets', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.BORROW, 100),
      entry(TransactionType.REPAY_OUT, 30),
      entry(TransactionType.WORK_OFFSET, 40),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.iOwePkr).toBe(30);
  });

  it('flips the direction on an over-repayment', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.BORROW, 100),
      entry(TransactionType.REPAY_OUT, 300),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.iOwePkr).toBe(0);
    expect(position.owedToMePkr).toBe(200);
  });

  it('moves a write-off out of owed-to-me and into the written-off total', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.LEND, 500),
      entry(TransactionType.WRITE_OFF, 200),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.owedToMePkr).toBe(300);
    expect(position.writtenOffPkr).toBe(200);
  });

  it('keeps taken money out of owed-to-me entirely', async () => {
    prisma.transaction.findMany.mockResolvedValue([entry(TransactionType.TAKEN, 200)]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.owedToMePkr).toBe(0);
    expect(position.takenPkr).toBe(200);
    expect(position.writtenOffPkr).toBe(200);
  });

  it('balance-out reduces both directions at once', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.BORROW, 20),
      entry(TransactionType.LEND, 30),
      entry(TransactionType.BALANCE_OUT, 20),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.iOwePkr).toBe(0);
    expect(position.owedToMePkr).toBe(10);
  });

  it('a ledger-settled committee installment reduces what they owe you (sec 15)', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.LEND, 8000),
      entry(TransactionType.COMMITTEE_PAY, 5000),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.owedToMePkr).toBe(3000);
  });

  it('a cash committee installment leaves the ledger alone', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.LEND, 8000),
      entry(TransactionType.COMMITTEE_PAY, 5000, 'p1', Currency.PKR, null, 'wallet1'),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.owedToMePkr).toBe(8000);
  });

  it('converts USD debt entries at their stored rate', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.BORROW, 100, 'p1', Currency.USD, 280),
    ]);

    const position = await service.positionFor('u1', 'p1');

    expect(position.iOwePkr).toBe(28000);
  });

  it('sums the global summary across people with names', async () => {
    prisma.person.findMany.mockResolvedValue([
      { id: 'p1', name: 'Ali' },
      { id: 'p2', name: 'Bilal' },
    ]);
    prisma.transaction.findMany.mockResolvedValue([
      entry(TransactionType.BORROW, 100, 'p1'),
      entry(TransactionType.LEND, 250, 'p2'),
    ]);

    const summary = await service.summary('u1');

    expect(summary.iOwePkr).toBe(100);
    expect(summary.owedToMePkr).toBe(250);
    expect(summary.people.map((p) => p.name).sort()).toEqual(['Ali', 'Bilal']);
  });
});
