import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  const jwtService = { verifyAsync: jest.fn() };
  const prisma = { user: { findUnique: jest.fn() } };
  const reflector = { getAllAndOverride: jest.fn() };

  const context = (request: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  const user = (overrides: Partial<User> = {}): User => ({
    id: 'u1',
    username: 'shams123@',
    email: 'shams@example.com',
    passwordHash: 'hashed',
    pinHash: 'hashed-pin',
    pinAttempts: 0,
    name: 'Shams',
    role: Role.USER,
    status: UserStatus.ACTIVE,
    onboardedAt: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(
      jwtService as unknown as JwtService,
      prisma as unknown as PrismaService,
      reflector as unknown as Reflector,
    );
  });

  it('lets public routes through without a token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(context({ headers: {} }))).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow(
      new UnauthorizedException('Sign in first'),
    );
  });

  it('rejects a malformed Authorization scheme', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);

    await expect(
      guard.canActivate(context({ headers: { authorization: 'Basic abc' } })),
    ).rejects.toThrow('Sign in first');
  });

  it('rejects an invalid or expired token', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockRejectedValue(new Error('expired'));

    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer bad-token' } })),
    ).rejects.toThrow('Session expired — sign in again');
  });

  it('rejects a token whose user no longer exists', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({ sub: 'ghost' });
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer token' } })),
    ).rejects.toThrow('Account is not active');
  });

  it('rejects a deactivated user', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue(user({ status: UserStatus.DEACTIVATED }));

    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer token' } })),
    ).rejects.toThrow('Account is not active');
  });

  it('attaches the user without the password hash and allows the request', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({ sub: 'u1' });
    prisma.user.findUnique.mockResolvedValue(user());
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer token' },
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);

    expect(request.user).toMatchObject({ id: 'u1', username: 'shams123@' });
    expect(request.user).not.toHaveProperty('passwordHash');
  });
});
