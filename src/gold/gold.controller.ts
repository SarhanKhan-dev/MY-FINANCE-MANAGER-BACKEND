import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { GoldService } from './gold.service';

class AddGoldDto {
  @ApiProperty({ example: 'Wedding bangles', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ example: 23.3, description: 'Weight in grams' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  weightGrams: number;

  @ApiPropertyOptional({ example: '22k' })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  purity?: string;

  @ApiProperty({ example: 450000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  boughtPricePkr: number;
}

class UpdateGoldDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  weightGrams?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 10)
  purity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  boughtPricePkr?: number;
}

class GoldRateDto {
  @ApiProperty({ example: 24500, description: 'PKR per gram' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  ratePkrPerGram: number;
}

class GoldHoldingDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() weightGrams: number;
  @ApiProperty({ type: String, nullable: true }) purity: string | null;
  @ApiProperty() boughtPricePkr: number;
  @ApiProperty({ type: Number, nullable: true }) currentValuePkr: number | null;
  @ApiProperty() archived: boolean;
}

class GoldOverviewDto {
  @ApiProperty({ type: Number, nullable: true }) ratePkrPerGram: number | null;
  @ApiProperty() totalGrams: number;
  @ApiProperty() boughtPkr: number;
  @ApiProperty({ type: Number, nullable: true }) currentValuePkr: number | null;
  @ApiProperty({ type: Number, nullable: true }) gainPkr: number | null;
  @ApiProperty({ type: GoldHoldingDto, isArray: true }) holdings: GoldHoldingDto[];
}

@ApiTags('gold')
@ApiBearerAuth()
@Controller('gold')
export class GoldController {
  constructor(private readonly goldService: GoldService) {}

  @Get()
  @ApiOkResponse({ type: GoldOverviewDto })
  overview(@CurrentUser() user: SafeUser): Promise<GoldOverviewDto> {
    return this.goldService.overview(user.id);
  }

  @Post()
  @HttpCode(200)
  async add(@CurrentUser() user: SafeUser, @Body() dto: AddGoldDto): Promise<{ id: string }> {
    const holding = await this.goldService.add(user.id, dto);
    return { id: holding.id };
  }

  @Patch('rate')
  @HttpCode(200)
  async setRate(
    @CurrentUser() user: SafeUser,
    @Body() dto: GoldRateDto,
  ): Promise<{ ok: true }> {
    await this.goldService.setRate(user.id, dto.ratePkrPerGram);
    return { ok: true };
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateGoldDto,
  ): Promise<{ ok: true }> {
    await this.goldService.update(user.id, id, dto);
    return { ok: true };
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.goldService.archive(user.id, id);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.goldService.remove(user.id, id);
    return { ok: true };
  }
}
