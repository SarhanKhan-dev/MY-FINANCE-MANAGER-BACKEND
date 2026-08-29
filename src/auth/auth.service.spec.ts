import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { PasswordTokensService } from './password-tokens.service';

describe('AuthService', () => {
  let service: AuthService;

  const tx = {
    user: { create: jest.fn() },
    wallet: { createMany: jest.fn() },
    category: { createMany: jest.fn() },
    userSettings: { create: jest.fn() },
    productCategory: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    product: { createMany: jest.fn() },
  };
  const prisma = {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
  const tokens = { issue: jest.fn().mockResolvedValue('https://app/set-password?token=x') };
  const mail = { sendPin: jest.fn(), sendPasswordLink: jest.fn(), send: jest.fn() };

  const baseUser = {
    id: 'u1',
    username: 'ayesha_k',
    name: 'Ayesha',
    email: 'ayesha@example.com',
    role: 'USER',
    status: UserStatus.ACTIVE,
    pinAttempts: 0,
    onboardedAt: null,
    createdAt: new Date(),
    lastLoginAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SIGNUPS_ENABLED = 'true';
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      tokens as unknown as PasswordTokensService,
      mail as unknown as MailService,
    );
  });

  describe('signup', () => {
    const input = {
      name: 'Ayesha',
      username: 'Ayesha_K',
      email: 'Ayesha@Example.com',
      password: 'longenough1',
    };

    it('refuses while signups are closed', async () => {
      process.env.SIGNUPS_ENABLED = 'false';
      await expect(service.signup(input)).rejects.toThrow(ForbiddenException);
    });

    it('creates a PENDING account and hands back the PIN once', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      tx.user.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...baseUser, ...data, id: 'u1', passwordHash: 'h', pinHash: 'h' }),
      );

      const result = await service.signup(input);

      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            username: 'ayesha_k',
            email: 'ayesha@example.com',
            status: UserStatus.PENDING,
          }),
        }),
      );
      expect(result.pin).toMatch(/^\d{4}$/);
      expect(result).not.toHaveProperty('accessToken');
      expect(mail.sendPin).toHaveBeenCalledWith('ayesha@example.com', result.pin);
    });

    it('rejects a taken username', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, username: 'ayesha_k' });
      await expect(service.signup(input)).rejects.toThrow(ConflictException);
    });
  });

  describe('login gate', () => {
    it('tells a pending user they are waiting for approval', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...baseUser,
        status: UserStatus.PENDING,
        passwordHash: await hash('secret123', 4),
      });

      await expect(service.login('ayesha_k', 'secret123')).rejects.toThrow(
        'waiting for admin approval',
      );
    });
  });

  describe('requestReset', () => {
    it('stays silent for unknown identifiers', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await service.requestReset('nobody@nowhere.com');

      expect(tokens.issue).not.toHaveBeenCalled();
      expect(mail.sendPasswordLink).not.toHaveBeenCalled();
    });

    it('issues a reset link and emails it to a known account', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);

      await service.requestReset('Ayesha@Example.com');

      expect(tokens.issue).toHaveBeenCalledWith('u1', 'RESET');
      expect(mail.sendPasswordLink).toHaveBeenCalledWith(
        'ayesha@example.com',
        'https://app/set-password?token=x',
        'reset',
      );
    });
  });

  describe('changeEmail', () => {
    it('demands the right password', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...baseUser,
        passwordHash: await hash('rightpass1', 4),
      });

      await expect(service.changeEmail('u1', 'wrongpass', 'new@example.com')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an email already used by someone else', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...baseUser,
        passwordHash: await hash('rightpass1', 4),
      });
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, id: 'u2' });

      await expect(service.changeEmail('u1', 'rightpass1', 'taken@example.com')).rejects.toThrow(
        ConflictException,
      );
    });

    it('updates the email, lowercased', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...baseUser,
        passwordHash: await hash('rightpass1', 4),
      });
      prisma.user.findFirst.mockResolvedValue(null);

      await service.changeEmail('u1', 'rightpass1', 'New@Example.com');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { email: 'new@example.com' },
      });
    });
  });
});
