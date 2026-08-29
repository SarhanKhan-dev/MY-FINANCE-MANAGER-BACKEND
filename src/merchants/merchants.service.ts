import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Merchant } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  list(userId: string): Promise<Merchant[]> {
    return this.prisma.merchant.findMany({
      where: { userId, archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, name: string): Promise<Merchant> {
    const existing = await this.prisma.merchant.findFirst({
      where: { userId, name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('This shop already exists');
    }
    const merchant = await this.prisma.merchant.create({ data: { userId, name } });
    await this.events.record({
      userId,
      type: EventTypes.MERCHANT_CREATED,
      entityType: 'Merchant',
      entityId: merchant.id,
      after: { name },
    });
    return merchant;
  }

  /** Hard delete is only for shops with no history — otherwise archive (sec 46). */
  async remove(userId: string, merchantId: string): Promise<void> {
    const merchant = await this.findOrFail(userId, merchantId);
    const used = await this.prisma.transaction.count({
      where: { userId, merchantId: merchant.id },
    });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.merchant.delete({ where: { id: merchant.id } });
  }

  async archive(userId: string, merchantId: string): Promise<Merchant> {
    const merchant = await this.findOrFail(userId, merchantId);
    return this.prisma.merchant.update({
      where: { id: merchant.id },
      data: { archivedAt: new Date() },
    });
  }

  async findOrFail(userId: string, merchantId: string): Promise<Merchant> {
    const merchant = await this.prisma.merchant.findFirst({
      where: { id: merchantId, userId },
    });
    if (!merchant) {
      throw new NotFoundException('Shop not found');
    }
    return merchant;
  }
}
