import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { OnboardingDto } from './dto/onboarding.dto';
import { SettingsDto } from './dto/settings.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOkResponse({ type: SettingsDto })
  async get(@CurrentUser() user: SafeUser): Promise<SettingsDto> {
    return SettingsDto.from(await this.settingsService.get(user.id));
  }

  @Patch()
  @ApiOkResponse({ type: SettingsDto })
  async update(
    @CurrentUser() user: SafeUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsDto> {
    return SettingsDto.from(await this.settingsService.update(user.id, dto));
  }

  @Post('onboarding')
  @HttpCode(200)
  @ApiOkResponse({ type: SettingsDto })
  async completeOnboarding(
    @CurrentUser() user: SafeUser,
    @Body() dto: OnboardingDto,
  ): Promise<SettingsDto> {
    return SettingsDto.from(await this.settingsService.completeOnboarding(user.id, dto));
  }
}
