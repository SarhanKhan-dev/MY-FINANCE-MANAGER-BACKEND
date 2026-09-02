import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SafeUser } from '../common/types/safe-user';
import { AiService, EntryDraft } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { SnapshotsService } from './snapshots.service';

class ChatRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsString() chatId?: string;
  @ApiProperty({ maxLength: 2000 }) @IsString() @Length(1, 2000) message: string;
}

class EntryDraftDto implements EntryDraft {
  @ApiProperty() type: string;
  @ApiProperty() amount: number;
  @ApiProperty({ enum: ['PKR', 'USD'] }) currency: 'PKR' | 'USD';
  @ApiProperty() date: string;
  @ApiPropertyOptional() categoryName?: string;
  @ApiPropertyOptional() personName?: string;
  @ApiPropertyOptional() note?: string;
}

class ChatResponseDto {
  @ApiProperty() chatId: string;
  @ApiProperty() reply: string;
  @ApiProperty({ type: EntryDraftDto, nullable: true }) draft: EntryDraftDto | null;
  @ApiProperty() remainingToday: number;
}

class AiStatusDto {
  @ApiProperty() enabled: boolean;
  @ApiProperty() configured: boolean;
  @ApiProperty() remainingToday: number;
  @ApiProperty() dailyLimit: number;
}

class ChatSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: String, nullable: true }) title: string | null;
  @ApiProperty() updatedAt: string;
}

class ChatMessageDto {
  @ApiProperty() id: string;
  @ApiProperty() role: string;
  @ApiProperty() content: string;
  @ApiProperty() createdAt: string;
}

class SnapshotDto {
  @ApiProperty() cycleKey: string;
  @ApiProperty() cycleEnd: string;
  @ApiProperty({ type: Object }) data: Record<string, unknown>;
  @ApiProperty({ type: String, nullable: true }) report: string | null;
}

class ReportResponseDto {
  @ApiProperty() cycleKey: string;
  @ApiProperty() report: string;
}

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly snapshots: SnapshotsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('status')
  @ApiOkResponse({ type: AiStatusDto })
  status(@CurrentUser() user: SafeUser): Promise<AiStatusDto> {
    return this.aiService.status(user.id);
  }

  @Post('chat')
  @HttpCode(200)
  @ApiOkResponse({ type: ChatResponseDto })
  chat(@CurrentUser() user: SafeUser, @Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    return this.aiService.chat(user.id, dto.chatId ?? null, dto.message);
  }

  @Get('chats')
  @ApiOkResponse({ type: ChatSummaryDto, isArray: true })
  async chats(@CurrentUser() user: SafeUser): Promise<ChatSummaryDto[]> {
    const rows = await this.prisma.aiChat.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  @Get('chats/:id')
  @ApiOkResponse({ type: ChatMessageDto, isArray: true })
  async messages(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<ChatMessageDto[]> {
    await this.prisma.aiChat.findFirstOrThrow({ where: { id, userId: user.id } });
    const rows = await this.prisma.aiMessage.findMany({
      where: { chatId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  @Delete('chats/:id')
  @HttpCode(200)
  async deleteChat(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.prisma.aiChat.findFirstOrThrow({ where: { id, userId: user.id } });
    await this.prisma.aiChat.delete({ where: { id } });
    return { ok: true };
  }

  @Get('snapshots')
  @ApiOkResponse({ type: SnapshotDto, isArray: true })
  async listSnapshots(@CurrentUser() user: SafeUser): Promise<SnapshotDto[]> {
    await this.snapshots.backfill(user.id);
    const rows = await this.snapshots.list(user.id);
    return rows.map((row) => ({
      cycleKey: row.cycleKey,
      cycleEnd: row.cycleEnd,
      data: row.data as unknown as Record<string, unknown>,
      report: row.report,
    }));
  }

  @Post('report')
  @HttpCode(200)
  @ApiQuery({ name: 'cycleKey', required: false })
  @ApiOkResponse({ type: ReportResponseDto })
  report(
    @CurrentUser() user: SafeUser,
    @Query('cycleKey') cycleKey?: string,
  ): Promise<ReportResponseDto> {
    return this.aiService.generateReport(user.id, cycleKey || undefined);
  }

  @Public()
  @Get('cron/daily')
  async cron(
    @Headers('x-cron-secret') secret?: string,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: boolean }> {
    const expected = process.env.CRON_SECRET;
    const bearerOk = auth === `Bearer ${expected}`;
    if (!expected || (secret !== expected && !bearerOk)) {
      throw new ForbiddenException();
    }
    await this.aiService.cronDaily();
    return { ok: true };
  }
}
