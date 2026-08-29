import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';

@Module({
  imports: [EventsModule, TransactionsModule],
  controllers: [CommitteesController],
  providers: [CommitteesService],
  exports: [CommitteesService],
})
export class CommitteesModule {}
