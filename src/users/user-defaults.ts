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
  'Personal care',
  'Utilities',
  'Shopping',
  'Staff salaries',
  'Charity',
  'Gifts',
  'Written off',
  'Other',
];

/** Idempotent: adds any default spending category the user doesn't have yet. */
export async function ensureDefaultCategories(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const existing = await tx.category.findMany({ where: { userId }, select: { name: true } });
  const have = new Set(existing.map((category) => category.name.toLowerCase()));
  const missing = DEFAULT_CATEGORIES.filter((name) => !have.has(name.toLowerCase()));
  if (missing.length > 0) {
    await tx.category.createMany({ data: missing.map((name) => ({ name, userId })) });
  }
}

/** Everyday Pakistani household catalog: product category -> products with their usual unit. */
export const DEFAULT_PRODUCT_CATALOG: Record<string, { name: string; unit: string }[]> = {
  'Dairy & Eggs': [
    { name: 'Eggs', unit: 'dozen' },
    { name: 'Milk', unit: 'litre' },
    { name: 'Yogurt (Dahi)', unit: 'kg' },
    { name: 'Butter', unit: 'piece' },
    { name: 'Cheese', unit: 'piece' },
    { name: 'Cream', unit: 'piece' },
    { name: 'Lassi', unit: 'litre' },
  ],
  Vegetables: [
    { name: 'Potato', unit: 'kg' },
    { name: 'Onion', unit: 'kg' },
    { name: 'Tomato', unit: 'kg' },
    { name: 'Garlic', unit: 'kg' },
    { name: 'Ginger', unit: 'kg' },
    { name: 'Green chilli', unit: 'kg' },
    { name: 'Lemon', unit: 'kg' },
    { name: 'Coriander (Dhania)', unit: 'bunch' },
    { name: 'Mint (Podina)', unit: 'bunch' },
    { name: 'Spinach (Palak)', unit: 'kg' },
    { name: 'Okra (Bhindi)', unit: 'kg' },
    { name: 'Cauliflower', unit: 'kg' },
    { name: 'Cabbage', unit: 'kg' },
    { name: 'Peas (Matar)', unit: 'kg' },
    { name: 'Carrot', unit: 'kg' },
    { name: 'Cucumber', unit: 'kg' },
    { name: 'Capsicum', unit: 'kg' },
    { name: 'Brinjal (Baingan)', unit: 'kg' },
    { name: 'Bottle gourd (Lauki)', unit: 'kg' },
    { name: 'Bitter gourd (Karela)', unit: 'kg' },
  ],
  Fruits: [
    { name: 'Banana', unit: 'dozen' },
    { name: 'Apple', unit: 'kg' },
    { name: 'Orange (Kinnow)', unit: 'dozen' },
    { name: 'Mango', unit: 'kg' },
    { name: 'Grapes', unit: 'kg' },
    { name: 'Pomegranate', unit: 'kg' },
    { name: 'Guava', unit: 'kg' },
    { name: 'Melon', unit: 'kg' },
    { name: 'Watermelon', unit: 'piece' },
    { name: 'Dates (Khajoor)', unit: 'kg' },
    { name: 'Peach', unit: 'kg' },
    { name: 'Strawberry', unit: 'kg' },
  ],
  'Meat & Fish': [
    { name: 'Chicken', unit: 'kg' },
    { name: 'Beef', unit: 'kg' },
    { name: 'Mutton', unit: 'kg' },
    { name: 'Fish', unit: 'kg' },
    { name: 'Mince (Qeema)', unit: 'kg' },
  ],
  Staples: [
    { name: 'Flour (Atta)', unit: 'kg' },
    { name: 'Rice (Basmati)', unit: 'kg' },
    { name: 'Sugar', unit: 'kg' },
    { name: 'Salt', unit: 'kg' },
    { name: 'Cooking oil', unit: 'litre' },
    { name: 'Ghee', unit: 'kg' },
    { name: 'Desi ghee', unit: 'kg' },
    { name: 'Banaspati ghee', unit: 'kg' },
    { name: 'Olive oil', unit: 'bottle' },
    { name: 'Mustard oil (Sarson)', unit: 'litre' },
    { name: 'Coconut oil', unit: 'bottle' },
    { name: 'Daal Chana', unit: 'kg' },
    { name: 'Daal Masoor', unit: 'kg' },
    { name: 'Daal Moong', unit: 'kg' },
    { name: 'Daal Mash', unit: 'kg' },
    { name: 'White chana', unit: 'kg' },
    { name: 'Lobia (beans)', unit: 'kg' },
    { name: 'Besan', unit: 'kg' },
    { name: 'Sooji', unit: 'kg' },
    { name: 'Maida', unit: 'kg' },
    { name: 'Vermicelli (Seviyan)', unit: 'packet' },
  ],
  'Spices & Condiments': [
    { name: 'Red chilli powder', unit: 'packet' },
    { name: 'Turmeric (Haldi)', unit: 'packet' },
    { name: 'Coriander powder', unit: 'packet' },
    { name: 'Garam masala', unit: 'packet' },
    { name: 'Cumin (Zeera)', unit: 'packet' },
    { name: 'Black pepper', unit: 'packet' },
    { name: 'Recipe masala', unit: 'packet' },
    { name: 'Ketchup', unit: 'bottle' },
    { name: 'Vinegar', unit: 'bottle' },
    { name: 'Soy sauce', unit: 'bottle' },
    { name: 'Pickle (Achar)', unit: 'jar' },
  ],
  'Bakery & Breakfast': [
    { name: 'Bread', unit: 'packet' },
    { name: 'Rusk', unit: 'packet' },
    { name: 'Jam', unit: 'jar' },
    { name: 'Honey', unit: 'bottle' },
    { name: 'Peanut butter', unit: 'jar' },
    { name: 'Cereal', unit: 'packet' },
    { name: 'Oats', unit: 'packet' },
    { name: 'Frozen paratha', unit: 'packet' },
  ],
  Beverages: [
    { name: 'Tea', unit: 'packet' },
    { name: 'Green tea', unit: 'packet' },
    { name: 'Coffee', unit: 'jar' },
    { name: 'Cold drink', unit: 'bottle' },
    { name: 'Juice', unit: 'bottle' },
    { name: 'Squash', unit: 'bottle' },
    { name: 'Mineral water', unit: 'bottle' },
  ],
  Snacks: [
    { name: 'Biscuits', unit: 'packet' },
    { name: 'Chips', unit: 'packet' },
    { name: 'Nimko', unit: 'packet' },
    { name: 'Chocolate', unit: 'piece' },
    { name: 'Ice cream', unit: 'piece' },
  ],
  'Cleaning & Laundry': [
    { name: 'Detergent (Surf)', unit: 'kg' },
    { name: 'Dishwash liquid', unit: 'bottle' },
    { name: 'Dishwash bar', unit: 'piece' },
    { name: 'Bleach', unit: 'bottle' },
    { name: 'Phenyl', unit: 'bottle' },
    { name: 'Toilet cleaner', unit: 'bottle' },
    { name: 'Broom', unit: 'piece' },
    { name: 'Sponge / scrubber', unit: 'piece' },
    { name: 'Trash bags', unit: 'packet' },
  ],
  'Personal care': [
    { name: 'Soap', unit: 'piece' },
    { name: 'Shampoo', unit: 'bottle' },
    { name: 'Toothpaste', unit: 'piece' },
    { name: 'Toothbrush', unit: 'piece' },
    { name: 'Face wash', unit: 'piece' },
    { name: 'Lotion', unit: 'bottle' },
    { name: 'Sanitary pads', unit: 'packet' },
    { name: 'Razor', unit: 'piece' },
    { name: 'Tissue box', unit: 'piece' },
    { name: 'Toilet paper', unit: 'packet' },
    { name: 'Haircut (barber)', unit: 'visit' },
    { name: 'Shave (barber)', unit: 'visit' },
    { name: 'Salon visit', unit: 'visit' },
    { name: 'Facial', unit: 'visit' },
    { name: 'Hair colour', unit: 'visit' },
    { name: 'Hair oil', unit: 'bottle' },
    { name: 'Hair gel', unit: 'piece' },
    { name: 'Perfume', unit: 'bottle' },
    { name: 'Deodorant', unit: 'piece' },
  ],
  'Vehicle & Fuel': [
    { name: 'Petrol', unit: 'litre' },
    { name: 'Diesel', unit: 'litre' },
    { name: 'CNG', unit: 'kg' },
    { name: 'Engine oil', unit: 'litre' },
    { name: 'Oil change', unit: 'visit' },
    { name: 'Bike tuning', unit: 'visit' },
    { name: 'Car service', unit: 'visit' },
    { name: 'Car wash', unit: 'visit' },
    { name: 'Puncture repair', unit: 'visit' },
    { name: 'Tyre', unit: 'piece' },
    { name: 'Air filter', unit: 'piece' },
    { name: 'Spark plug', unit: 'piece' },
    { name: 'Brake pads', unit: 'piece' },
    { name: 'Vehicle battery', unit: 'piece' },
    { name: 'Toll', unit: 'trip' },
    { name: 'Parking', unit: 'trip' },
  ],
  Household: [
    { name: 'Matchbox', unit: 'piece' },
    { name: 'Candles', unit: 'packet' },
    { name: 'Light bulb', unit: 'piece' },
    { name: 'Batteries', unit: 'packet' },
    { name: 'Aluminium foil', unit: 'roll' },
  ],
};

/** Idempotent: safe to run again for an existing user — duplicates are skipped. */
export async function seedProductCatalog(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const categoryNames = Object.keys(DEFAULT_PRODUCT_CATALOG);
  await tx.productCategory.createMany({
    data: categoryNames.map((name) => ({ name, userId })),
    skipDuplicates: true,
  });
  const categories = await tx.productCategory.findMany({
    where: { userId, name: { in: categoryNames } },
    select: { id: true, name: true },
  });
  const idByName = new Map(categories.map((category) => [category.name, category.id]));
  await tx.product.createMany({
    data: categoryNames.flatMap((categoryName) =>
      DEFAULT_PRODUCT_CATALOG[categoryName].map((product) => ({
        userId,
        name: product.name,
        unit: product.unit,
        productCategoryId: idByName.get(categoryName) ?? null,
      })),
    ),
    skipDuplicates: true,
  });
}

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
  await seedProductCatalog(tx, userId);
}
