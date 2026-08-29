import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Merchant } from '@prisma/client';
import { IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { MerchantsService } from './merchants.service';

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
}
