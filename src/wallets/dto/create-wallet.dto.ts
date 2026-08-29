import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency, WalletKind } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

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
}

export class UpdateWalletDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;
}
