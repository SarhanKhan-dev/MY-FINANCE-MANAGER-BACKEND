import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { GoldController } from './gold.controller';
import { GoldService } from './gold.service';

@Module({
  imports: [EventsModule],
  controllers: [GoldController],
  providers: [GoldService],
  exports: [GoldService],
})
export class GoldModule {}
