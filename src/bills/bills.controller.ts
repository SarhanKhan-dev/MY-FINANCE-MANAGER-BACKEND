import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Bill, Currency, RepeatRule } from '@prisma/client';
import {
  IsEnum,
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
import { BillsService, BillStatus } from './bills.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class CreateBillDto {
  @ApiProperty({ example: 'Internet', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({ description: 'Leave empty for a variable bill' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiProperty({ enum: RepeatRule })
  @IsEnum(RepeatRule)
  repeat: RepeatRule;

  @ApiProperty({ example: '2026-09-05' })
  @Matches(DATE_RE)
  firstDueOn: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 30, default: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultWalletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;
}

class UpdateBillDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: '2026-09-05' })
  @IsOptional()
  @Matches(DATE_RE)
  nextDueOn?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultWalletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;
}

class PayBillDto {
  @ApiProperty()
  @IsString()
  walletId: string;

  @ApiPropertyOptional({ description: 'Required for variable bills' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
}

export class BillDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) amount: string | null;
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiProperty({ enum: RepeatRule }) repeat: RepeatRule;
  @ApiProperty({ example: '2026-09-05' }) nextDueOn: string;
  @ApiProperty() reminderDays: number;
  @ApiProperty({ type: String, nullable: true }) lastPaidOn: string | null;
  @ApiProperty({ type: String, nullable: true }) defaultWalletId: string | null;
  @ApiProperty({ type: String, nullable: true }) categoryId: string | null;
  @ApiProperty({ enum: ['OVERDUE', 'DUE_SOON', 'UPCOMING', 'PAID'] }) status: BillStatus;
  @ApiProperty() archived: boolean;

  static from(bill: Bill, status: BillStatus): BillDto {
    const dto = new BillDto();
    dto.id = bill.id;
    dto.name = bill.name;
    dto.amount = bill.amount ? bill.amount.toFixed(2) : null;
    dto.currency = bill.currency;
    dto.repeat = bill.repeat;
    dto.nextDueOn = bill.nextDueOn.toISOString().slice(0, 10);
    dto.reminderDays = bill.reminderDays;
    dto.lastPaidOn = bill.lastPaidOn ? bill.lastPaidOn.toISOString().slice(0, 10) : null;
    dto.defaultWalletId = bill.defaultWalletId;
    dto.categoryId = bill.categoryId;
    dto.status = status;
    dto.archived = bill.archivedAt !== null;
    return dto;
  }
}

class PayBillResponseDto {
  @ApiProperty({ type: BillDto }) bill: BillDto;
  @ApiProperty({ type: TransactionDto }) transaction: TransactionDto;
}

@ApiTags('bills')
@ApiBearerAuth()
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Get()
  @ApiOkResponse({ type: BillDto, isArray: true })
  async list(@CurrentUser() user: SafeUser): Promise<BillDto[]> {
    const rows = await this.billsService.list(user.id);
    return rows.map(({ bill, status }) => BillDto.from(bill, status));
  }

  @Post()
  @ApiOkResponse({ type: BillDto })
  async create(@CurrentUser() user: SafeUser, @Body() dto: CreateBillDto): Promise<BillDto> {
    const bill = await this.billsService.create(user.id, dto);
    return BillDto.from(bill, 'UPCOMING');
  }

  @Patch(':id')
  @ApiOkResponse({ type: BillDto })
  async update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateBillDto,
  ): Promise<BillDto> {
    const bill = await this.billsService.update(user.id, id, dto);
    return BillDto.from(bill, 'UPCOMING');
  }

  @Post(':id/pay')
  @HttpCode(200)
  @ApiOkResponse({ type: PayBillResponseDto })
  async pay(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: PayBillDto,
  ): Promise<PayBillResponseDto> {
    const { bill, transaction } = await this.billsService.pay(user.id, id, dto);
    return {
      bill: BillDto.from(bill, 'UPCOMING'),
      transaction: TransactionDto.from(transaction),
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.billsService.archive(user.id, id);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.billsService.remove(user.id, id);
    return { ok: true };
  }
}
