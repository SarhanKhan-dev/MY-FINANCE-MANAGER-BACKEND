import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomInt } from 'crypto';
import {
  ensureDefaultCategories,
  LEGACY_CATEGORIES,
  seedProductCatalog,
  seedUserDefaults,
} from '../src/users/user-defaults';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

interface SeedAccount {
  username: string;
  password: string;
  name: string;
  role: Role;
  email?: string;
  pin?: string;
}

async function createAccount(account: SeedAccount): Promise<void> {
  const username = account.username.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`${username} already exists — skipped.`);
    return;
  }

  const pin = account.pin ?? randomInt(0, 10000).toString().padStart(4, '0');
  const [passwordHash, pinHash] = await Promise.all([
    hash(account.password, 10),
    hash(pin, 10),
  ]);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username,
        name: account.name,
        email: account.email?.toLowerCase(),
        passwordHash,
        pinHash,
        role: account.role,
      },
    });
    await seedUserDefaults(tx, user.id);
  });
  console.log(`${account.role} ${username} created — PIN: ${pin}`);
}

async function main(): Promise<void> {
  const accounts: SeedAccount[] = [
    {
      username: requireEnv('SUPERADMIN_USERNAME'),
      password: requireEnv('SUPERADMIN_PASSWORD'),
      name: process.env.SUPERADMIN_NAME ?? 'Admin',
      email: process.env.SUPERADMIN_EMAIL,
      pin: process.env.SUPERADMIN_PIN,
      role: Role.SUPERADMIN,
    },
  ];
  if (process.env.USER1_USERNAME && process.env.USER1_PASSWORD) {
    accounts.push({
      username: process.env.USER1_USERNAME,
      password: process.env.USER1_PASSWORD,
      name: process.env.USER1_NAME ?? 'User',
      email: process.env.USER1_EMAIL,
      pin: process.env.USER1_PIN,
      role: Role.USER,
    });
  }

  for (const account of accounts) {
    await createAccount(account);
  }

  // Backfill: every existing account gets the default product catalog and any
  // newly added spending categories (duplicates skipped).
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  for (const user of users) {
    await prisma.$transaction(async (tx) => {
      await seedProductCatalog(tx, user.id);
      await ensureDefaultCategories(tx, user.id);
    });

    // Retire the old generic buckets the unified list replaced — but only where
    // they hold no history.
    for (const legacyName of LEGACY_CATEGORIES) {
      const legacy = await prisma.category.findFirst({
        where: {
          userId: user.id,
          name: { equals: legacyName, mode: 'insensitive' },
          archivedAt: null,
        },
      });
      if (!legacy) continue;
      const used = await prisma.transaction.count({
        where: { userId: user.id, categoryId: legacy.id },
      });
      if (used === 0) {
        await prisma.category.update({
          where: { id: legacy.id },
          data: { archivedAt: new Date() },
        });
        console.log(`archived unused '${legacyName}' for ${user.username}`);
      }
    }
    console.log(`catalog and categories ensured for ${user.username}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
