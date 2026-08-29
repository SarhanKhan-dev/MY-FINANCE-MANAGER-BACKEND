import { Module } from '@nestjs/common';
import { BudgetModule } from '../budget/budget.module';
import { EventsModule } from '../events/events.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  imports: [EventsModule, BudgetModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
