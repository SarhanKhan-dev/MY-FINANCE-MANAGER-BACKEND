import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Goal, WishlistItem } from '@prisma/client';
import { BudgetService } from '../budget/budget.service';
import { daysBetween, parseDateOnly, pktToday, toDateKey } from '../budget/cycle';
import { EventTypes } from '../events/event-types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface GoalView {
  id: string;
  name: string;
  targetPkr: number;
  savedPkr: number;
  pct: number;
  deadline: string | null;
  /** Projected finish date at the current saving pace, when computable. */
  projectedFinish: string | null;
  onTrack: boolean | null;
  archived: boolean;
}

export interface WishView {
  id: string;
  name: string;
  targetPricePkr: number;
  priority: number;
  link: string | null;
  note: string | null;
  bought: boolean;
  /** % of this cycle's cap you would be at after buying now. */
  capPctAfterBuying: number | null;
  fitsThisMonth: boolean | null;
  archived: boolean;
}

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly budget: BudgetService,
  ) {}

  async listGoals(userId: string): Promise<GoalView[]> {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      include: { contributions: { select: { amountPkr: true, date: true } } },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
    });
    const today = pktToday();

    return goals.map((goal) => {
      const saved = goal.contributions.reduce(
        (total, contribution) => total + Number(contribution.amountPkr),
        0,
      );
      const target = Number(goal.targetPkr);
      const firstDate = goal.contributions
        .map((contribution) => contribution.date)
        .sort((a, b) => a.getTime() - b.getTime())[0];

      let projectedFinish: string | null = null;
      let onTrack: boolean | null = null;
      if (saved >= target) {
        projectedFinish = toDateKey(today);
        onTrack = true;
      } else if (firstDate && saved > 0) {
        const daysElapsed = Math.max(1, daysBetween(firstDate, today) + 1);
        const pace = saved / daysElapsed;
        if (pace > 0) {
          const daysLeft = Math.ceil((target - saved) / pace);
          const finish = new Date(today.getTime() + daysLeft * 24 * 60 * 60 * 1000);
          projectedFinish = toDateKey(finish);
          onTrack = goal.deadline ? finish <= goal.deadline : null;
        }
      }

      return {
        id: goal.id,
        name: goal.name,
        targetPkr: target,
        savedPkr: round2(saved),
        pct: target > 0 ? round2(Math.min(100, (saved / target) * 100)) : 0,
        deadline: goal.deadline ? toDateKey(goal.deadline) : null,
        projectedFinish,
        onTrack,
        archived: goal.archivedAt !== null,
      };
    });
  }

  async createGoal(
    userId: string,
    input: { name: string; targetPkr: number; deadline?: string },
  ): Promise<Goal> {
    const goal = await this.prisma.goal.create({
      data: {
        userId,
        name: input.name,
        targetPkr: input.targetPkr,
        deadline: input.deadline ? parseDateOnly(input.deadline) : null,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.GOAL_CREATED,
      entityType: 'Goal',
      entityId: goal.id,
      after: { name: goal.name, target: input.targetPkr },
    });
    return goal;
  }

  async contribute(
    userId: string,
    goalId: string,
    input: { amountPkr: number; date?: string; note?: string },
  ): Promise<void> {
    const goal = await this.goalOrFail(userId, goalId);
    if (goal.archivedAt) {
      throw new BadRequestException('This goal is closed');
    }
    await this.prisma.goalContribution.create({
      data: {
        userId,
        goalId: goal.id,
        amountPkr: input.amountPkr,
        date: parseDateOnly(input.date ?? toDateKey(pktToday())),
        note: input.note?.trim() || null,
      },
    });
    await this.events.record({
      userId,
      type: EventTypes.GOAL_CONTRIBUTED,
      entityType: 'Goal',
      entityId: goal.id,
      after: { name: goal.name, amount: input.amountPkr },
    });
  }

  async archiveGoal(userId: string, goalId: string): Promise<void> {
    const goal = await this.goalOrFail(userId, goalId);
    await this.prisma.goal.update({
      where: { id: goal.id },
      data: { archivedAt: new Date() },
    });
  }

  async removeGoal(userId: string, goalId: string): Promise<void> {
    const goal = await this.goalOrFail(userId, goalId);
    const used = await this.prisma.goalContribution.count({
      where: { userId, goalId: goal.id },
    });
    if (used > 0) {
      throw new ConflictException('Has history — archive instead');
    }
    await this.prisma.goal.delete({ where: { id: goal.id } });
  }

  async listWishes(userId: string): Promise<WishView[]> {
    const [items, budget] = await Promise.all([
      this.prisma.wishlistItem.findMany({
        where: { userId },
        orderBy: [{ archivedAt: 'asc' }, { boughtAt: 'asc' }, { priority: 'asc' }],
      }),
      this.budget.current(userId),
    ]);

    return items.map((item) => {
      const price = Number(item.targetPricePkr);
      const capPct =
        budget.capPkr > 0
          ? round2(((budget.spentPkr + price) / budget.capPkr) * 100)
          : null;
      return {
        id: item.id,
        name: item.name,
        targetPricePkr: price,
        priority: item.priority,
        link: item.link,
        note: item.note,
        bought: item.boughtAt !== null,
        capPctAfterBuying: capPct,
        fitsThisMonth: capPct === null ? null : capPct <= 100,
        archived: item.archivedAt !== null,
      };
    });
  }

  async createWish(
    userId: string,
    input: { name: string; targetPricePkr: number; priority?: number; link?: string; note?: string },
  ): Promise<WishlistItem> {
    return this.prisma.wishlistItem.create({
      data: {
        userId,
        name: input.name,
        targetPricePkr: input.targetPricePkr,
        priority: input.priority ?? 2,
        link: input.link?.trim() || null,
        note: input.note?.trim() || null,
      },
    });
  }

  async markBought(userId: string, wishId: string): Promise<void> {
    const wish = await this.wishOrFail(userId, wishId);
    await this.prisma.wishlistItem.update({
      where: { id: wish.id },
      data: { boughtAt: new Date() },
    });
  }

  async removeWish(userId: string, wishId: string): Promise<void> {
    const wish = await this.wishOrFail(userId, wishId);
    await this.prisma.wishlistItem.delete({ where: { id: wish.id } });
  }

  private async goalOrFail(userId: string, goalId: string): Promise<Goal> {
    const goal = await this.prisma.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) {
      throw new NotFoundException('Goal not found');
    }
    return goal;
  }

  private async wishOrFail(userId: string, wishId: string): Promise<WishlistItem> {
    const wish = await this.prisma.wishlistItem.findFirst({ where: { id: wishId, userId } });
    if (!wish) {
      throw new NotFoundException('Wish not found');
    }
    return wish;
  }
}
