import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordTokenPurpose } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordTokensService } from './password-tokens.service';

describe('PasswordTokensService', () => {
  let service: PasswordTokensService;

  const prisma = {
    passwordToken: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const config = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue('https://app.example.com');
    service = new PasswordTokensService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    );
  });

  describe('issue', () => {
    it('replaces outstanding links of the same purpose and stores only a hash', async () => {
      const link = await service.issue('u1', PasswordTokenPurpose.INVITE);

      expect(prisma.passwordToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', purpose: PasswordTokenPurpose.INVITE, usedAt: null },
      });

      const created = prisma.passwordToken.create.mock.calls[0][0].data;
      const rawToken = new URL(link).searchParams.get('token') as string;
      expect(link.startsWith('https://app.example.com/set-password?token=')).toBe(true);
      expect(created.tokenHash).toBe(createHash('sha256').update(rawToken).digest('hex'));
      expect(created.tokenHash).not.toBe(rawToken);
      expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('gives reset links a shorter life than invite links', async () => {
      await service.issue('u1', PasswordTokenPurpose.INVITE);
      await service.issue('u1', PasswordTokenPurpose.RESET);

      const inviteExpiry = prisma.passwordToken.create.mock.calls[0][0].data.expiresAt;
      const resetExpiry = prisma.passwordToken.create.mock.calls[1][0].data.expiresAt;
      expect(resetExpiry.getTime()).toBeLessThan(inviteExpiry.getTime());
    });

    it('kills reset links after exactly five minutes', async () => {
      const before = Date.now();
      await service.issue('u1', PasswordTokenPurpose.RESET);
      const after = Date.now();

      const expiry = prisma.passwordToken.create.mock.calls[0][0].data.expiresAt.getTime();
      expect(expiry).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
      expect(expiry).toBeLessThanOrEqual(after + 5 * 60 * 1000);
    });
  });

  describe('consume', () => {
    const validToken = () => ({
      id: 'tok1',
      userId: 'u1',
      purpose: PasswordTokenPurpose.INVITE,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    it('returns the token record for a valid link', async () => {
      prisma.passwordToken.findUnique.mockResolvedValue(validToken());

      const result = await service.consume('raw-token');

      expect(result.id).toBe('tok1');
      expect(prisma.passwordToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: createHash('sha256').update('raw-token').digest('hex') },
      });
    });

    it('rejects an unknown link', async () => {
      prisma.passwordToken.findUnique.mockResolvedValue(null);

      await expect(service.consume('nope')).rejects.toThrow(BadRequestException);
    });

    it('rejects a link that was already used', async () => {
      prisma.passwordToken.findUnique.mockResolvedValue({
        ...validToken(),
        usedAt: new Date(),
      });

      await expect(service.consume('raw-token')).rejects.toThrow('Link is invalid or expired');
    });

    it('rejects an expired link', async () => {
      prisma.passwordToken.findUnique.mockResolvedValue({
        ...validToken(),
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.consume('raw-token')).rejects.toThrow('Link is invalid or expired');
    });
  });
});
