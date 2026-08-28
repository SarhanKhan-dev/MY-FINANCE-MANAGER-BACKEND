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
    email: 'admin@example.com',
    name: 'Admin',
    role: Role.SUPERADMIN,
    status: UserStatus.ACTIVE,
    onboardedAt: new Date('2026-01-01'),
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const target = (overrides: Partial<User> = {}): User => ({
    id: 'u2',
    email: 'ali@example.com',
    passwordHash: 'hashed',
    name: 'Ali',
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
    it('creates a USER with no password, seeds defaults, and returns an invite link', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      tx.user.create.mockResolvedValue(target({ passwordHash: null }));
      passwordTokens.issue.mockResolvedValue('https://app/set-password?token=abc');

      const result = await service.createUser(actor, 'ali@example.com', 'Ali');

      expect(tx.user.create).toHaveBeenCalledWith({
        data: { email: 'ali@example.com', name: 'Ali', role: Role.USER },
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
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: AdminActions.USER_CREATED }),
      });
    });

    it('lowercases the email before saving', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      tx.user.create.mockResolvedValue(target());
      passwordTokens.issue.mockResolvedValue('link');

      await service.createUser(actor, 'ALI@EXAMPLE.COM', 'Ali');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'ali@example.com' },
      });
      expect(tx.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ email: 'ali@example.com' }),
      });
    });

    it('rejects an email that is already used', async () => {
      prisma.user.findUnique.mockResolvedValue(target());

      await expect(service.createUser(actor, 'ali@example.com', 'Ali')).rejects.toThrow(
        ConflictException,
      );
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
        data: expect.objectContaining({ action: AdminActions.USER_DEACTIVATED }),
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
    it('deletes when the typed email matches exactly', async () => {
      prisma.user.findUnique.mockResolvedValue(target());

      await service.deleteUser(actor, 'u2', 'ali@example.com');

      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u2' } });
      expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: AdminActions.USER_DELETED }),
      });
    });

    it('rejects when the typed email does not match', async () => {
      prisma.user.findUnique.mockResolvedValue(target());

      await expect(service.deleteUser(actor, 'u2', 'other@example.com')).rejects.toThrow(
        'Type the exact email to confirm',
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('refuses to delete your own account', async () => {
      await expect(service.deleteUser(actor, 'admin1', 'admin@example.com')).rejects.toThrow(
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
      expect(result[0].email).toBe('ali@example.com');
    });
  });
});
