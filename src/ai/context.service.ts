import { Injectable } from '@nestjs/common';
import { CommitteesService } from '../committees/committees.service';
import { DebtsService } from '../debts/debts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { ZakatService } from '../zakat/zakat.service';
import { SnapshotsService } from './snapshots.service';

/** Assembles the compact brief the model reasons over, with every person and
 *  shop name swapped for a token before anything leaves the server. */

export interface AiContext {
  brief: string;
  /** token -> real name, applied to the model's output before display */
  reveal: Map<string, string>;
}

@Injectable()
export class ContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly committees: CommitteesService,
    private readonly zakat: ZakatService,
    private readonly snapshots: SnapshotsService,
    private readonly debts: DebtsService,
  ) {}

  async build(userId: string): Promise<AiContext> {
    const [people, merchants] = await Promise.all([
      this.prisma.person.findMany({ where: { userId }, select: { id: true, name: true } }),
      this.prisma.merchant.findMany({ where: { userId }, select: { id: true, name: true } }),
    ]);

    const personToken = new Map<string, string>();
    const shopToken = new Map<string, string>();
    const reveal = new Map<string, string>();
    people.forEach((person, index) => {
      const token = `Person-${index + 1}`;
      personToken.set(person.id, token);
      reveal.set(token, person.name);
    });
    merchants.forEach((merchant, index) => {
      const token = `Shop-${index + 1}`;
      shopToken.set(merchant.id, token);
      reveal.set(token, merchant.name);
    });
    const byName = new Map<string, string>();
    for (const [token, name] of reveal) byName.set(name, token);
    const mask = (name: string) => byName.get(name) ?? name;

    const [overview, charts, committees, zakatView, snapshotRows, debtsSummary, notes, recent] =
      await Promise.all([
        this.reports.overview(userId),
        this.reports.charts(userId),
        this.committees.list(userId),
        this.zakat.view(userId),
        this.snapshots.list(userId),
        this.debts.summary(userId),
        this.prisma.aiMemoryNote.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.transaction.findMany({
          where: { userId },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          take: 50,
          select: {
            date: true,
            type: true,
            amount: true,
            currency: true,
            note: true,
            category: { select: { name: true } },
            merchant: { select: { id: true } },
            person: { select: { id: true } },
          },
        }),
      ]);

    const brief = {
      today: new Date().toISOString().slice(0, 10),
      budget: overview.budget,
      wallets: overview.wallets
        .filter((wallet) => !wallet.archived)
        .map((wallet) => ({
          name: wallet.name,
          currency: wallet.currency,
          balance: wallet.balance,
        })),
      totals: overview.totals,
      debts: {
        summary: overview.debts,
        people: debtsSummary.people.map((row) => ({
          person: personToken.get(row.personId) ?? 'Person-?',
          iOwePkr: row.iOwePkr,
          owedToMePkr: row.owedToMePkr,
          iOweUsd: row.iOweUsd,
          owedToMeUsd: row.owedToMeUsd,
        })),
      },
      thisCycleCategories: overview.categoryLeaders,
      sixMonthFlow: charts.months,
      topShops: charts.topShops.map((row) => ({ ...row, name: mask(row.name) })),
      topProducts: charts.topProducts,
      committees: committees
        .filter((committee) => !committee.archived)
        .map((committee) => ({
          name: committee.name,
          organizer: personToken.get(committee.organizerId) ?? 'Person-?',
          installmentPkr: committee.installmentPkr,
          paid: committee.paidCount,
          totalMembers: committee.totalMembers,
          overdue: committee.overdueCount,
          nextUnpaid: committee.nextUnpaidMonth,
          payoutReceived: committee.payoutReceived,
        })),
      zakat: { zakatablePkr: (zakatView as { zakatablePkr?: number }).zakatablePkr, duePkr: zakatView.duePkr, nisabPkr: zakatView.nisabPkr },
      monthlySnapshots: snapshotRows.slice(0, 12).map((row) => ({
        cycle: row.cycleKey,
        ...row.data,
        topShops: row.data.topShops.map((shop) => ({ ...shop, name: mask(shop.name) })),
      })),
      patternProgress: this.snapshots.progress(snapshotRows),
      memoryNotes: notes.map((note) => note.note),
      recentEntries: recent.map((entry) => ({
        date: entry.date.toISOString().slice(0, 10),
        type: entry.type,
        amount: Number(entry.amount),
        currency: entry.currency,
        category: entry.category?.name ?? null,
        shop: entry.merchant ? (shopToken.get(entry.merchant.id) ?? null) : null,
        person: entry.person ? (personToken.get(entry.person.id) ?? null) : null,
        note: entry.note ? this.maskFreeText(entry.note, reveal) : null,
      })),
      peopleRoster: people.map((person) => personToken.get(person.id)),
    };

    return { brief: JSON.stringify(brief), reveal };
  }

  /** Replace any real names that appear inside free text (notes, replies). */
  maskFreeText(text: string, reveal: Map<string, string>): string {
    let output = text;
    const pairs = [...reveal.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [token, name] of pairs) {
      if (name.length < 3) continue;
      output = output.split(name).join(token);
    }
    return output;
  }

  /** Swap tokens back to real names before anything reaches the user. */
  deanonymize(text: string, reveal: Map<string, string>): string {
    let output = text;
    for (const [token, name] of reveal) {
      output = output.split(token).join(name);
    }
    return output;
  }
}
