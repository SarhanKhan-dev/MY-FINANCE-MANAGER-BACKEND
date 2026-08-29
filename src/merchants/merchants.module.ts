import { Module } from '@nestjs/common';
import { BudgetModule } from '../budget/budget.module';
import { EventsModule } from '../events/events.module';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';

@Module({
  imports: [EventsModule, BudgetModule],
  controllers: [MerchantsController],
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
