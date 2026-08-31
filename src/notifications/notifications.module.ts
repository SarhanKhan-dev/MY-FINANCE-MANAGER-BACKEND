import { Module } from '@nestjs/common';
import { BudgetModule } from '../budget/budget.module';
import { CommitteesModule } from '../committees/committees.module';
import { DebtsModule } from '../debts/debts.module';
import { ZakatModule } from '../zakat/zakat.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [DebtsModule, BudgetModule, CommitteesModule, ZakatModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
