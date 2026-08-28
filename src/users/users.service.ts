import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PasswordTokenPurpose, Role, User, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomInt } from 'crypto';
import { PasswordTokensService } from '../auth/password-tokens.service';
import { SafeUser, toSafeUser } from '../common/types/safe-user';
import { PrismaService } from '../prisma/prisma.service';
import { seedUserDefaults } from './user-defaults';

const BCRYPT_ROUNDS = 10;

export const AdminActions = {
  USER_CREATED: 'USER_CREATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  USER_DELETED: 'USER_DELETED',
} as const;

type AdminAction = (typeof AdminActions)[keyof typeof AdminActions];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordTokens: PasswordTokensService,
  ) {}

  async listUsers(): Promise<SafeUser[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return users.map(toSafeUser);
  }

  async createUser(
    actor: SafeUser,
    username: string,
    name: string,
    email: string,
  ): Promise<{ user: SafeUser; setPasswordLink: string; initialPin: string }> {
    const normalizedUsername = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: normalizedUsername }, { email: normalizedEmail }] },
    });
    if (existing) {
      throw new ConflictException(
        existing.username === normalizedUsername ? 'Username already used' : 'Email already used',
      );
    }

    const initialPin = randomInt(0, 10000).toString().padStart(4, '0');
    const pinHash = await hash(initialPin, BCRYPT_ROUNDS);

    const { user, setPasswordLink } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: normalizedUsername,
          name,
          email: normalizedEmail,
          pinHash,
          role: Role.USER,
        },
      });
      await seedUserDefaults(tx, created.id);
      const link = await this.passwordTokens.issue(
        created.id,
        PasswordTokenPurpose.INVITE,
        tx,
      );
      return { user: created, setPasswordLink: link };
    });

    await this.audit(actor, AdminActions.USER_CREATED, user);
    return { user: toSafeUser(user), setPasswordLink, initialPin };
  }

  async setStatus(actor: SafeUser, userId: string, status: UserStatus): Promise<SafeUser> {
    if (userId === actor.id) {
      throw new BadRequestException('You cannot change your own account status');
    }
    const user = await this.findOrFail(userId);
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { status } });
    await this.audit(
      actor,
      status === UserStatus.DEACTIVATED
        ? AdminActions.USER_DEACTIVATED
        : AdminActions.USER_REACTIVATED,
      user,
    );
    return toSafeUser(updated);
  }

  async resetPassword(actor: SafeUser, userId: string): Promise<{ setPasswordLink: string }> {
    const user = await this.findOrFail(userId);
    const setPasswordLink = await this.passwordTokens.issue(
      user.id,
      PasswordTokenPurpose.RESET,
    );
    await this.audit(actor, AdminActions.PASSWORD_RESET, user);
    return { setPasswordLink };
  }

  async deleteUser(actor: SafeUser, userId: string, confirmUsername: string): Promise<void> {
    if (userId === actor.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const user = await this.findOrFail(userId);
    if (confirmUsername.toLowerCase() !== user.username) {
      throw new BadRequestException('Type the exact username to confirm');
    }
    await this.prisma.user.delete({ where: { id: user.id } });
    await this.audit(actor, AdminActions.USER_DELETED, user);
  }

  async listAuditLog() {
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private async findOrFail(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private async audit(actor: SafeUser, action: AdminAction, target: User): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        actorUsername: actor.username,
        action,
        targetId: target.id,
        targetUsername: target.username,
      },
    });
  }
}
