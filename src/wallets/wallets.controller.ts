import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { CreateWalletDto, UpdateWalletDto } from './dto/create-wallet.dto';
import { WalletDto } from './dto/wallet.dto';
import { WalletsService } from './wallets.service';

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @ApiOkResponse({ type: WalletDto, isArray: true })
  async list(@CurrentUser() user: SafeUser): Promise<WalletDto[]> {
    const rows = await this.walletsService.list(user.id);
    return rows.map(({ wallet, balance }) => WalletDto.from(wallet, balance.toFixed(2)));
  }

  @Post()
  @ApiOkResponse({ type: WalletDto })
  async create(@CurrentUser() user: SafeUser, @Body() dto: CreateWalletDto): Promise<WalletDto> {
    const wallet = await this.walletsService.create(user.id, dto);
    return WalletDto.from(wallet, '0.00');
  }

  @Patch(':id')
  @ApiOkResponse({ type: WalletDto })
  async update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateWalletDto,
  ): Promise<WalletDto> {
    const wallet = await this.walletsService.update(user.id, id, dto);
    const balance = (await this.walletsService.balances(user.id)).get(wallet.id);
    return WalletDto.from(wallet, (balance ?? new Prisma.Decimal(0)).toFixed(2));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOkResponse({ type: WalletDto })
  async archive(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<WalletDto> {
    const wallet = await this.walletsService.archive(user.id, id);
    return WalletDto.from(wallet, '0.00');
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  @ApiOkResponse({ type: WalletDto })
  async unarchive(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<WalletDto> {
    const wallet = await this.walletsService.unarchive(user.id, id);
    const balance = (await this.walletsService.balances(user.id)).get(wallet.id);
    return WalletDto.from(wallet, (balance ?? new Prisma.Decimal(0)).toFixed(2));
  }
}
