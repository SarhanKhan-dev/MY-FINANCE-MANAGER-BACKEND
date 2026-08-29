import { Module } from '@nestjs/common';
import { BudgetModule } from '../budget/budget.module';
import { EventsModule } from '../events/events.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({
  imports: [EventsModule, BudgetModule],
  controllers: [GoalsController],
  providers: [GoalsService],
})
export class GoalsModule {}
