import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { BudgetService, BudgetStatus } from './budget.service';

export class BudgetStatusDto implements BudgetStatus {
  @ApiProperty({ example: '2026-08-01' }) cycleStart: string;
  @ApiProperty({ example: '2026-09-01' }) cycleEnd: string;
  @ApiProperty() capPkr: number;
  @ApiProperty() spentPkr: number;
  @ApiProperty() remainingPkr: number;
  @ApiProperty() pct: number;
  @ApiProperty() daysLeft: number;
  @ApiProperty() dailyPacePkr: number;
  @ApiProperty() safePacePkr: number;
}

@ApiTags('budget')
@ApiBearerAuth()
@Controller('budget')
export class BudgetController {
  constructor(private readonly budgetService: BudgetService) {}

  @Get('current')
  @ApiOkResponse({ type: BudgetStatusDto })
  current(@CurrentUser() user: SafeUser): Promise<BudgetStatus> {
    return this.budgetService.current(user.id);
  }
}
