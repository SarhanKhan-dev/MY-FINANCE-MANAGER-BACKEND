import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SafeUser } from '../common/types/safe-user';
import { ProductsService, ProductStats } from './products.service';

class CreateProductDto {
  @ApiProperty({ example: 'Milk', minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  name: string;

  @ApiPropertyOptional({ example: 'liter' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productCategoryId?: string;
}

class UpdateProductDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 20)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productCategoryId?: string;
}

class NameDto {
  @ApiProperty({ example: 'Vegetables', minLength: 1, maxLength: 40 })
  @IsString()
  @Length(1, 40)
  name: string;
}

class ProductStatsDto implements ProductStats {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() unit: string;
  @ApiProperty({ type: String, nullable: true }) categoryName: string | null;
  @ApiProperty() totalSpentPkr: number;
  @ApiProperty() totalQty: number;
  @ApiProperty({ type: Number, nullable: true }) avgPricePkr: number | null;
  @ApiProperty({ type: Number, nullable: true }) lastPricePkr: number | null;
  @ApiProperty({ type: Number, nullable: true }) prevPricePkr: number | null;
  @ApiProperty() archived: boolean;
}

class ProductPurchaseDto {
  @ApiProperty() date: string;
  @ApiProperty() quantity: number;
  @ApiProperty() unitPricePkr: number;
  @ApiProperty({ type: String, nullable: true }) shop: string | null;
}

class ProductShopDto {
  @ApiProperty() name: string;
  @ApiProperty({ type: Number, nullable: true }) avgPricePkr: number | null;
  @ApiProperty() totalQty: number;
}

class ProductDetailDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() unit: string;
  @ApiProperty() totalSpentPkr: number;
  @ApiProperty() totalQty: number;
  @ApiProperty({ type: Number, nullable: true }) avgPricePkr: number | null;
  @ApiProperty({ type: ProductPurchaseDto, isArray: true }) purchases: ProductPurchaseDto[];
  @ApiProperty({ type: ProductShopDto, isArray: true }) shops: ProductShopDto[];
}

class ShoppingSummaryDto {
  @ApiProperty() shoppingSpentPkr: number;
  @ApiProperty() itemsQty: number;
  @ApiProperty() productsTracked: number;
  @ApiProperty({ type: String, nullable: true }) topProduct: string | null;
}

class ProductCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

class ProductDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() unit: string;
}

@ApiTags('products')
@ApiBearerAuth()
@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('products')
  @ApiOkResponse({ type: ProductStatsDto, isArray: true })
  list(@CurrentUser() user: SafeUser): Promise<ProductStatsDto[]> {
    return this.productsService.listWithStats(user.id);
  }

  @Get('products/summary')
  @ApiOkResponse({ type: ShoppingSummaryDto })
  summary(@CurrentUser() user: SafeUser): Promise<ShoppingSummaryDto> {
    return this.productsService.summary(user.id);
  }

  @Get('products/:id')
  @ApiOkResponse({ type: ProductDetailDto })
  detail(@CurrentUser() user: SafeUser, @Param('id') id: string): Promise<ProductDetailDto> {
    return this.productsService.detail(user.id, id);
  }

  @Post('products')
  @ApiOkResponse({ type: ProductDto })
  async create(@CurrentUser() user: SafeUser, @Body() dto: CreateProductDto): Promise<ProductDto> {
    const product = await this.productsService.create(
      user.id,
      dto.name,
      dto.unit,
      dto.productCategoryId,
    );
    return { id: product.id, name: product.name, unit: product.unit };
  }

  @Patch('products/:id')
  @ApiOkResponse({ type: ProductDto })
  async update(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDto> {
    const product = await this.productsService.update(user.id, id, dto);
    return { id: product.id, name: product.name, unit: product.unit };
  }

  @Post('products/:id/archive')
  @HttpCode(200)
  async archive(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.productsService.archive(user.id, id);
    return { ok: true };
  }

  @Delete('products/:id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.productsService.remove(user.id, id);
    return { ok: true };
  }

  @Get('product-categories')
  @ApiOkResponse({ type: ProductCategoryDto, isArray: true })
  async listCategories(@CurrentUser() user: SafeUser): Promise<ProductCategoryDto[]> {
    const categories = await this.productsService.listCategories(user.id);
    return categories.map((category) => ({ id: category.id, name: category.name }));
  }

  @Post('product-categories')
  @ApiOkResponse({ type: ProductCategoryDto })
  async createCategory(
    @CurrentUser() user: SafeUser,
    @Body() dto: NameDto,
  ): Promise<ProductCategoryDto> {
    const category = await this.productsService.createCategory(user.id, dto.name);
    return { id: category.id, name: category.name };
  }
}
