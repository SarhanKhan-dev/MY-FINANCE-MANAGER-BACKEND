import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PasswordTokenPurpose, Role, User, UserStatus } from '@prisma/client';
import { PasswordTokensService } from '../auth/password-tokens.service';
import { SafeUser } from '../common/types/safe-user';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_CATEGORIES, DEFAULT_WALLETS } from './user-defaults';
import { AdminActions, UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;

  const tx = {
    user: { create: jest.fn() },
    wallet: { createMany: jest.fn() },
    category: { createMany: jest.fn() },
    userSettings: { create: jest.fn() },
  };

  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    adminAuditLog: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const passwordTokens = { issue: jest.fn() };

  const actor: SafeUser = {
    id: 'admin1',
    username: 'shams123@',
    email: 'shams@example.com',
    pinAttempts: 0,
    name: 'Shams',
    role: Role.SUPERADMIN,
    status: UserStatus.ACTIVE,
    onboardedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const target = (overrides: Partial<User> = {}): User => ({
    id: 'u2',
    username: 'sarhan321@',
    email: 'sarhan@example.com',
    passwordHash: 'hashed',
    pinHash: 'hashed-pin',
    pinAttempts: 0,
    name: 'Sarhan',
    role: Role.USER,
    status: UserStatus.ACTIVE,
    onboardedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-02-01'),
    updatedAt: new Date('2026-02-01'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(
      prisma as unknown as PrismaService,
      passwordTokens as unknown as PasswordTokensService,
    );
  });

  describe('createUser', () => {
    it('creates a USER with a starting PIN, seeds defaults, and returns the invite link', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      tx.user.create.mockResolvedValue(target({ passwordHash: null }));
      passwordTokens.issue.mockResolvedValue('https://app/set-password?token=abc');

      const result = await service.createUser(
        actor,
        'sarhan321@',
        'Sarhan',
        'sarhan@example.com',
      );

      expect(tx.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'sarhan321@',
          name: 'Sarhan',
          email: 'sarhan@example.com',
          pinHash: expect.any(String),
          role: Role.USER,
        }),
      });
      expect(tx.wallet.createMany).toHaveBeenCalledWith({
        data: DEFAULT_WALLETS.map((wallet) => ({ ...wallet, userId: 'u2' })),
      });
      expect(tx.category.createMany).toHaveBeenCalledWith({
        data: DEFAULT_CATEGORIES.map((name) => ({ name, userId: 'u2' })),
      });
      expect(tx.userSettings.create).toHaveBeenCalledWith({ data: { userId: 'u2' } });
      expect(passwordTokens.issue).toHaveBeenCalledWith('u2', PasswordTokenPurpose.INVITE, tx);
      expect(result.setPasswordLink).toBe('https://app/set-password?token=abc');
      expect(result.initialPin).toMatch(/^\d{4}$/);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: AdminActions.USER_CREATED }),
      });
    });

    it('lowercases the username and email before saving', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      tx.user.create.mockResolvedValue(target());
      passwordTokens.issue.mockResolvedValue('link');

      await service.createUser(actor, 'SARHAN321@', 'Sarhan', 'Sarhan@Example.com');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ username: 'sarhan321@' }, { email: 'sarhan@example.com' }],
        },
      });
      expect(tx.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'sarhan321@',
          email: 'sarhan@example.com',
        }),
      });
    });

    it('rejects a username that is already used', async () => {
      prisma.user.findFirst.mockResolvedValue(target());

      await expect(
        service.createUser(actor, 'sarhan321@', 'Sarhan', 'other@example.com'),
      ).rejects.toThrow('Username already used');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an email that is already used', async () => {
      prisma.user.findFirst.mockResolvedValue(target());

      await expect(
        service.createUser(actor, 'different@', 'Someone', 'sarhan@example.com'),
      ).rejects.toThrow('Email already used');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('setStatus', () => {
    it('deactivates another user and records it in the audit log', async () => {
      prisma.user.findUnique.mockResolvedValue(target());
      prisma.user.update.mockResolvedValue(target({ status: UserStatus.DEACTIVATED }));

      const result = await service.setStatus(actor, 'u2', UserStatus.DEACTIVATED);

      expect(result.status).toBe(UserStatus.DEACTIVATED);
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: AdminActions.USER_DEACTIVATED,
          actorUsername: 'shams123@',
          targetUsername: 'sarhan321@',
        }),
      });
    });

    it('reactivates a user and records it', async () => {
      prisma.user.findUnique.mockResolvedValue(target({ status: UserStatus.DEACTIVATED }));
      prisma.user.update.mockResolvedValue(target());

      await service.setStatus(actor, 'u2', UserStatus.ACTIVE);

      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: AdminActions.USER_REACTIVATED }),
      });
    });

    it('refuses to change your own status', async () => {
      await expect(service.setStatus(actor, 'admin1', UserStatus.DEACTIVATED)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('fails plainly when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.setStatus(actor, 'ghost', UserStatus.DEACTIVATED)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resetPassword', () => {
    it('issues a reset link and audits it', async () => {
      prisma.user.findUnique.mockResolvedValue(target());
      passwordTokens.issue.mockResolvedValue('https://app/set-password?token=reset');

      const result = await service.resetPassword(actor, 'u2');

      expect(passwordTokens.issue).toHaveBeenCalledWith('u2', PasswordTokenPurpose.RESET);
      expect(result.setPasswordLink).toBe('https://app/set-password?token=reset');
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: AdminActions.PASSWORD_RESET }),
      });
    });
  });

  describe('deleteUser', () => {
    it('deletes when the typed username matches exactly', async () => {
      prisma.user.findUnique.mockResolvedValue(target());

      await service.deleteUser(actor, 'u2', 'sarhan321@');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u2' } });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: AdminActions.USER_DELETED }),
      });
    });

    it('matches the confirmation case-insensitively', async () => {
      prisma.user.findUnique.mockResolvedValue(target());

      await service.deleteUser(actor, 'u2', 'SARHAN321@');

      expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('rejects when the typed username does not match', async () => {
      prisma.user.findUnique.mockResolvedValue(target());

      await expect(service.deleteUser(actor, 'u2', 'someone-else')).rejects.toThrow(
        'Type the exact username to confirm',
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete your own account', async () => {
      await expect(service.deleteUser(actor, 'admin1', 'shams123@')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('listUsers', () => {
    it('never returns password hashes', async () => {
      prisma.user.findMany.mockResolvedValue([target()]);

      const result = await service.listUsers();

      expect(result[0]).not.toHaveProperty('passwordHash');
      expect(result[0].username).toBe('sarhan321@');
    });
  });
});
