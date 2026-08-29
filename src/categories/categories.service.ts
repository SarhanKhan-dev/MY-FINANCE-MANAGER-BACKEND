import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, TransactionType } from '@prisma/client';
import { BudgetService } from '../budget/budget.service';
import { parseDateOnly } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { transactionInclude } from '../transactions/transaction-with-refs';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly budget: BudgetService,
  ) {}

  list(userId: string): Promise<Category[]> {
    return this.prisma.category.findMany({
      where: { userId },
      orderBy: [{ archivedAt: 'asc' }, { name: 'asc' }],
    });
  }

  async create(userId: string, name: string): Promise<Category> {
    const existing = await this.prisma.category.findFirst({
      where: { userId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('This category already exists');
    }
    const category = await this.prisma.category.create({ data: { userId, name } });
    await this.events.record({
      userId,
      type: EventTypes.CATEGORY_CREATED,
      entityType: 'Category',
      entityId: category.id,
      after: { name },
    });
    return category;
  }

  async rename(userId: string, categoryId: string, name: string): Promise<Category> {
    const category = await this.findOrFail(userId, categoryId);
    const updated = await this.prisma.category.update({
      where: { id: category.id },
      data: { name },
    });
    await this.events.record({
      userId,
      type: EventTypes.CATEGORY_UPDATED,
      entityType: 'Category',
      entityId: category.id,
      before: { name: category.name },
      after: { name },
    });
    return updated;
  }

  async archive(userId: string, categoryId: string): Promise<Category> {
    const category = await this.findOrFail(userId, categoryId);
    const updated = await this.prisma.category.update({
      where: { id: category.id },
      data: { archivedAt: new Date() },
    });
    await this.events.record({
      userId,
      type: EventTypes.CATEGORY_ARCHIVED,
      entityType: 'Category',
      entityId: category.id,
      before: { name: category.name },
    });
    return updated;
  }

  async unarchive(userId: string, categoryId: string): Promise<Category> {
    const category = await this.findOrFail(userId, categoryId);
    const updated = await this.prisma.category.update({
      where: { id: category.id },
      data: { archivedAt: null },
    });
    await this.events.record({
      userId,
      type: EventTypes.CATEGORY_UPDATED,
      entityType: 'Category',
      entityId: category.id,
      after: { name: category.name, restored: true },
    });
    return updated;
  }

  /**
   * Item-aware category picture: matched money is the header amount for plain
   * entries under this category, plus item lines whose product group carries
   * the same name (one shop trip can feed many categories).
   */
  async detail(userId: string, categoryId: string) {
    const category = await this.findOrFail(userId, categoryId);
    const budget = await this.budget.current(userId);
    const cycleStart = parseDateOnly(budget.cycleStart);
    const cycleEnd = parseDateOnly(budget.cycleEnd);
    const nameLower = category.name.toLowerCase();

    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: TransactionType.EXPENSE,
        OR: [
          { categoryId: category.id },
          {
            items: {
              some: {
                product: {
                  productCategory: { name: { equals: category.name, mode: 'insensitive' } },
                },
              },
            },
          },
        ],
      },
      include: transactionInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });

    const productIds = [
      ...new Set(
        rows.flatMap((row) =>
          row.items.map((item) => item.product?.id).filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, productCategory: { select: { name: true } } },
    });
    const groupByProduct = new Map(
      products.map((product) => [product.id, product.productCategory?.name ?? null]),
    );

    let allTime = 0;
    let thisCycle = 0;
    const months = new Set<string>();
    const entries: { transaction: (typeof rows)[number]; matchedPkr: number }[] = [];
    for (const row of rows) {
      const factor =
        row.currency === 'PKR' ? 1 : row.fxRate ? Number(row.fxRate) : 0;
      let matched = 0;
      if (row.items.length === 0) {
        if (row.categoryId === category.id) matched = Number(row.amount);
      } else {
        for (const item of row.items) {
          const groupName = item.product ? groupByProduct.get(item.product.id) : null;
          if (groupName?.toLowerCase() === nameLower) matched += Number(item.lineTotal);
        }
        if (matched === 0 && row.categoryId === category.id) {
          matched = Number(row.amount);
        }
      }
      if (matched <= 0) continue;
      const pkr = matched * factor;
      allTime += pkr;
      months.add(row.date.toISOString().slice(0, 7));
      if (row.date >= cycleStart && row.date < cycleEnd) thisCycle += pkr;
      entries.push({ transaction: row, matchedPkr: Math.round(pkr * 100) / 100 });
    }

    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      id: category.id,
      name: category.name,
      archived: category.archivedAt !== null,
      spentAllTimePkr: round(allTime),
      spentThisCyclePkr: round(thisCycle),
      entryCount: entries.length,
      avgPerMonthPkr: months.size > 0 ? round(allTime / months.size) : 0,
      entries: entries.slice(0, 30),
    };
  }

  async findOrFail(userId: string, categoryId: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, userId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }
}
