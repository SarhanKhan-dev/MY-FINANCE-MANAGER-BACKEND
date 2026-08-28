import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNumber, IsPositive, Max, Min } from 'class-validator';

export class OnboardingDto {
  @ApiProperty({ example: 100000, description: 'Monthly spend cap in PKR' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000)
  budgetCapPkr: number;

  @ApiProperty({ minimum: 1, maximum: 28, description: 'Day of month the budget cycle starts' })
  @IsInt()
  @Min(1)
  @Max(28)
  budgetCycleStartDay: number;
}
