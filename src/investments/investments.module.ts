import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { FxModule } from '../fx/fx.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';

@Module({
  imports: [EventsModule, TransactionsModule, FxModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
