import { Prisma } from '@prisma/client';

export const transactionInclude = {
  fromWallet: { select: { id: true, name: true, currency: true } },
  toWallet: { select: { id: true, name: true, currency: true } },
  category: { select: { id: true, name: true } },
  merchant: { select: { id: true, name: true } },
  person: { select: { id: true, name: true } },
  forPeople: { select: { person: { select: { id: true, name: true } } } },
  items: {
    select: {
      id: true,
      label: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      product: { select: { id: true, name: true, unit: true } },
    },
  },
} satisfies Prisma.TransactionInclude;

export type TransactionWithRefs = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;
