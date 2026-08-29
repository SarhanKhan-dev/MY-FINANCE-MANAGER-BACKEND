import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { ZakatService, ZakatView } from './zakat.service';

class ZakatLineDto {
  @ApiProperty() label: string;
  @ApiProperty() amountPkr: number;
}

class ZakatDto implements ZakatView {
  @ApiProperty({ type: ZakatLineDto, isArray: true }) lines: ZakatLineDto[];
  @ApiProperty() zakatablePkr: number;
  @ApiProperty({ type: Number, nullable: true }) nisabPkr: number | null;
  @ApiProperty({ enum: ['manual', 'gold-rate'], nullable: true })
  nisabSource: 'manual' | 'gold-rate' | null;
  @ApiProperty({ type: Boolean, nullable: true }) aboveNisab: boolean | null;
  @ApiProperty({ type: Number, nullable: true }) duePkr: number | null;
  @ApiProperty() charityThisYearPkr: number;
  @ApiProperty() zakatPaidThisYearPkr: number;
}

@ApiTags('zakat')
@ApiBearerAuth()
@Controller('zakat')
export class ZakatController {
  constructor(private readonly zakatService: ZakatService) {}

  @Get()
  @ApiOkResponse({ type: ZakatDto })
  view(@CurrentUser() user: SafeUser): Promise<ZakatDto> {
    return this.zakatService.view(user.id);
  }
}
