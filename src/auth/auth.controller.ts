import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SafeUser } from '../common/types/safe-user';
import { UserDto } from '../users/dto/user.dto';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto } from './dto/login-response.dto';
import { SetPasswordDto } from './dto/set-password.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @Post('set-password')
  @HttpCode(200)
  async setPassword(@Body() dto: SetPasswordDto): Promise<{ ok: true }> {
    await this.authService.setPassword(dto.token, dto.newPassword);
    return { ok: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() user: SafeUser): UserDto {
    return UserDto.from(user);
  }

  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  async changePassword(
    @CurrentUser() user: SafeUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }
}
