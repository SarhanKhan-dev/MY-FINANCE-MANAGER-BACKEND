import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Category } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
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
