import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';
import { AiProviderName, providerKeySet } from './providers';

const PROVIDERS: AiProviderName[] = ['glm', 'openai', 'gemini', 'grok', 'anthropic'];

class AiSettingsDto {
  @ApiProperty({ enum: PROVIDERS }) provider: string;
  @ApiProperty() model: string;
  @ApiProperty() dailyLimit: number;
  @ApiProperty() webSearch: boolean;
  @ApiProperty({ description: 'Whether the active provider has an API key set' })
  keyReady: boolean;
  @ApiProperty({ type: Object, description: 'Key presence per provider' })
  keys: Record<string, boolean>;
}

class UpdateAiSettingsDto {
  @ApiPropertyOptional({ enum: PROVIDERS })
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 80)
  model?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  dailyLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;
}

class ToggleAiDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.SUPERADMIN)
@Controller('admin/ai')
export class AiAdminController {
  constructor(
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
  ) {}

  private async settingsDto(): Promise<AiSettingsDto> {
    const settings = await this.aiService.settings();
    const keys = Object.fromEntries(
      PROVIDERS.map((provider) => [provider, providerKeySet(provider)]),
    );
    return {
      provider: settings.provider,
      model: settings.model,
      dailyLimit: settings.dailyLimit,
      webSearch: settings.webSearch,
      keyReady: providerKeySet(settings.provider as AiProviderName),
      keys,
    };
  }

  @Get('settings')
  @ApiOkResponse({ type: AiSettingsDto })
  settings(): Promise<AiSettingsDto> {
    return this.settingsDto();
  }

  @Patch('settings')
  @ApiOkResponse({ type: AiSettingsDto })
  async update(@Body() dto: UpdateAiSettingsDto): Promise<AiSettingsDto> {
    await this.aiService.settings();
    await this.prisma.aiSettings.update({
      where: { id: 'global' },
      data: {
        ...(dto.provider ? { provider: dto.provider } : {}),
        ...(dto.model ? { model: dto.model } : {}),
        ...(dto.dailyLimit != null ? { dailyLimit: dto.dailyLimit } : {}),
        ...(dto.webSearch != null ? { webSearch: dto.webSearch } : {}),
      },
    });
    return this.settingsDto();
  }

  @Post('users/:id')
  @HttpCode(200)
  async toggleUser(
    @Param('id') id: string,
    @Body() dto: ToggleAiDto,
  ): Promise<{ ok: true; aiEnabled: boolean }> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { aiEnabled: dto.enabled },
      select: { aiEnabled: true },
    });
    return { ok: true, aiEnabled: user.aiEnabled };
  }
}
