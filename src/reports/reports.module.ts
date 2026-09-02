import { Module } from '@nestjs/common';
import { BudgetModule } from '../budget/budget.module';
import { DebtsModule } from '../debts/debts.module';
import { FxModule } from '../fx/fx.module';
import { GoldModule } from '../gold/gold.module';
import { InvestmentsModule } from '../investments/investments.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    BudgetModule,
    WalletsModule,
    FxModule,
    DebtsModule,
    InvestmentsModule,
    GoldModule,
    TransactionsModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
