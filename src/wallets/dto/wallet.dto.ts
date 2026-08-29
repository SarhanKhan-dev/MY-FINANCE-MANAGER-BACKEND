import { ApiProperty } from '@nestjs/swagger';
import { Currency, Wallet, WalletKind } from '@prisma/client';

export class WalletDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: WalletKind }) kind: WalletKind;
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiProperty({ type: String, example: '25000.00', description: 'Balance in the wallet currency' })
  balance: string;
  @ApiProperty() archived: boolean;

  static from(wallet: Wallet, balance: string): WalletDto {
    const dto = new WalletDto();
    dto.id = wallet.id;
    dto.name = wallet.name;
    dto.kind = wallet.kind;
    dto.currency = wallet.currency;
    dto.balance = balance;
    dto.archived = wallet.archivedAt !== null;
    return dto;
  }
}
