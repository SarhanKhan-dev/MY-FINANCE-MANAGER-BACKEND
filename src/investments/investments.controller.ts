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
import { Currency, InvestmentKind, TransactionType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { HoldingView, InvestmentsService, PortfolioSummary } from './investments.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class CreateInvestmentDto {
  @ApiProperty({ example: 'HBL shares', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ enum: InvestmentKind })
  @IsEnum(InvestmentKind)
  kind: InvestmentKind;

  @ApiPropertyOptional({ enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({ description: 'Counts toward zakat' })
  @IsOptional()
  @IsBoolean()
  zakatable?: boolean;
}

class TradeDto {
  @ApiPropertyOptional({
    description: 'Wallet the money moves through; omit on a buy to record an already-owned holding',
  })
  @IsOptional()
  @IsString()
  walletId?: string;

  @ApiPropertyOptional({ description: 'For accounts and other holdings' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ description: 'For stocks: number of shares' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  units?: number;

  @ApiPropertyOptional({ description: 'For stocks: price per share' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  unitPrice?: number;

  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;

  @ApiPropertyOptional({ description: 'USD→PKR rate for USD holdings' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  fxRate?: number;
}

class ValueUpdateDto {
  @ApiPropertyOptional({ description: 'For accounts: total value now' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value?: number;

  @ApiPropertyOptional({ description: 'For stocks: price per share now' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  unitPrice?: number;

  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
}

class HoldingDto implements HoldingView {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: InvestmentKind }) kind: InvestmentKind;
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiProperty({ type: Number, nullable: true }) units: number | null;
  @ApiProperty({ type: Number, nullable: true }) currentUnitPrice: number | null;
  @ApiProperty() costBasis: number;
  @ApiProperty() currentValue: number;
  @ApiProperty() unrealizedPnl: number;
  @ApiProperty({ type: Number, nullable: true }) unrealizedPct: number | null;
  @ApiProperty() realizedPnl: number;
  @ApiProperty({ type: Number, nullable: true }) todayChange: number | null;
  @ApiProperty() zakatable: boolean;
  @ApiProperty() archived: boolean;
}

class PortfolioDto implements PortfolioSummary {
  @ApiProperty() investedPkr: number;
  @ApiProperty() valuePkr: number;
  @ApiProperty() unrealizedPkr: number;
  @ApiProperty() realizedPkr: number;
  @ApiProperty({ type: Number, nullable: true }) todayChangePkr: number | null;
  @ApiProperty({ type: Number, nullable: true }) usdRate: number | null;
}

class InvestmentsListDto {
  @ApiProperty({ type: HoldingDto, isArray: true }) holdings: HoldingDto[];
  @ApiProperty({ type: PortfolioDto }) summary: PortfolioDto;
}

class SnapshotDto {
  @ApiProperty() date: string;
  @ApiProperty() value: number;
}

class InvestmentEntryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: TransactionType }) type: TransactionType;
  @ApiProperty() date: string;
  @ApiProperty({ type: String }) amount: string;
  @ApiProperty({ enum: Currency }) currency: Currency;
}

class InvestmentDetailDto {
  @ApiProperty({ type: HoldingDto }) holding: HoldingDto;
  @ApiProperty({ type: SnapshotDto, isArray: true }) snapshots: SnapshotDto[];
  @ApiProperty({ type: InvestmentEntryDto, isArray: true }) entries: InvestmentEntryDto[];
}

class SellResponseDto {
  @ApiProperty({ type: HoldingDto }) holding: HoldingDto;
  @ApiProperty({ description: 'Profit or loss locked in by this sale' }) realized: number;
}

@ApiTags('investments')
@ApiBearerAuth()
@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get()
  @ApiOkResponse({ type: InvestmentsListDto })
  list(@CurrentUser() user: SafeUser): Promise<InvestmentsListDto> {
    return this.investmentsService.list(user.id);
  }

  @Get(':id')
  @ApiOkResponse({ type: InvestmentDetailDto })
  detail(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<InvestmentDetailDto> {
    return this.investmentsService.detail(user.id, id);
  }

  @Post()
  @HttpCode(200)
  async create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateInvestmentDto,
  ): Promise<{ id: string }> {
    const investment = await this.investmentsService.create(user.id, dto);
    return { id: investment.id };
  }

  @Post(':id/buy')
  @HttpCode(200)
  async buy(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: TradeDto,
  ): Promise<{ ok: true }> {
    await this.investmentsService.buy(user.id, id, dto);
    return { ok: true };
  }

  @Post(':id/sell')
  @HttpCode(200)
  @ApiOkResponse({ type: SellResponseDto })
  async sell(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: TradeDto,
  ): Promise<{ realized: number }> {
    const { realized } = await this.investmentsService.sell(user.id, id, dto);
    return { realized };
  }

  @Post(':id/value')
  @HttpCode(200)
  async updateValue(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: ValueUpdateDto,
  ): Promise<{ ok: true }> {
    await this.investmentsService.updateValue(user.id, id, dto);
    return { ok: true };
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.investmentsService.archive(user.id, id);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.investmentsService.remove(user.id, id);
    return { ok: true };
  }
}
