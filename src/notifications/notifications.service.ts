import { Injectable } from '@nestjs/common';
import { BudgetService } from '../budget/budget.service';
import { CommitteesService } from '../committees/committees.service';
import { DebtsService } from '../debts/debts.service';
import { ZakatService } from '../zakat/zakat.service';

export type NotificationSeverity = 'info' | 'warn' | 'alert';
export type NotificationKind = 'DEBT_OWE' | 'DEBT_OWED' | 'BUDGET' | 'COMMITTEE' | 'ZAKAT';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string;
}

export interface NotificationsView {
  items: NotificationItem[];
}

const SEVERITY_ORDER: Record<NotificationSeverity, number> = { alert: 0, warn: 1, info: 2 };

const rupees = (value: number) => `Rs ${Math.round(value).toLocaleString('en-PK')}`;
const dollars = (value: number) =>
  `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// Nothing is stored: notifications are derived live from the ledger, so they
// appear and disappear with the entries themselves and can never go stale.
@Injectable()
export class NotificationsService {
  constructor(
    private readonly debts: DebtsService,
    private readonly budget: BudgetService,
    private readonly committees: CommitteesService,
    private readonly zakat: ZakatService,
  ) {}

  async view(userId: string): Promise<NotificationsView> {
    const [debts, budget, committees, zakat] = await Promise.all([
      this.debts.summary(userId),
      this.budget.current(userId),
      this.committees.list(userId),
      this.zakat.view(userId),
    ]);

    const items: NotificationItem[] = [];

    for (const committee of committees) {
      if (committee.archived) continue;
      if (committee.overdueCount > 0) {
        items.push({
          id: `committee-overdue:${committee.id}`,
          kind: 'COMMITTEE',
          severity: 'alert',
          title: `${committee.name}: ${committee.overdueCount} month${committee.overdueCount > 1 ? 's' : ''} overdue`,
          body: `${rupees(committee.installmentPkr)} per month is pending.`,
          href: '/committees',
        });
      } else if (committee.months.some((month) => month.status === 'CURRENT')) {
        items.push({
          id: `committee-due:${committee.id}:${committee.nextUnpaidMonth ?? ''}`,
          kind: 'COMMITTEE',
          severity: 'warn',
          title: `${committee.name}: this month is due`,
          body: `${rupees(committee.installmentPkr)} installment.`,
          href: '/committees',
        });
      }
    }

    if (budget.capPkr > 0) {
      if (budget.pct >= 100) {
        items.push({
          id: 'budget:over',
          kind: 'BUDGET',
          severity: 'alert',
          title: 'Over the monthly cap',
          body: `Spent ${rupees(budget.spentPkr)} of ${rupees(budget.capPkr)}.`,
          href: '/overview',
        });
      } else if (budget.pct >= 80) {
        items.push({
          id: 'budget:80',
          kind: 'BUDGET',
          severity: 'warn',
          title: `${Math.floor(budget.pct)}% of the cap used`,
          body: `${rupees(budget.remainingPkr)} left until ${budget.cycleEnd}.`,
          href: '/overview',
        });
      }
    }

    for (const person of debts.people) {
      if (person.iOwePkr > 0) {
        items.push({
          id: `debt-owe:${person.personId}`,
          kind: 'DEBT_OWE',
          severity: 'warn',
          title: `You owe ${person.name} ${rupees(person.iOwePkr)}`,
          body: 'Repay or balance out from their page.',
          href: `/people/${person.personId}`,
        });
      }
      if (person.iOweUsd > 0) {
        items.push({
          id: `debt-owe-usd:${person.personId}`,
          kind: 'DEBT_OWE',
          severity: 'warn',
          title: `You owe ${person.name} ${dollars(person.iOweUsd)}`,
          body: 'A dollar debt stays in dollars until repaid.',
          href: `/people/${person.personId}`,
        });
      }
      if (person.owedToMePkr > 0) {
        items.push({
          id: `debt-owed:${person.personId}`,
          kind: 'DEBT_OWED',
          severity: 'info',
          title: `${person.name} owes you ${rupees(person.owedToMePkr)}`,
          body: 'Waiting in their ledger.',
          href: `/people/${person.personId}`,
        });
      }
      if (person.owedToMeUsd > 0) {
        items.push({
          id: `debt-owed-usd:${person.personId}`,
          kind: 'DEBT_OWED',
          severity: 'info',
          title: `${person.name} owes you ${dollars(person.owedToMeUsd)}`,
          body: 'Waiting in their ledger, in dollars.',
          href: `/people/${person.personId}`,
        });
      }
    }

    if (zakat.duePkr !== null && zakat.duePkr > 0) {
      items.push({
        id: 'zakat:due',
        kind: 'ZAKAT',
        severity: 'info',
        title: `Zakat works out to ${rupees(zakat.duePkr)}`,
        body: 'Based on live nisab and what you hold.',
        href: '/zakat',
      });
    }

    items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return { items };
  }
}
