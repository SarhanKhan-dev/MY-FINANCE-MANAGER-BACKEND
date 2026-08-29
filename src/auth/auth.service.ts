import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { randomInt } from 'crypto';
import { toSafeUser } from '../common/types/safe-user';
import { PrismaService } from '../prisma/prisma.service';
import { UserDto } from '../users/dto/user.dto';
import { seedUserDefaults } from '../users/user-defaults';
import { LoginResponseDto } from './dto/login-response.dto';
import { SignupResponseDto } from './dto/signup.dto';
import { PasswordTokensService } from './password-tokens.service';

const BCRYPT_ROUNDS = 10;
const MAX_PIN_ATTEMPTS = 5;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly passwordTokens: PasswordTokensService,
  ) {}

  async login(identifier: string, password: string): Promise<LoginResponseDto> {
    const normalized = identifier.toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username: normalized }, { email: normalized }] },
    });
    if (!user) {
      throw new UnauthorizedException('Wrong username or password');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('Set your password first — use your link');
    }
    if (!(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Wrong username or password');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), pinAttempts: 0 },
    });

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    return { accessToken, user: UserDto.from(toSafeUser(updated)) };
  }

  /** Public self-signup — only when SIGNUPS_ENABLED=true; PAIS-e stays invite-only otherwise. */
  async signup(input: {
    name: string;
    username: string;
    email: string;
    password: string;
  }): Promise<SignupResponseDto> {
    if (process.env.SIGNUPS_ENABLED !== 'true') {
      throw new ForbiddenException('Signups are closed right now');
    }
    const username = input.username.toLowerCase().trim();
    const email = input.email.toLowerCase().trim();
    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (clash) {
      throw new ConflictException(
        clash.username === username ? 'Username is taken' : 'Email is already registered',
      );
    }

    const pin = randomInt(0, 10000).toString().padStart(4, '0');
    const [passwordHash, pinHash] = await Promise.all([
      hash(input.password, BCRYPT_ROUNDS),
      hash(pin, BCRYPT_ROUNDS),
    ]);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          name: input.name.trim(),
          email,
          passwordHash,
          pinHash,
          role: Role.USER,
        },
      });
      await seedUserDefaults(tx, created.id);
      return created;
    });

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return { accessToken, user: UserDto.from(toSafeUser(user)), pin };
  }

  async setPassword(rawToken: string, newPassword: string): Promise<void> {
    const token = await this.passwordTokens.consume(rawToken);
    const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is wrong');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(newPassword, BCRYPT_ROUNDS) },
    });
  }

  async verifyPin(userId: string, pin: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.pinHash) {
      throw new BadRequestException('No PIN set');
    }
    if (user.pinAttempts >= MAX_PIN_ATTEMPTS) {
      throw new ForbiddenException('PIN locked — sign in with your password');
    }

    if (!(await compare(pin, user.pinHash))) {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { pinAttempts: { increment: 1 } },
      });
      if (updated.pinAttempts >= MAX_PIN_ATTEMPTS) {
        throw new ForbiddenException('PIN locked — sign in with your password');
      }
      throw new UnauthorizedException('Wrong PIN');
    }

    await this.prisma.user.update({ where: { id: userId }, data: { pinAttempts: 0 } });
  }

  async changePin(userId: string, password: string, newPin: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await compare(password, user.passwordHash))) {
      throw new BadRequestException('Password is wrong');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { pinHash: await hash(newPin, BCRYPT_ROUNDS), pinAttempts: 0 },
    });
  }
}
