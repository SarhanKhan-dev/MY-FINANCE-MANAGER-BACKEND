import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Person } from '@prisma/client';
import { IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { PeopleService } from './people.service';

class CreatePersonDto {
  @ApiProperty({ example: 'Ahmed', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  phone?: string;
}

export class PersonDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;

  static from(person: Person): PersonDto {
    const dto = new PersonDto();
    dto.id = person.id;
    dto.name = person.name;
    dto.phone = person.phone;
    return dto;
  }
}

@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  @ApiOkResponse({ type: PersonDto, isArray: true })
  async list(@CurrentUser() user: SafeUser): Promise<PersonDto[]> {
    return (await this.peopleService.list(user.id)).map(PersonDto.from);
  }

  @Post()
  @ApiOkResponse({ type: PersonDto })
  async create(@CurrentUser() user: SafeUser, @Body() dto: CreatePersonDto): Promise<PersonDto> {
    return PersonDto.from(await this.peopleService.create(user.id, dto.name, dto.phone));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOkResponse({ type: PersonDto })
  async archive(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<PersonDto> {
    return PersonDto.from(await this.peopleService.archive(user.id, id));
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.peopleService.remove(user.id, id);
    return { ok: true };
  }
}
