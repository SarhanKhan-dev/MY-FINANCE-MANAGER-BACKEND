import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;

  const reflector = { getAllAndOverride: jest.fn() };

  const context = (request: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows routes with no role requirement', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(context({}))).toBe(true);
  });

  it('allows a user whose role matches', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.SUPERADMIN]);

    expect(guard.canActivate(context({ user: { role: Role.SUPERADMIN } }))).toBe(true);
  });

  it('blocks a user whose role does not match', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.SUPERADMIN]);

    expect(() => guard.canActivate(context({ user: { role: Role.USER } }))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks when there is no authenticated user at all', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.SUPERADMIN]);

    expect(() => guard.canActivate(context({}))).toThrow(ForbiddenException);
  });
});
