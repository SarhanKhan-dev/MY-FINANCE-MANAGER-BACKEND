import { Injectable, NotFoundException } from '@nestjs/common';
import { GoldHolding } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface GoldOverview {
  ratePkrPerGram: number | null;
  totalGrams: number;
  boughtPkr: number;
  currentValuePkr: number | null;
  gainPkr: number | null;
  holdings: {
    id: string;
    name: string;
    weightGrams: number;
    purity: string | null;
    boughtPricePkr: number;
    currentValuePkr: number | null;
    archived: boolean;
  }[];
}

@Injectable()
export class GoldService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async overview(userId: string): Promise<GoldOverview> {
    const [holdings, settings] = await Promise.all([
      this.prisma.goldHolding.findMany({
        where: { userId },
        orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.userSettings.findUnique({ where: { userId } }),
    ]);
    const rate = settings?.goldRatePkrPerGram ? Number(settings.goldRatePkrPerGram) : null;

    let totalGrams = 0;
    let bought = 0;
    for (const holding of holdings.filter((h) => !h.archivedAt)) {
      totalGrams += Number(holding.weightGrams);
      bought += Number(holding.boughtPricePkr);
    }
    const currentValue = rate === null ? null : round2(totalGrams * rate);

    return {
      ratePkrPerGram: rate,
      totalGrams: round2(totalGrams),
      boughtPkr: round2(bought),
      currentValuePkr: currentValue,
      gainPkr: currentValue === null ? null : round2(currentValue - bought),
      holdings: holdings.map((holding) => ({
        id: holding.id,
        name: holding.name,
        weightGrams: Number(holding.weightGrams),
        purity: holding.purity,
        boughtPricePkr: Number(holding.boughtPricePkr),
        currentValuePkr: rate === null ? null : round2(Number(holding.weightGrams) * rate),
        archived: holding.archivedAt !== null,
      })),
    };
  }

  /** Current PKR value of active gold — for net worth (sec 39). */
  async valuePkr(userId: string): Promise<number | null> {
    const overview = await this.overview(userId);
    if (overview.totalGrams === 0) return 0;
    return overview.currentValuePkr;
  }

  async add(
    userId: string,
    input: { name: string; weightGrams: number; purity?: string; boughtPricePkr: number },
  ): Promise<GoldHolding> {
    const holding = await this.prisma.goldHolding.create({
      data: {
        userId,
        name: input.name,
        weightGrams: input.weightGrams,
        purity: input.purity ?? null,
        boughtPricePkr: input.boughtPricePkr,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.GOLD_ADDED,
      entityType: 'GoldHolding',
      entityId: holding.id,
      after: { name: holding.name, grams: input.weightGrams },
    });
    return holding;
  }

  async update(
    userId: string,
    holdingId: string,
    changes: { name?: string; weightGrams?: number; purity?: string; boughtPricePkr?: number },
  ): Promise<GoldHolding> {
    const holding = await this.findOrFail(userId, holdingId);
    const updated = await this.prisma.goldHolding.update({
      where: { id: holding.id },
      data: changes,
    });
    await this.events.record({
      userId,
      type: EventTypes.GOLD_UPDATED,
      entityType: 'GoldHolding',
      entityId: holding.id,
      before: { grams: Number(holding.weightGrams) },
      after: { grams: Number(updated.weightGrams) },
    });
    return updated;
  }

  async setRate(userId: string, ratePkrPerGram: number): Promise<void> {
    const before = await this.prisma.userSettings.findUnique({ where: { userId } });
    await this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId, goldRatePkrPerGram: ratePkrPerGram },
      update: { goldRatePkrPerGram: ratePkrPerGram },
    });
    await this.events.record({
      userId,
      type: EventTypes.GOLD_RATE_UPDATED,
      entityType: 'UserSettings',
      before: {
        ratePkrPerGram: before?.goldRatePkrPerGram
          ? Number(before.goldRatePkrPerGram)
          : null,
      },
      after: { ratePkrPerGram },
    });
  }

  async archive(userId: string, holdingId: string): Promise<GoldHolding> {
    const holding = await this.findOrFail(userId, holdingId);
    return this.prisma.goldHolding.update({
      where: { id: holding.id },
      data: { archivedAt: new Date() },
    });
  }

  async remove(userId: string, holdingId: string): Promise<void> {
    const holding = await this.findOrFail(userId, holdingId);
    await this.prisma.goldHolding.delete({ where: { id: holding.id } });
  }

  private async findOrFail(userId: string, holdingId: string): Promise<GoldHolding> {
    const holding = await this.prisma.goldHolding.findFirst({
      where: { id: holdingId, userId },
    });
    if (!holding) {
      throw new NotFoundException('Gold holding not found');
    }
    return holding;
  }
}
