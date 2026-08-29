import { ApiProperty } from '@nestjs/swagger';
import { UserSettings } from '@prisma/client';

export class SettingsDto {
  @ApiProperty({ type: String, example: '100000', description: 'Monthly spend cap in PKR' })
  budgetCapPkr: string;

  @ApiProperty({ minimum: 1, maximum: 28, description: 'Day of month the budget cycle starts' })
  budgetCycleStartDay: number;

  @ApiProperty() countLendingInCap: boolean;
  @ApiProperty() countWriteOffsInCap: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  static from(settings: UserSettings): SettingsDto {
    const dto = new SettingsDto();
    dto.budgetCapPkr = settings.budgetCapPkr.toString();
    dto.budgetCycleStartDay = settings.budgetCycleStartDay;
    dto.countLendingInCap = settings.countLendingInCap;
    dto.countWriteOffsInCap = settings.countWriteOffsInCap;
    dto.updatedAt = settings.updatedAt;
    return dto;
  }
}
