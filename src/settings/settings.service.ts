import { Injectable } from '@nestjs/common';
import { UserSettings } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  async get(userId: string): Promise<UserSettings> {
    return this.prisma.userSettings.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async update(userId: string, dto: UpdateSettingsDto): Promise<UserSettings> {
    const before = await this.get(userId);
    const updated = await this.prisma.userSettings.update({
      where: { userId },
      data: {
        budgetCapPkr: dto.budgetCapPkr,
        budgetCycleStartDay: dto.budgetCycleStartDay,
      },
    });

    await this.events.record({
      userId,
      type: EventTypes.SETTINGS_CHANGED,
      entityType: 'UserSettings',
      entityId: updated.id,
      before: {
        budgetCapPkr: before.budgetCapPkr.toString(),
        budgetCycleStartDay: before.budgetCycleStartDay,
      },
      after: {
        budgetCapPkr: updated.budgetCapPkr.toString(),
        budgetCycleStartDay: updated.budgetCycleStartDay,
      },
    });

    return updated;
  }

  async completeOnboarding(userId: string, dto: OnboardingDto): Promise<UserSettings> {
    const settings = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userSettings.update({
        where: { userId },
        data: {
          budgetCapPkr: dto.budgetCapPkr,
          budgetCycleStartDay: dto.budgetCycleStartDay,
        },
      });
      await tx.user.updateMany({
        where: { id: userId, onboardedAt: null },
        data: { onboardedAt: new Date() },
      });
      return updated;
    });

    await this.events.record({
      userId,
      type: EventTypes.USER_ONBOARDED,
      entityType: 'UserSettings',
      entityId: settings.id,
      after: {
        budgetCapPkr: settings.budgetCapPkr.toString(),
        budgetCycleStartDay: settings.budgetCycleStartDay,
      },
    });

    return settings;
  }
}
