import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { toSafeUser } from '../common/types/safe-user';
import { PrismaService } from '../prisma/prisma.service';
import { UserDto } from '../users/dto/user.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { PasswordTokensService } from './password-tokens.service';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly passwordTokens: PasswordTokensService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user) {
      throw new UnauthorizedException('Wrong email or password');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('Set your password first — use your link');
    }
    if (!(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Wrong email or password');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken, user: UserDto.from(toSafeUser(updated)) };
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
}
