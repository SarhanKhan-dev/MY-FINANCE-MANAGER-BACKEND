import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { PeopleService } from '../people/people.service';
import { TransactionDto } from '../transactions/dto/transaction.dto';
import { transactionInclude } from '../transactions/transaction-with-refs';
import { PrismaService } from '../prisma/prisma.service';
import { DebtsService } from './debts.service';

class PersonPositionDto {
  @ApiProperty() personId: string;
  @ApiProperty() name: string;
  @ApiProperty() iOwePkr: number;
  @ApiProperty() owedToMePkr: number;
  @ApiProperty() takenPkr: number;
  @ApiProperty() writtenOffPkr: number;
}

class DebtsSummaryDto {
  @ApiProperty() iOwePkr: number;
  @ApiProperty() owedToMePkr: number;
  @ApiProperty({ type: PersonPositionDto, isArray: true }) people: PersonPositionDto[];
}

class PersonLedgerDto {
  @ApiProperty() personId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty() iOwePkr: number;
  @ApiProperty() owedToMePkr: number;
  @ApiProperty() takenPkr: number;
  @ApiProperty() writtenOffPkr: number;
  @ApiProperty({ type: TransactionDto, isArray: true }) entries: TransactionDto[];
}

@ApiTags('debts')
@ApiBearerAuth()
@Controller('debts')
export class DebtsController {
  constructor(
    private readonly debtsService: DebtsService,
    private readonly peopleService: PeopleService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('summary')
  @ApiOkResponse({ type: DebtsSummaryDto })
  summary(@CurrentUser() user: SafeUser): Promise<DebtsSummaryDto> {
    return this.debtsService.summary(user.id);
  }

  @Get('person/:id')
  @ApiOkResponse({ type: PersonLedgerDto })
  async personLedger(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<PersonLedgerDto> {
    const person = await this.peopleService.findOrFail(user.id, id);
    const [position, entries] = await Promise.all([
      this.debtsService.positionFor(user.id, id),
      this.prisma.transaction.findMany({
        where: { userId: user.id, personId: id },
        include: transactionInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
    ]);
    return {
      personId: person.id,
      name: person.name,
      phone: person.phone,
      iOwePkr: position.iOwePkr,
      owedToMePkr: position.owedToMePkr,
      takenPkr: position.takenPkr,
      writtenOffPkr: position.writtenOffPkr,
      entries: entries.map(TransactionDto.from),
    };
  }
}
