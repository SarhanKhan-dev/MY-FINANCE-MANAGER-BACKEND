import { Module } from '@nestjs/common';
import { PeopleModule } from '../people/people.module';
import { DebtsController } from './debts.controller';
import { DebtsService } from './debts.service';

@Module({
  imports: [PeopleModule],
  controllers: [DebtsController],
  providers: [DebtsService],
  exports: [DebtsService],
})
export class DebtsModule {}
