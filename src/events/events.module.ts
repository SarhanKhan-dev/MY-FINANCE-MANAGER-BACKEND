import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller';
import { EventsService } from './events.service';

@Module({
  controllers: [ActivityController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
