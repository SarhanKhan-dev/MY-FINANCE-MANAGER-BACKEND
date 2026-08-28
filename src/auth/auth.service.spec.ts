import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PasswordTokenPurpose, Role, User, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { PasswordTokensService } from './password-tokens.service';

describe('AuthService', () => {
  let service: AuthService;
  let passwordHash: string;

  const prisma = {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    passwordToken: { update: jest.fn() },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
  const jwtService = { signAsync: jest.fn() };
  const passwordTokens = { consume: jest.fn() };

  const user = (overrides: Partial<User> = {}): User => ({
    id: 'u1',
    email: 'sarhan@example.com',
    passwordHash,
    name: 'Sarhan',
    role: Role.USER,
    status: UserStatus.ACTIVE,
    onboardedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  beforeAll(async () => {
    passwordHash = await hash('right-password', 4);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService as unknown as JwtService,
      passwordTokens as unknown as PasswordTokensService,
    );
  });

  describe('login', () => {
    it('returns a token and the user for correct credentials', async () => {
      const existing = user();
      prisma.user.findUnique.mockResolvedValue(existing);
      prisma.user.update.mockResolvedValue({ ...existing, lastLoginAt: new Date() });
      jwtService.signAsync.mockResolvedValue('signed-token');

      const result = await service.login('sarhan@example.com', 'right-password');

      expect(result.accessToken).toBe('signed-token');
      expect(result.user.email).toBe('sarhan@example.com');
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'u1',
        email: 'sarhan@example.com',
        role: Role.USER,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lastLoginAt: expect.any(Date) },
      });
    });

    it('looks the email up lowercased', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user());
      jwtService.signAsync.mockResolvedValue('t');

      await service.login('SARHAN@EXAMPLE.COM', 'right-password');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'sarhan@example.com' },
      });
    });

    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login('nobody@example.com', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an account whose password was never set', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ passwordHash: null }));

      await expect(service.login('sarhan@example.com', 'anything')).rejects.toThrow(
        'Set your password first — use your link',
      );
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(user());

      await expect(service.login('sarhan@example.com', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a deactivated account even with the right password', async () => {
      prisma.user.findUnique.mockResolvedValue(user({ status: UserStatus.DEACTIVATED }));

      await expect(service.login('sarhan@example.com', 'right-password')).rejects.toThrow(
        'Account is deactivated',
      );
    });
  });

  describe('setPassword', () => {
    it('sets the password and marks the link used, atomically', async () => {
      passwordTokens.consume.mockResolvedValue({
        id: 'tok1',
        userId: 'u1',
        purpose: PasswordTokenPurpose.INVITE,
      });
      prisma.user.update.mockResolvedValue(user());
      prisma.passwordToken.update.mockResolvedValue({});

      await service.setPassword('raw-token', 'brand-new-password');

      const userUpdate = prisma.user.update.mock.calls[0][0];
      expect(userUpdate.where).toEqual({ id: 'u1' });
      expect(await compare('brand-new-password', userUpdate.data.passwordHash)).toBe(true);
      expect(prisma.passwordToken.update).toHaveBeenCalledWith({
        where: { id: 'tok1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('rejects an invalid or expired link', async () => {
      passwordTokens.consume.mockRejectedValue(
        new BadRequestException('Link is invalid or expired'),
      );

      await expect(service.setPassword('bad-token', 'whatever-password')).rejects.toThrow(
        'Link is invalid or expired',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('updates the hash with the right current password', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user());

      await service.changePassword('u1', 'right-password', 'new-password-123');

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'u1' });
      expect(updateArgs.data.passwordHash).not.toBe(passwordHash);
    });

    it('rejects a wrong current password', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user());

      await expect(
        service.changePassword('u1', 'wrong-password', 'new-password-123'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects when no password was ever set', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user({ passwordHash: null }));

      await expect(
        service.changePassword('u1', 'anything', 'new-password-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
