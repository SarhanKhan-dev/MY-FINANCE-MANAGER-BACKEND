import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordToken, PasswordTokenPurpose, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Reset links die fast (owner's call): 5 minutes.
const RESET_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class PasswordTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async issue(
    userId: string,
    purpose: PasswordTokenPurpose,
    db?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = db ?? this.prisma;
    const rawToken = randomBytes(32).toString('base64url');
    const ttlMs = purpose === PasswordTokenPurpose.INVITE ? INVITE_TTL_MS : RESET_TTL_MS;

    await client.passwordToken.deleteMany({ where: { userId, purpose, usedAt: null } });
    await client.passwordToken.create({
      data: {
        userId,
        purpose,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    return this.buildLink(rawToken);
  }

  async consume(rawToken: string): Promise<PasswordToken> {
    const token = await this.prisma.passwordToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('Link is invalid or expired');
    }
    return token;
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private buildLink(rawToken: string): string {
    const base = (this.config.get<string>('FRONTEND_APP_URL') ?? 'http://localhost:3000')
      .replace(/\/+$/, '');
    return `${base}/set-password?token=${rawToken}`;
  }
}
