import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, WalletKind } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, Length } from 'class-validator';

export class CreateWalletDto {
  @ApiProperty({ example: 'Meezan Bank', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ enum: WalletKind })
  @IsEnum(WalletKind)
  kind: WalletKind;

  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({
    description: 'What the wallet already holds, in its own currency; recorded as an OPENING entry',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  openingBalance?: number;

  @ApiPropertyOptional({ description: 'PKR per USD, required when a USD wallet opens with money' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  openingFxRate?: number;
}

export class UpdateWalletDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;
}
