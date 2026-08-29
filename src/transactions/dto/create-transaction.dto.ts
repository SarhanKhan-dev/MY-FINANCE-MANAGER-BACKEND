import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, TransactionType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
      (o.type === TransactionType.EXPENSE && o.currency === Currency.USD) ||
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
  @ValidateIf((o: CreateTransactionDto) => o.type !== TransactionType.INCOME)
  @IsString()
  fromWalletId?: string;

  @ApiPropertyOptional({ description: 'Wallet the money entered' })
  @ValidateIf((o: CreateTransactionDto) => o.type !== TransactionType.EXPENSE)
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

  @ApiPropertyOptional({ description: 'Save even if it looks like a duplicate' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
