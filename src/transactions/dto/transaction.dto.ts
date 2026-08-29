import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, TransactionType } from '@prisma/client';
import { TransactionWithRefs } from '../transaction-with-refs';

class WalletRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: Currency }) currency: Currency;
}

class NamedRefDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

export class TransactionDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: TransactionType }) type: TransactionType;
  @ApiProperty({ example: '2026-08-29' }) date: string;
  @ApiProperty({ type: String, example: '2500.00' }) amount: string;
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiPropertyOptional({ type: String, nullable: true }) fxRate: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) toAmount: string | null;
  @ApiPropertyOptional({ type: WalletRefDto, nullable: true }) fromWallet: WalletRefDto | null;
  @ApiPropertyOptional({ type: WalletRefDto, nullable: true }) toWallet: WalletRefDto | null;
  @ApiPropertyOptional({ type: NamedRefDto, nullable: true }) category: NamedRefDto | null;
  @ApiPropertyOptional({ type: NamedRefDto, nullable: true }) merchant: NamedRefDto | null;
  @ApiPropertyOptional({ type: NamedRefDto, nullable: true }) person: NamedRefDto | null;
  @ApiPropertyOptional({ type: String, nullable: true }) incomeSource: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) incomeType: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;

  static from(tx: TransactionWithRefs): TransactionDto {
    const dto = new TransactionDto();
    dto.id = tx.id;
    dto.type = tx.type;
    dto.date = tx.date.toISOString().slice(0, 10);
    dto.amount = tx.amount.toFixed(2);
    dto.currency = tx.currency;
    dto.fxRate = tx.fxRate ? tx.fxRate.toString() : null;
    dto.toAmount = tx.toAmount ? tx.toAmount.toFixed(2) : null;
    dto.fromWallet = tx.fromWallet;
    dto.toWallet = tx.toWallet;
    dto.category = tx.category;
    dto.merchant = tx.merchant;
    dto.person = tx.person;
    dto.incomeSource = tx.incomeSource;
    dto.incomeType = tx.incomeType;
    dto.note = tx.note;
    dto.createdAt = tx.createdAt;
    return dto;
  }
}

export class TransactionPageDto {
  @ApiProperty({ type: TransactionDto, isArray: true }) items: TransactionDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class TransactionsSummaryDto {
  @ApiProperty({ description: 'Spent in PKR within the filter' }) spentPkr: number;
  @ApiProperty({ description: 'Received in PKR within the filter' }) receivedPkr: number;
  @ApiProperty() entries: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Largest single expense in PKR' })
  biggestExpensePkr: number | null;
}
