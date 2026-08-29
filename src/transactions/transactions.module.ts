import { Module } from '@nestjs/common';
import { BudgetModule } from '../budget/budget.module';
import { DebtsModule } from '../debts/debts.module';
import { EventsModule } from '../events/events.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [EventsModule, BudgetModule, DebtsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
