import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Currency, WalletKind } from '@prisma/client';
import { BudgetStatusDto } from '../budget/budget.controller';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { TransactionDto } from '../transactions/dto/transaction.dto';
import { ReportsService } from './reports.service';

class OverviewWalletDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: WalletKind }) kind: WalletKind;
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiProperty({ type: String }) balance: string;
  @ApiProperty() archived: boolean;
}

class OverviewTotalsDto {
  @ApiProperty({ type: Number, nullable: true }) netWorthPkr: number | null;
  @ApiProperty() banksPkr: number;
  @ApiProperty() mobilePkr: number;
  @ApiProperty() cashPkr: number;
  @ApiProperty({ description: 'USD wallet balances in dollars, never converted' })
  dollarsUsd: number;
  @ApiProperty() investmentsPkr: number;
  @ApiProperty({ type: Number, nullable: true }) goldPkr: number | null;
  @ApiProperty({ type: Number, nullable: true }) usdRate: number | null;
}

class CategoryLeaderDto {
  @ApiProperty() name: string;
  @ApiProperty() spentPkr: number;
}

class OverviewDebtsDto {
  @ApiProperty() iOwePkr: number;
  @ApiProperty() owedToMePkr: number;
  @ApiProperty() iOweUsd: number;
  @ApiProperty() owedToMeUsd: number;
}

class UpcomingItemDto {
  @ApiProperty({ enum: ['bill', 'subscription'] }) kind: 'bill' | 'subscription';
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: '2026-09-01' }) dueOn: string;
  @ApiProperty({ type: Number, nullable: true }) amountPkr: number | null;
  @ApiProperty() overdue: boolean;
}

class OverviewDto {
  @ApiProperty({ type: BudgetStatusDto }) budget: BudgetStatusDto;
  @ApiProperty({ type: OverviewWalletDto, isArray: true }) wallets: OverviewWalletDto[];
  @ApiProperty({ type: OverviewTotalsDto }) totals: OverviewTotalsDto;
  @ApiProperty({ type: OverviewDebtsDto }) debts: OverviewDebtsDto;
  @ApiProperty({ type: CategoryLeaderDto, isArray: true })
  categoryLeaders: CategoryLeaderDto[];
  @ApiProperty({ type: String, isArray: true }) missedDays: string[];
  @ApiProperty({ type: UpcomingItemDto, isArray: true }) upcoming: UpcomingItemDto[];
  @ApiProperty({ type: TransactionDto, isArray: true }) recent: TransactionDto[];
}

class MonthFlowDto {
  @ApiProperty({ example: '2026-08' }) monthKey: string;
  @ApiProperty() spentPkr: number;
  @ApiProperty() receivedPkr: number;
}

class NamedTotalDto {
  @ApiProperty() name: string;
  @ApiProperty() totalPkr: number;
}

class ChartsDto {
  @ApiProperty({ type: MonthFlowDto, isArray: true }) months: MonthFlowDto[];
  @ApiProperty({ type: CategoryLeaderDto, isArray: true }) categories: CategoryLeaderDto[];
  @ApiProperty({ type: NamedTotalDto, isArray: true }) topShops: NamedTotalDto[];
  @ApiProperty({ type: NamedTotalDto, isArray: true }) topProducts: NamedTotalDto[];
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('overview')
  @ApiOkResponse({ type: OverviewDto })
  async overview(@CurrentUser() user: SafeUser): Promise<OverviewDto> {
    const overview = await this.reportsService.overview(user.id);
    return {
      budget: overview.budget,
      wallets: overview.wallets,
      totals: overview.totals,
      debts: overview.debts,
      categoryLeaders: overview.categoryLeaders,
      missedDays: overview.missedDays,
      upcoming: overview.upcoming,
      recent: overview.recent.map(TransactionDto.from),
    };
  }

  @Get('charts')
  @ApiOkResponse({ type: ChartsDto })
  charts(@CurrentUser() user: SafeUser): Promise<ChartsDto> {
    return this.reportsService.charts(user.id);
  }
}
