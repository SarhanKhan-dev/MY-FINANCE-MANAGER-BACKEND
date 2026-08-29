import { Prisma, UserSettings } from '@prisma/client';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;

  const tx = {
    userSettings: { update: jest.fn() },
    user: { updateMany: jest.fn() },
  };

  const prisma = {
    userSettings: { upsert: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const events = { record: jest.fn() };

  const settings = (overrides: Partial<UserSettings> = {}): UserSettings => ({
    id: 's1',
    userId: 'u1',
    budgetCapPkr: new Prisma.Decimal(100000),
    budgetCycleStartDay: 1,
    countLendingInCap: false,
    countWriteOffsInCap: true,
    countCommitteesInCap: false,
    goldRatePkrPerGram: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SettingsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsService,
    );
  });

  describe('get', () => {
    it('creates default settings on first read and returns them', async () => {
      prisma.userSettings.upsert.mockResolvedValue(settings());

      const result = await service.get('u1');

      expect(prisma.userSettings.upsert).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        create: { userId: 'u1' },
        update: {},
      });
      expect(result.budgetCycleStartDay).toBe(1);
    });
  });

  describe('update', () => {
    it('updates the cap and records a SETTINGS_CHANGED event with before and after', async () => {
      prisma.userSettings.upsert.mockResolvedValue(settings());
      prisma.userSettings.update.mockResolvedValue(
        settings({ budgetCapPkr: new Prisma.Decimal(150000), budgetCycleStartDay: 5 }),
      );

      await service.update('u1', { budgetCapPkr: 150000, budgetCycleStartDay: 5 });

      expect(prisma.userSettings.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { budgetCapPkr: 150000, budgetCycleStartDay: 5 },
      });
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          type: EventTypes.SETTINGS_CHANGED,
          before: expect.objectContaining({ budgetCapPkr: '100000', budgetCycleStartDay: 1 }),
          after: expect.objectContaining({ budgetCapPkr: '150000', budgetCycleStartDay: 5 }),
        }),
      );
    });
  });

  describe('completeOnboarding', () => {
    it('saves the chosen cap and cycle day and stamps onboardedAt only when unset', async () => {
      tx.userSettings.update.mockResolvedValue(
        settings({ budgetCapPkr: new Prisma.Decimal(80000), budgetCycleStartDay: 5 }),
      );

      await service.completeOnboarding('u1', { budgetCapPkr: 80000, budgetCycleStartDay: 5 });

      expect(tx.userSettings.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { budgetCapPkr: 80000, budgetCycleStartDay: 5 },
      });
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', onboardedAt: null },
        data: { onboardedAt: expect.any(Date) },
      });
      expect(events.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: EventTypes.USER_ONBOARDED }),
      );
    });

    it('can run twice without clobbering the first onboarding date', async () => {
      tx.userSettings.update.mockResolvedValue(settings());

      await service.completeOnboarding('u1', { budgetCapPkr: 100000, budgetCycleStartDay: 1 });
      await service.completeOnboarding('u1', { budgetCapPkr: 100000, budgetCycleStartDay: 1 });

      for (const call of tx.user.updateMany.mock.calls) {
        expect(call[0].where).toEqual({ id: 'u1', onboardedAt: null });
      }
    });
  });
});
