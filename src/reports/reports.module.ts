import { Module } from '@nestjs/common';
import { BudgetModule } from '../budget/budget.module';
import { FxModule } from '../fx/fx.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BudgetModule, WalletsModule, FxModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
