import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Merchant } from '@prisma/client';
import { IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { TransactionDto } from '../transactions/dto/transaction.dto';
import { MerchantsService } from './merchants.service';

class MerchantDetailDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() spentAllTimePkr: number;
  @ApiProperty() spentThisCyclePkr: number;
  @ApiProperty() tripCount: number;
  @ApiProperty() avgTripPkr: number;
  @ApiProperty({ type: TransactionDto, isArray: true }) entries: TransactionDto[];
}

class MerchantNameDto {
  @ApiProperty({ example: 'Al-Madina Store', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;
}

export class MerchantDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;

  static from(merchant: Merchant): MerchantDto {
    const dto = new MerchantDto();
    dto.id = merchant.id;
    dto.name = merchant.name;
    return dto;
  }
}

@ApiTags('merchants')
@ApiBearerAuth()
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Get()
  @ApiOkResponse({ type: MerchantDto, isArray: true })
  async list(@CurrentUser() user: SafeUser): Promise<MerchantDto[]> {
    return (await this.merchantsService.list(user.id)).map(MerchantDto.from);
  }

  @Post()
  @ApiOkResponse({ type: MerchantDto })
  async create(
    @CurrentUser() user: SafeUser,
    @Body() dto: MerchantNameDto,
  ): Promise<MerchantDto> {
    return MerchantDto.from(await this.merchantsService.create(user.id, dto.name));
  }

  @Get(':id')
  @ApiOkResponse({ type: MerchantDetailDto })
  async detail(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<MerchantDetailDto> {
    const detail = await this.merchantsService.detail(user.id, id);
    return { ...detail, entries: detail.entries.map(TransactionDto.from) };
  }

  @Patch(':id')
  @ApiOkResponse({ type: MerchantDto })
  async rename(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: MerchantNameDto,
  ): Promise<MerchantDto> {
    return MerchantDto.from(await this.merchantsService.rename(user.id, id, dto.name));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOkResponse({ type: MerchantDto })
  async archive(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<MerchantDto> {
    return MerchantDto.from(await this.merchantsService.archive(user.id, id));
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.merchantsService.remove(user.id, id);
    return { ok: true };
  }
}
