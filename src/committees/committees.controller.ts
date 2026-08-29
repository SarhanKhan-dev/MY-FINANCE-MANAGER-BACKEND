import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { TransactionDto } from '../transactions/dto/transaction.dto';
import { CommitteesService, CommitteeView, MonthStatus } from './committees.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class CreateCommitteeDto {
  @ApiProperty({ example: 'Office BC', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ description: 'The person who collects installments' })
  @IsString()
  organizerId: string;

  @ApiProperty({ example: 10000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  installmentPkr: number;

  @ApiProperty({ example: 10, minimum: 2, maximum: 60 })
  @IsInt()
  @Min(2)
  @Max(60)
  totalMembers: number;

  @ApiPropertyOptional({ description: 'Defaults to installment × members' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  potPkr?: number;

  @ApiProperty({ example: '2026-09-01', description: 'First installment month' })
  @Matches(DATE_RE)
  startMonth: string;

  @ApiProperty({ example: 4, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(60)
  myTurn: number;
}

class PayCommitteeDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Defaults to the first unpaid month' })
  @IsOptional()
  @Matches(DATE_RE)
  monthKey?: string;

  @ApiPropertyOptional({ description: 'Wallet for a cash payment' })
  @IsOptional()
  @IsString()
  walletId?: string;

  @ApiPropertyOptional({ description: "Settle against what the organizer owes you instead" })
  @IsOptional()
  @IsBoolean()
  viaLedger?: boolean;

  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
}

class PayoutDto {
  @ApiProperty()
  @IsString()
  walletId: string;

  @ApiPropertyOptional({ description: 'Defaults to the pot amount' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
}

class CommitteeMonthDto {
  @ApiProperty({ example: '2026-09-01' }) monthKey: string;
  @ApiProperty() turn: number;
  @ApiProperty() isMine: boolean;
  @ApiProperty({ enum: ['PAID', 'OVERDUE', 'CURRENT', 'UPCOMING'] }) status: MonthStatus;
}

class CommitteeDto implements CommitteeView {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() organizerId: string;
  @ApiProperty() organizerName: string;
  @ApiProperty() installmentPkr: number;
  @ApiProperty() totalMembers: number;
  @ApiProperty() potPkr: number;
  @ApiProperty() myTurn: number;
  @ApiProperty({ type: CommitteeMonthDto, isArray: true }) months: CommitteeMonthDto[];
  @ApiProperty() paidCount: number;
  @ApiProperty() paidTotalPkr: number;
  @ApiProperty() overdueCount: number;
  @ApiProperty() payoutReceived: boolean;
  @ApiProperty({ type: String, nullable: true }) nextUnpaidMonth: string | null;
  @ApiProperty() archived: boolean;
}

@ApiTags('committees')
@ApiBearerAuth()
@Controller('committees')
export class CommitteesController {
  constructor(private readonly committeesService: CommitteesService) {}

  @Get()
  @ApiOkResponse({ type: CommitteeDto, isArray: true })
  list(@CurrentUser() user: SafeUser): Promise<CommitteeDto[]> {
    return this.committeesService.list(user.id);
  }

  @Post()
  @HttpCode(200)
  async create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateCommitteeDto,
  ): Promise<{ id: string }> {
    const committee = await this.committeesService.create(user.id, dto);
    return { id: committee.id };
  }

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOkResponse({ type: TransactionDto })
  async pay(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: PayCommitteeDto,
  ): Promise<TransactionDto> {
    return TransactionDto.from(await this.committeesService.pay(user.id, id, dto));
  }

  @Post(':id/payout')
  @HttpCode(200)
  @ApiOkResponse({ type: TransactionDto })
  async payout(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: PayoutDto,
  ): Promise<TransactionDto> {
    return TransactionDto.from(await this.committeesService.payout(user.id, id, dto));
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.committeesService.archive(user.id, id);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.committeesService.remove(user.id, id);
    return { ok: true };
  }
}
