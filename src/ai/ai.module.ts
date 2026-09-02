import { Module } from '@nestjs/common';
import { CommitteesModule } from '../committees/committees.module';
import { DebtsModule } from '../debts/debts.module';
import { ReportsModule } from '../reports/reports.module';
import { ZakatModule } from '../zakat/zakat.module';
import { AiAdminController } from './ai-admin.controller';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ContextService } from './context.service';
import { SnapshotsService } from './snapshots.service';

@Module({
  imports: [ReportsModule, CommitteesModule, ZakatModule, DebtsModule],
  controllers: [AiController, AiAdminController],
  providers: [AiService, ContextService, SnapshotsService],
})
export class AiModule {}
