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
  @ApiProperty({
    description: 'Still owed to people whose loans came into this wallet, in the wallet currency',
  })
  loanStillOwe: number;
  @ApiProperty({
    description: 'Still owed to you from loans given out of this wallet, in the wallet currency',
  })
  loanStillOwedToMe: number;

  static from(
    wallet: Wallet,
    balance: string,
    loans?: { stillOwe: number; stillOwedToMe: number },
  ): WalletDto {
    const dto = new WalletDto();
    dto.id = wallet.id;
    dto.name = wallet.name;
    dto.kind = wallet.kind;
    dto.currency = wallet.currency;
    dto.balance = balance;
    dto.archived = wallet.archivedAt !== null;
    dto.loanStillOwe = loans?.stillOwe ?? 0;
    dto.loanStillOwedToMe = loans?.stillOwedToMe ?? 0;
    return dto;
  }
}
