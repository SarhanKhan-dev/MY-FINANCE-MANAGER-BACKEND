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
import { Currency, Subscription, SubscriptionPeriod } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { TransactionDto } from '../transactions/dto/transaction.dto';
import { SubscriptionsService } from './subscriptions.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class CreateSubscriptionDto {
  @ApiProperty({ example: 'YouTube Premium', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiProperty({ example: 479 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ enum: Currency })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiProperty({ enum: SubscriptionPeriod })
  @IsEnum(SubscriptionPeriod)
  period: SubscriptionPeriod;

  @ApiProperty({ example: '2026-09-12' })
  @Matches(DATE_RE)
  renewsOn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultWalletId?: string;
}

class UpdateSubscriptionDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ example: '2026-09-12' })
  @IsOptional()
  @Matches(DATE_RE)
  renewsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  defaultWalletId?: string;
}

class RenewSubscriptionDto {
  @ApiProperty()
  @IsString()
  walletId: string;

  @ApiPropertyOptional({ example: '2026-08-29' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
}

export class SubscriptionDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String }) amount: string;
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiProperty({ enum: SubscriptionPeriod }) period: SubscriptionPeriod;
  @ApiProperty({ example: '2026-09-12' }) renewsOn: string;
  @ApiProperty({ type: String, nullable: true }) defaultWalletId: string | null;
  @ApiProperty() archived: boolean;

  static from(subscription: Subscription): SubscriptionDto {
    const dto = new SubscriptionDto();
    dto.id = subscription.id;
    dto.name = subscription.name;
    dto.amount = subscription.amount.toFixed(2);
    dto.currency = subscription.currency;
    dto.period = subscription.period;
    dto.renewsOn = subscription.renewsOn.toISOString().slice(0, 10);
    dto.defaultWalletId = subscription.defaultWalletId;
    dto.archived = subscription.archivedAt !== null;
    return dto;
  }
}

class RenewResponseDto {
  @ApiProperty({ type: SubscriptionDto }) subscription: SubscriptionDto;
  @ApiProperty({ type: TransactionDto }) transaction: TransactionDto;
}

@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @ApiOkResponse({ type: SubscriptionDto, isArray: true })
  async list(@CurrentUser() user: SafeUser): Promise<SubscriptionDto[]> {
    return (await this.subscriptionsService.list(user.id)).map(SubscriptionDto.from);
  }

  @Post()
  @ApiOkResponse({ type: SubscriptionDto })
  async create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionDto> {
    return SubscriptionDto.from(await this.subscriptionsService.create(user.id, dto));
  }

  @Patch(':id')
  @ApiOkResponse({ type: SubscriptionDto })
  async update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ): Promise<SubscriptionDto> {
    return SubscriptionDto.from(await this.subscriptionsService.update(user.id, id, dto));
  }

  @Post(':id/renew')
  @HttpCode(200)
  @ApiOkResponse({ type: RenewResponseDto })
  async renew(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: RenewSubscriptionDto,
  ): Promise<RenewResponseDto> {
    const { subscription, transaction } = await this.subscriptionsService.renew(
      user.id,
      id,
      dto,
    );
    return {
      subscription: SubscriptionDto.from(subscription),
      transaction: TransactionDto.from(transaction),
    };
  }

  @Post(':id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.subscriptionsService.archive(user.id, id);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.subscriptionsService.remove(user.id, id);
    return { ok: true };
  }
}
