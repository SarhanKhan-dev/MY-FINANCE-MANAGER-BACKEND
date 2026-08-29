import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { FxService } from './fx.service';

class FxRateDto {
  @ApiProperty({ example: 278.5 }) rate: number;
  @ApiProperty({ type: String, format: 'date-time' }) fetchedAt: Date;
}

@ApiTags('fx')
@ApiBearerAuth()
@Controller('fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('usd-pkr')
  @ApiOkResponse({ type: FxRateDto })
  usdToPkr(): Promise<FxRateDto> {
    return this.fxService.usdToPkr();
  }
}
