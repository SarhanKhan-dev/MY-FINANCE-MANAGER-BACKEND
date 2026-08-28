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
  let pinHash: string;

  const prisma = {
    user: {
      findFirst: jest.fn(),
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
    username: 'shams123@',
    email: 'shams@example.com',
    passwordHash,
    pinHash,
    pinAttempts: 0,
    name: 'Shams',
    role: Role.SUPERADMIN,
    status: UserStatus.ACTIVE,
    onboardedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  beforeAll(async () => {
    passwordHash = await hash('right-password', 4);
    pinHash = await hash('1234', 4);
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
    it('returns a token and the user for correct credentials, resetting PIN attempts', async () => {
      const existing = user();
      prisma.user.findFirst.mockResolvedValue(existing);
      prisma.user.update.mockResolvedValue({ ...existing, lastLoginAt: new Date() });
      jwtService.signAsync.mockResolvedValue('signed-token');

      const result = await service.login('shams123@', 'right-password');

      expect(result.accessToken).toBe('signed-token');
      expect(result.user.username).toBe('shams123@');
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'u1',
        username: 'shams123@',
        role: Role.SUPERADMIN,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lastLoginAt: expect.any(Date), pinAttempts: 0 },
      });
    });

    it('accepts username or email as the identifier, case-insensitively', async () => {
      prisma.user.findFirst.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user());
      jwtService.signAsync.mockResolvedValue('t');

      await service.login('SHAMS@Example.com', 'right-password');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ username: 'shams@example.com' }, { email: 'shams@example.com' }],
        },
      });
    });

    it('rejects an unknown identifier', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login('nobody', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an account whose password was never set', async () => {
      prisma.user.findFirst.mockResolvedValue(user({ passwordHash: null }));

      await expect(service.login('shams123@', 'anything')).rejects.toThrow(
        'Set your password first — use your link',
      );
    });

    it('rejects a wrong password', async () => {
      prisma.user.findFirst.mockResolvedValue(user());

      await expect(service.login('shams123@', 'wrong-password')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a deactivated account even with the right password', async () => {
      prisma.user.findFirst.mockResolvedValue(user({ status: UserStatus.DEACTIVATED }));

      await expect(service.login('shams123@', 'right-password')).rejects.toThrow(
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

  describe('verifyPin', () => {
    it('accepts the right PIN and resets the attempt counter', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user({ pinAttempts: 2 }));
      prisma.user.update.mockResolvedValue(user());

      await service.verifyPin('u1', '1234');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { pinAttempts: 0 },
      });
    });

    it('counts a wrong PIN and rejects it', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user({ pinAttempts: 1 }));

      await expect(service.verifyPin('u1', '9999')).rejects.toThrow('Wrong PIN');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { pinAttempts: { increment: 1 } },
      });
    });

    it('locks the PIN on the fifth wrong attempt', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user({ pinAttempts: 4 }));
      prisma.user.update.mockResolvedValue(user({ pinAttempts: 5 }));

      await expect(service.verifyPin('u1', '9999')).rejects.toThrow(
        'PIN locked — sign in with your password',
      );
    });

    it('rejects immediately while locked, without checking the PIN', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user({ pinAttempts: 5 }));

      await expect(service.verifyPin('u1', '1234')).rejects.toThrow(
        'PIN locked — sign in with your password',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('fails plainly when no PIN is set', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user({ pinHash: null }));

      await expect(service.verifyPin('u1', '1234')).rejects.toThrow('No PIN set');
    });
  });

  describe('changePin', () => {
    it('sets a new PIN with the right password and resets attempts', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user({ pinAttempts: 5 }));
      prisma.user.update.mockResolvedValue(user());

      await service.changePin('u1', 'right-password', '5678');

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'u1' });
      expect(updateArgs.data.pinAttempts).toBe(0);
      expect(await compare('5678', updateArgs.data.pinHash)).toBe(true);
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user());

      await expect(service.changePin('u1', 'wrong-password', '5678')).rejects.toThrow(
        'Password is wrong',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
