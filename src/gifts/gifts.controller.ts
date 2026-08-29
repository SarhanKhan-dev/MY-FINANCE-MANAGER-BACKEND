import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { GiftEntry, GiftsService, GiftsView } from './gifts.service';

class GiftEntryDto implements GiftEntry {
  @ApiProperty() id: string;
  @ApiProperty({ example: '2026-08-29' }) date: string;
  @ApiProperty() amountPkr: number;
  @ApiProperty({ enum: ['GIVEN', 'RECEIVED'] }) direction: 'GIVEN' | 'RECEIVED';
  @ApiProperty({ type: String, nullable: true }) personName: string | null;
  @ApiProperty({ type: String, nullable: true }) detail: string | null;
}

class GiftsViewDto implements GiftsView {
  @ApiProperty() givenPkr: number;
  @ApiProperty() receivedPkr: number;
  @ApiProperty() givenThisYearPkr: number;
  @ApiProperty() receivedThisYearPkr: number;
  @ApiProperty({ type: GiftEntryDto, isArray: true }) entries: GiftEntryDto[];
}

@ApiTags('gifts')
@ApiBearerAuth()
@Controller('gifts')
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get()
  @ApiOkResponse({ type: GiftsViewDto })
  view(@CurrentUser() user: SafeUser): Promise<GiftsViewDto> {
    return this.giftsService.view(user.id);
  }
}
