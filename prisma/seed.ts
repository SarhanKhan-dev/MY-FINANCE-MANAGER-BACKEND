import { PrismaClient, Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { seedUserDefaults } from '../src/users/user-defaults';

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function main(): Promise<void> {
  const email = requireEnv('SUPERADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SUPERADMIN_PASSWORD');
  const name = process.env.SUPERADMIN_NAME ?? 'Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Superadmin ${email} already exists — nothing to do.`);
    return;
  }

  const passwordHash = await hash(password, 10);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name, passwordHash, role: Role.SUPERADMIN },
    });
    await seedUserDefaults(tx, user.id);
  });
  console.log(`Superadmin ${email} created with default wallets and categories.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
