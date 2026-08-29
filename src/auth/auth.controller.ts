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
import { ChangePinDto, VerifyPinDto } from './dto/pin.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import {
  ChangeEmailDto,
  RequestResetDto,
  SignupDto,
  SignupResponseDto,
} from './dto/signup.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResponseDto })
  login(@Body() dto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(dto.identifier, dto.password);
  }

  @Public()
  @Post('signup')
  @ApiOkResponse({ type: SignupResponseDto })
  signup(@Body() dto: SignupDto): Promise<SignupResponseDto> {
    return this.authService.signup(dto);
  }

  @Public()
  @Post('request-reset')
  @HttpCode(200)
  async requestReset(@Body() dto: RequestResetDto): Promise<{ ok: true }> {
    await this.authService.requestReset(dto.identifier);
    return { ok: true };
  }

  @Post('change-email')
  @HttpCode(200)
  @ApiBearerAuth()
  async changeEmail(
    @CurrentUser() user: SafeUser,
    @Body() dto: ChangeEmailDto,
  ): Promise<{ ok: true }> {
    await this.authService.changeEmail(user.id, dto.password, dto.newEmail);
    return { ok: true };
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

  @Post('verify-pin')
  @HttpCode(200)
  @ApiBearerAuth()
  async verifyPin(
    @CurrentUser() user: SafeUser,
    @Body() dto: VerifyPinDto,
  ): Promise<{ ok: true }> {
    await this.authService.verifyPin(user.id, dto.pin);
    return { ok: true };
  }

  @Post('change-pin')
  @HttpCode(200)
  @ApiBearerAuth()
  async changePin(
    @CurrentUser() user: SafeUser,
    @Body() dto: ChangePinDto,
  ): Promise<{ ok: true }> {
    await this.authService.changePin(user.id, dto.password, dto.newPin);
    return { ok: true };
  }
}
