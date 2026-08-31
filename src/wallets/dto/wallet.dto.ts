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
  @ApiProperty({ description: 'Still owed to people whose loans came into this wallet (PKR)' })
  loanStillOwePkr: number;
  @ApiProperty({ description: 'Still owed to you from loans given out of this wallet (PKR)' })
  loanStillOwedToMePkr: number;

  static from(
    wallet: Wallet,
    balance: string,
    loans?: { stillOwePkr: number; stillOwedToMePkr: number },
  ): WalletDto {
    const dto = new WalletDto();
    dto.id = wallet.id;
    dto.name = wallet.name;
    dto.kind = wallet.kind;
    dto.currency = wallet.currency;
    dto.balance = balance;
    dto.archived = wallet.archivedAt !== null;
    dto.loanStillOwePkr = loans?.stillOwePkr ?? 0;
    dto.loanStillOwedToMePkr = loans?.stillOwedToMePkr ?? 0;
    return dto;
  }
}
