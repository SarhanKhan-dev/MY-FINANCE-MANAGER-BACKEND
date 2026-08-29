import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';

@Module({
  imports: [EventsModule, TransactionsModule],
  controllers: [BillsController],
  providers: [BillsService],
  exports: [BillsService],
})
export class BillsModule {}
