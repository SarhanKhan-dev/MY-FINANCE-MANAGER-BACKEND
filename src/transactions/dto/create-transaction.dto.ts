import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, TransactionType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class TransactionItemInputDto {
  @ApiPropertyOptional({ description: 'Catalog product; leave empty for an Other line' })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional({ description: 'Label for a non-catalog line', maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @ApiProperty({ example: 2 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  @ApiProperty({ example: 320 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  unitPrice: number;

  @ApiProperty({ example: 640 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  lineTotal: number;
}

export class CreateTransactionDto {
  @ApiProperty({ enum: TransactionType })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ example: '2026-08-29', description: 'Calendar date (Asia/Karachi)' })
  @Matches(DATE_RE, { message: 'Date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ example: 2500 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({ example: 278.5, description: 'USD→PKR rate used' })
  @ValidateIf(
    (o: CreateTransactionDto) =>
      o.type === TransactionType.CONVERSION ||
      (o.currency === Currency.USD && o.type !== TransactionType.TRANSFER) ||
      o.fxRate !== undefined,
  )
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  fxRate?: number;

  @ApiPropertyOptional({ description: 'Conversion result in the target currency' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  toAmount?: number;

  @ApiPropertyOptional({ description: 'Wallet the money left' })
  @ValidateIf((o: CreateTransactionDto) =>
    (
      [
        TransactionType.EXPENSE,
        TransactionType.TRANSFER,
        TransactionType.CONVERSION,
        TransactionType.REPAY_OUT,
        TransactionType.TAKEN,
      ] as TransactionType[]
    ).includes(o.type),
  )
  @IsString()
  fromWalletId?: string;

  @ApiPropertyOptional({ description: 'Wallet the money entered' })
  @ValidateIf((o: CreateTransactionDto) =>
    (
      [
        TransactionType.INCOME,
        TransactionType.TRANSFER,
        TransactionType.CONVERSION,
        TransactionType.REPAY_IN,
        TransactionType.OPENING,
      ] as TransactionType[]
    ).includes(o.type),
  )
  @IsString()
  toWalletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  merchantId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Who this spending was for — tags only, no debt is created',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  forPersonIds?: string[];

  @ApiPropertyOptional({ description: 'Free-text source when the money came from no saved person' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  incomeSource?: string;

  @ApiPropertyOptional({ example: 'Salary' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  incomeType?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ description: 'Charity only: this payment is zakat' })
  @IsOptional()
  @IsBoolean()
  isZakat?: boolean;

  @ApiPropertyOptional({ description: 'Save even if it looks like a duplicate' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    type: TransactionItemInputDto,
    isArray: true,
    description: 'Receipt lines — spending only; totals must add up to the amount',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TransactionItemInputDto)
  @ArrayMaxSize(100)
  items?: TransactionItemInputDto[];
}
