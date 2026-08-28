import { Currency, Prisma, WalletKind } from '@prisma/client';

export const DEFAULT_WALLETS: { name: string; kind: WalletKind; currency: Currency }[] = [
  { name: 'Cash', kind: WalletKind.CASH, currency: Currency.PKR },
  { name: 'Cash (USD)', kind: WalletKind.CASH, currency: Currency.USD },
  { name: 'Bank', kind: WalletKind.BANK, currency: Currency.PKR },
  { name: 'EasyPaisa', kind: WalletKind.MOBILE, currency: Currency.PKR },
  { name: 'JazzCash', kind: WalletKind.MOBILE, currency: Currency.PKR },
];

export const DEFAULT_CATEGORIES = [
  'Food',
  'Dining out',
  'Grocery',
  'Transport',
  'Health',
  'Utilities',
  'Shopping',
  'Staff salaries',
  'Charity',
  'Gifts',
  'Written off',
  'Other',
];

export async function seedUserDefaults(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.wallet.createMany({
    data: DEFAULT_WALLETS.map((wallet) => ({ ...wallet, userId })),
  });
  await tx.category.createMany({
    data: DEFAULT_CATEGORIES.map((name) => ({ name, userId })),
  });
  await tx.userSettings.create({ data: { userId } });
}
