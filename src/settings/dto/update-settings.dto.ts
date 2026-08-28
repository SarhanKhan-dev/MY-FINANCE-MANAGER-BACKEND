import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, Max, Min } from 'class-validator';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: 100000, description: 'Monthly spend cap in PKR' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000)
  budgetCapPkr?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 28 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  budgetCycleStartDay?: number;
}
