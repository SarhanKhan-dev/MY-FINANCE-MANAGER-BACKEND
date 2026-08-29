import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { GoalsService, GoalView, WishView } from './goals.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class CreateGoalDto {
  @ApiProperty({ example: 'Save for a laptop', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ example: 30000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  targetPkr: number;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_RE)
  deadline?: string;
}

class ContributeDto {
  @ApiProperty({ example: 5000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amountPkr: number;

  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

class CreateWishDto {
  @ApiProperty({ example: 'AirPods', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ example: 45000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  targetPricePkr: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 3, default: 2, description: '1 = must have' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  priority?: number;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  link?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

class GoalDto implements GoalView {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() targetPkr: number;
  @ApiProperty() savedPkr: number;
  @ApiProperty() pct: number;
  @ApiProperty({ type: String, nullable: true }) deadline: string | null;
  @ApiProperty({ type: String, nullable: true }) projectedFinish: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) onTrack: boolean | null;
  @ApiProperty() archived: boolean;
}

class WishDto implements WishView {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() targetPricePkr: number;
  @ApiProperty() priority: number;
  @ApiProperty({ type: String, nullable: true }) link: string | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty() bought: boolean;
  @ApiProperty({ type: Number, nullable: true }) capPctAfterBuying: number | null;
  @ApiProperty({ type: Boolean, nullable: true }) fitsThisMonth: boolean | null;
  @ApiProperty() archived: boolean;
}

@ApiTags('goals')
@ApiBearerAuth()
@Controller()
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get('goals')
  @ApiOkResponse({ type: GoalDto, isArray: true })
  listGoals(@CurrentUser() user: SafeUser): Promise<GoalDto[]> {
    return this.goalsService.listGoals(user.id);
  }

  @Post('goals')
  @HttpCode(200)
  async createGoal(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateGoalDto,
  ): Promise<{ id: string }> {
    const goal = await this.goalsService.createGoal(user.id, dto);
    return { id: goal.id };
  }

  @Post('goals/:id/contribute')
  @HttpCode(200)
  async contribute(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: ContributeDto,
  ): Promise<{ ok: true }> {
    await this.goalsService.contribute(user.id, id, dto);
    return { ok: true };
  }

  @Post('goals/:id/archive')
  @HttpCode(200)
  async archiveGoal(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.goalsService.archiveGoal(user.id, id);
    return { ok: true };
  }

  @Delete('goals/:id')
  @HttpCode(200)
  async removeGoal(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.goalsService.removeGoal(user.id, id);
    return { ok: true };
  }

  @Get('wishlist')
  @ApiOkResponse({ type: WishDto, isArray: true })
  listWishes(@CurrentUser() user: SafeUser): Promise<WishDto[]> {
    return this.goalsService.listWishes(user.id);
  }

  @Post('wishlist')
  @HttpCode(200)
  async createWish(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateWishDto,
  ): Promise<{ id: string }> {
    const wish = await this.goalsService.createWish(user.id, dto);
    return { id: wish.id };
  }

  @Post('wishlist/:id/bought')
  @HttpCode(200)
  async markBought(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.goalsService.markBought(user.id, id);
    return { ok: true };
  }

  @Delete('wishlist/:id')
  @HttpCode(200)
  async removeWish(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.goalsService.removeWish(user.id, id);
    return { ok: true };
  }
}
