import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { EventsService } from './events.service';

class ActivityQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 30;
}

class ActivityItemDto {
  @ApiProperty() id: string;
  @ApiProperty() type: string;
  @ApiProperty() entityType: string;
  @ApiProperty({ type: String, nullable: true }) entityId: string | null;
  @ApiProperty({ nullable: true }) before: unknown;
  @ApiProperty({ nullable: true }) after: unknown;
  @ApiProperty() createdAt: Date;
}

class ActivityPageDto {
  @ApiProperty({ type: ActivityItemDto, isArray: true }) items: ActivityItemDto[];
  @ApiProperty() total: number;
}

@ApiTags('activity')
@ApiBearerAuth()
@Controller('activity')
export class ActivityController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @ApiOkResponse({ type: ActivityPageDto })
  async list(
    @CurrentUser() user: SafeUser,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityPageDto> {
    return this.eventsService.list(user.id, query.page, query.pageSize);
  }
}
