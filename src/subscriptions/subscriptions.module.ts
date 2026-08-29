import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [EventsModule, TransactionsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
