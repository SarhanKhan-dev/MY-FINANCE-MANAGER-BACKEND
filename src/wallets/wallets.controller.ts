import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Currency, Prisma } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { CreateWalletDto, UpdateWalletDto } from './dto/create-wallet.dto';
import { WalletDto } from './dto/wallet.dto';
import { WalletLoanPerson, WalletLoansView, WalletsService } from './wallets.service';

class WalletLoanPersonDto implements WalletLoanPerson {
  @ApiProperty() personId: string;
  @ApiProperty() name: string;
  @ApiProperty() borrowedIn: number;
  @ApiProperty() lentOut: number;
  @ApiProperty() stillOwe: number;
  @ApiProperty() stillOwedToMe: number;
}

class WalletLoansViewDto implements WalletLoansView {
  @ApiProperty({ enum: Currency }) currency: Currency;
  @ApiProperty() borrowedIn: number;
  @ApiProperty() lentOut: number;
  @ApiProperty() stillOwe: number;
  @ApiProperty() stillOwedToMe: number;
  @ApiProperty({ type: WalletLoanPersonDto, isArray: true }) people: WalletLoanPersonDto[];
}

@ApiTags('wallets')
@ApiBearerAuth()
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get()
  @ApiOkResponse({ type: WalletDto, isArray: true })
  async list(@CurrentUser() user: SafeUser): Promise<WalletDto[]> {
    const [rows, slashes] = await Promise.all([
      this.walletsService.list(user.id),
      this.walletsService.loanSlashes(user.id),
    ]);
    return rows.map(({ wallet, balance }) =>
      WalletDto.from(wallet, balance.toFixed(2), slashes.get(wallet.id)),
    );
  }

  @Get(':id/loans')
  @ApiOkResponse({ type: WalletLoansViewDto })
  loans(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<WalletLoansViewDto> {
    return this.walletsService.loanFlows(user.id, id);
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
