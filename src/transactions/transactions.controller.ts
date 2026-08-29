import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import {
  TransactionDto,
  TransactionPageDto,
  TransactionsSummaryDto,
} from './dto/transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOkResponse({ type: TransactionPageDto })
  async list(
    @CurrentUser() user: SafeUser,
    @Query() query: QueryTransactionsDto,
  ): Promise<TransactionPageDto> {
    const { items, total } = await this.transactionsService.list(user.id, query);
    return {
      items: items.map(TransactionDto.from),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  @Get('summary')
  @ApiOkResponse({ type: TransactionsSummaryDto })
  summary(
    @CurrentUser() user: SafeUser,
    @Query() query: QueryTransactionsDto,
  ): Promise<TransactionsSummaryDto> {
    return this.transactionsService.summary(user.id, query);
  }

  @Get('missing-days')
  async missingDays(
    @CurrentUser() user: SafeUser,
    @Query() query: QueryTransactionsDto,
  ): Promise<{ dates: string[] }> {
    return { dates: await this.transactionsService.missingDays(user.id, query.from, query.to) };
  }

  @Post()
  @ApiHeader({ name: 'idempotency-key', required: false })
  @ApiOkResponse({ type: TransactionDto })
  async create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CreateTransactionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<TransactionDto> {
    return TransactionDto.from(
      await this.transactionsService.create(user.id, dto, idempotencyKey || undefined),
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: TransactionDto })
  async get(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<TransactionDto> {
    return TransactionDto.from(await this.transactionsService.get(user.id, id));
  }

  @Patch(':id')
  @ApiOkResponse({ type: TransactionDto })
  async update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ): Promise<TransactionDto> {
    return TransactionDto.from(await this.transactionsService.update(user.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.transactionsService.remove(user.id, id);
    return { ok: true };
  }
}
