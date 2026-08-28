import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PasswordTokenPurpose, Role, User, UserStatus } from '@prisma/client';
import { PasswordTokensService } from '../auth/password-tokens.service';
import { SafeUser, toSafeUser } from '../common/types/safe-user';
import { PrismaService } from '../prisma/prisma.service';
import { seedUserDefaults } from './user-defaults';

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
    email: string,
    name: string,
  ): Promise<{ user: SafeUser; setPasswordLink: string }> {
    const normalizedEmail = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ConflictException('Email already used');
    }

    const { user, setPasswordLink } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: normalizedEmail, name, role: Role.USER },
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
    return { user: toSafeUser(user), setPasswordLink };
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

  async deleteUser(actor: SafeUser, userId: string, confirmEmail: string): Promise<void> {
    if (userId === actor.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const user = await this.findOrFail(userId);
    if (confirmEmail.toLowerCase() !== user.email) {
      throw new BadRequestException('Type the exact email to confirm');
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
        actorEmail: actor.email,
        action,
        targetId: target.id,
        targetEmail: target.email,
      },
    });
  }
}
