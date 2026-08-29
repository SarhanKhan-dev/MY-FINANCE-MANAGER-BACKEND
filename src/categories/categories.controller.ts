import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Category } from '@prisma/client';
import { IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { CategoriesService } from './categories.service';

class CategoryNameDto {
  @ApiProperty({ example: 'Dining out', minLength: 1, maxLength: 40 })
  @IsString()
  @Length(1, 40)
  name: string;
}

export class CategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() archived: boolean;

  static from(category: Category): CategoryDto {
    const dto = new CategoryDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.archived = category.archivedAt !== null;
    return dto;
  }
}

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOkResponse({ type: CategoryDto, isArray: true })
  async list(@CurrentUser() user: SafeUser): Promise<CategoryDto[]> {
    return (await this.categoriesService.list(user.id)).map(CategoryDto.from);
  }

  @Post()
  @ApiOkResponse({ type: CategoryDto })
  async create(
    @CurrentUser() user: SafeUser,
    @Body() dto: CategoryNameDto,
  ): Promise<CategoryDto> {
    return CategoryDto.from(await this.categoriesService.create(user.id, dto.name));
  }

  @Patch(':id')
  @ApiOkResponse({ type: CategoryDto })
  async rename(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: CategoryNameDto,
  ): Promise<CategoryDto> {
    return CategoryDto.from(await this.categoriesService.rename(user.id, id, dto.name));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOkResponse({ type: CategoryDto })
  async archive(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<CategoryDto> {
    return CategoryDto.from(await this.categoriesService.archive(user.id, id));
  }
}
