import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Currency, Prisma, Product, ProductCategory } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

export interface ProductStats {
  id: string;
  name: string;
  unit: string;
  categoryName: string | null;
  totalSpentPkr: number;
  totalQty: number;
  avgPricePkr: number | null;
  lastPricePkr: number | null;
  prevPricePkr: number | null;
  archived: boolean;
}

const round = (value: number) => Math.round(value * 100) / 100;

type ItemRow = {
  productId: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  transaction: {
    date: Date;
    currency: Currency;
    fxRate: Prisma.Decimal | null;
    merchantId: string | null;
    merchant: { name: string } | null;
  };
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  private pkrFactor(currency: Currency, fxRate: Prisma.Decimal | null): number {
    return currency === Currency.PKR ? 1 : fxRate ? Number(fxRate) : 0;
  }

  private itemRows(userId: string, productId?: string): Promise<ItemRow[]> {
    return this.prisma.transactionItem.findMany({
      where: { userId, ...(productId ? { productId } : {}) },
      select: {
        productId: true,
        quantity: true,
        unitPrice: true,
        lineTotal: true,
        transaction: {
          select: {
            date: true,
            currency: true,
            fxRate: true,
            merchantId: true,
            merchant: { select: { name: true } },
          },
        },
      },
    });
  }

  async listWithStats(userId: string): Promise<ProductStats[]> {
    const [products, items] = await Promise.all([
      this.prisma.product.findMany({
        where: { userId },
        include: { productCategory: { select: { name: true } } },
        orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
      }),
      this.itemRows(userId),
    ]);

    const byProduct = new Map<string, ItemRow[]>();
    for (const item of items) {
      if (!item.productId) continue;
      const list = byProduct.get(item.productId) ?? [];
      list.push(item);
      byProduct.set(item.productId, list);
    }

    return products.map((product) => {
      const rows = (byProduct.get(product.id) ?? []).sort(
        (a, b) => a.transaction.date.getTime() - b.transaction.date.getTime(),
      );
      let spent = 0;
      let qty = 0;
      for (const row of rows) {
        const factor = this.pkrFactor(row.transaction.currency, row.transaction.fxRate);
        spent += Number(row.lineTotal) * factor;
        qty += Number(row.quantity);
      }
      const priced = rows.filter(
        (row) => this.pkrFactor(row.transaction.currency, row.transaction.fxRate) > 0,
      );
      const last = priced.at(-1);
      const prev = priced.at(-2);
      return {
        id: product.id,
        name: product.name,
        unit: product.unit,
        categoryName: product.productCategory?.name ?? null,
        totalSpentPkr: round(spent),
        totalQty: round(qty),
        avgPricePkr: qty > 0 ? round(spent / qty) : null,
        lastPricePkr: last
          ? round(
              Number(last.unitPrice) *
                this.pkrFactor(last.transaction.currency, last.transaction.fxRate),
            )
          : null,
        prevPricePkr: prev
          ? round(
              Number(prev.unitPrice) *
                this.pkrFactor(prev.transaction.currency, prev.transaction.fxRate),
            )
          : null,
        archived: product.archivedAt !== null,
      };
    });
  }

  async detail(userId: string, productId: string) {
    const product = await this.findOrFail(userId, productId);
    const rows = (await this.itemRows(userId, productId)).sort(
      (a, b) => b.transaction.date.getTime() - a.transaction.date.getTime(),
    );

    let spent = 0;
    let qty = 0;
    const perShop = new Map<string, { name: string; spent: number; qty: number }>();
    const purchases = rows.map((row) => {
      const factor = this.pkrFactor(row.transaction.currency, row.transaction.fxRate);
      const linePkr = Number(row.lineTotal) * factor;
      spent += linePkr;
      qty += Number(row.quantity);
      const shopName = row.transaction.merchant?.name ?? null;
      if (shopName) {
        const key = row.transaction.merchantId as string;
        const shop = perShop.get(key) ?? { name: shopName, spent: 0, qty: 0 };
        shop.spent += linePkr;
        shop.qty += Number(row.quantity);
        perShop.set(key, shop);
      }
      return {
        date: row.transaction.date.toISOString().slice(0, 10),
        quantity: Number(row.quantity),
        unitPricePkr: round(Number(row.unitPrice) * factor),
        shop: shopName,
      };
    });

    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
      totalSpentPkr: round(spent),
      totalQty: round(qty),
      avgPricePkr: qty > 0 ? round(spent / qty) : null,
      purchases,
      shops: Array.from(perShop.values())
        .map((shop) => ({
          name: shop.name,
          avgPricePkr: shop.qty > 0 ? round(shop.spent / shop.qty) : null,
          totalQty: round(shop.qty),
        }))
        .sort((a, b) => (a.avgPricePkr ?? 0) - (b.avgPricePkr ?? 0)),
    };
  }

  async summary(userId: string) {
    const items = await this.itemRows(userId);
    const productCount = await this.prisma.product.count({
      where: { userId, archivedAt: null },
    });

    let spent = 0;
    let qty = 0;
    const spendByProduct = new Map<string, number>();
    for (const item of items) {
      const factor = this.pkrFactor(item.transaction.currency, item.transaction.fxRate);
      spent += Number(item.lineTotal) * factor;
      qty += Number(item.quantity);
      if (item.productId) {
        spendByProduct.set(
          item.productId,
          (spendByProduct.get(item.productId) ?? 0) + Number(item.lineTotal) * factor,
        );
      }
    }
    let topProduct: string | null = null;
    if (spendByProduct.size > 0) {
      const [topId] = Array.from(spendByProduct.entries()).sort((a, b) => b[1] - a[1])[0];
      const product = await this.prisma.product.findUnique({ where: { id: topId } });
      topProduct = product?.name ?? null;
    }
    return {
      shoppingSpentPkr: round(spent),
      itemsQty: round(qty),
      productsTracked: productCount,
      topProduct,
    };
  }

  async create(
    userId: string,
    name: string,
    unit?: string,
    productCategoryId?: string,
  ): Promise<Product> {
    const existing = await this.prisma.product.findFirst({
      where: { userId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(`"${existing.name}" already exists`);
    }
    if (productCategoryId) {
      await this.categoryOrFail(userId, productCategoryId);
    }
    const product = await this.prisma.product.create({
      data: { userId, name, unit: unit || 'piece', productCategoryId },
    });
    await this.events.record({
      userId,
      type: EventTypes.PRODUCT_CREATED,
      entityType: 'Product',
      entityId: product.id,
      after: { name, unit: product.unit },
    });
    return product;
  }

  async update(
    userId: string,
    productId: string,
    changes: { name?: string; unit?: string; productCategoryId?: string | null },
  ): Promise<Product> {
    const product = await this.findOrFail(userId, productId);
    if (changes.productCategoryId) {
      await this.categoryOrFail(userId, changes.productCategoryId);
    }
    return this.prisma.product.update({ where: { id: product.id }, data: changes });
  }

  async archive(userId: string, productId: string): Promise<Product> {
    const product = await this.findOrFail(userId, productId);
    return this.prisma.product.update({
      where: { id: product.id },
      data: { archivedAt: new Date() },
    });
  }

  /** Hard delete is only for products never bought — otherwise archive (sec 46). */
  async remove(userId: string, productId: string): Promise<void> {
    const product = await this.findOrFail(userId, productId);
    const used = await this.prisma.transactionItem.count({
      where: { userId, productId: product.id },
    });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.product.delete({ where: { id: product.id } });
  }

  async findOrFail(userId: string, productId: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, userId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  listCategories(userId: string): Promise<ProductCategory[]> {
    return this.prisma.productCategory.findMany({
      where: { userId, archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(userId: string, name: string): Promise<ProductCategory> {
    const existing = await this.prisma.productCategory.findFirst({
      where: { userId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException(`"${existing.name}" already exists`);
    }
    return this.prisma.productCategory.create({ data: { userId, name } });
  }

  private async categoryOrFail(userId: string, id: string): Promise<ProductCategory> {
    const category = await this.prisma.productCategory.findFirst({ where: { id, userId } });
    if (!category) {
      throw new NotFoundException('Product category not found');
    }
    return category;
  }
}
