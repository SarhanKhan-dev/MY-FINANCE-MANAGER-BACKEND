import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { GoldModule } from '../gold/gold.module';
import { InvestmentsModule } from '../investments/investments.module';
import { WalletsModule } from '../wallets/wallets.module';
import { ZakatController } from './zakat.controller';
import { ZakatService } from './zakat.service';

@Module({
  imports: [WalletsModule, FxModule, GoldModule, InvestmentsModule],
  controllers: [ZakatController],
  providers: [ZakatService],
})
export class ZakatModule {}
