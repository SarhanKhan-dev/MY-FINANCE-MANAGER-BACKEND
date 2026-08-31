import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const debts = { summary: jest.fn() };
  const budget = { current: jest.fn() };
  const committees = { list: jest.fn() };
  const zakat = { view: jest.fn() };

  const service = new NotificationsService(
    debts as never,
    budget as never,
    committees as never,
    zakat as never,
  );

  const quietBudget = {
    cycleStart: '2026-08-15',
    cycleEnd: '2026-09-14',
    capPkr: 100000,
    spentPkr: 10000,
    remainingPkr: 90000,
    pct: 10,
    daysLeft: 20,
    dailyPacePkr: 500,
    safePacePkr: 4500,
  };

  beforeEach(() => {
    debts.summary.mockResolvedValue({ iOwePkr: 0, owedToMePkr: 0, people: [] });
    budget.current.mockResolvedValue(quietBudget);
    committees.list.mockResolvedValue([]);
    zakat.view.mockResolvedValue({ duePkr: null });
  });

  it('returns no items when everything is quiet', async () => {
    const view = await service.view('u1');
    expect(view.items).toEqual([]);
  });

  it('derives debt reminders both ways', async () => {
    debts.summary.mockResolvedValue({
      iOwePkr: 5000,
      owedToMePkr: 2000,
      people: [
        { personId: 'p1', name: 'Ali', iOwePkr: 5000, owedToMePkr: 0 },
        { personId: 'p2', name: 'Sara', iOwePkr: 0, owedToMePkr: 2000 },
      ],
    });
    const view = await service.view('u1');
    const ids = view.items.map((item) => item.id);
    expect(ids).toContain('debt-owe:p1');
    expect(ids).toContain('debt-owed:p2');
    const owe = view.items.find((item) => item.id === 'debt-owe:p1');
    expect(owe?.title).toBe('You owe Ali Rs 5,000');
    expect(owe?.href).toBe('/people/p1');
  });

  it('flags the budget at 80% and over the cap', async () => {
    budget.current.mockResolvedValue({ ...quietBudget, spentPkr: 85000, remainingPkr: 15000, pct: 85 });
    let view = await service.view('u1');
    expect(view.items.some((item) => item.id === 'budget:80')).toBe(true);

    budget.current.mockResolvedValue({ ...quietBudget, spentPkr: 120000, remainingPkr: -20000, pct: 120 });
    view = await service.view('u1');
    expect(view.items.some((item) => item.id === 'budget:over')).toBe(true);
  });

  it('surfaces committee months and sorts alerts first', async () => {
    debts.summary.mockResolvedValue({
      iOwePkr: 0,
      owedToMePkr: 100,
      people: [{ personId: 'p2', name: 'Sara', iOwePkr: 0, owedToMePkr: 100 }],
    });
    committees.list.mockResolvedValue([
      {
        id: 'c1',
        name: 'Office committee',
        archived: false,
        overdueCount: 2,
        installmentPkr: 10000,
        months: [],
        nextUnpaidMonth: '2026-07-01',
      },
      {
        id: 'c2',
        name: 'Family committee',
        archived: false,
        overdueCount: 0,
        installmentPkr: 5000,
        months: [{ monthKey: '2026-08-01', turn: 1, isMine: false, status: 'CURRENT' }],
        nextUnpaidMonth: '2026-08-01',
      },
      {
        id: 'c3',
        name: 'Old committee',
        archived: true,
        overdueCount: 5,
        installmentPkr: 1000,
        months: [],
        nextUnpaidMonth: null,
      },
    ]);
    const view = await service.view('u1');
    const ids = view.items.map((item) => item.id);
    expect(ids[0]).toBe('committee-overdue:c1');
    expect(ids).toContain('committee-due:c2:2026-08-01');
    expect(ids.some((id) => id.includes('c3'))).toBe(false);
    expect(ids.indexOf('debt-owed:p2')).toBeGreaterThan(ids.indexOf('committee-due:c2:2026-08-01'));
  });

  it('mentions zakat only when something is due', async () => {
    zakat.view.mockResolvedValue({ duePkr: 12850 });
    const view = await service.view('u1');
    const item = view.items.find((entry) => entry.id === 'zakat:due');
    expect(item?.title).toBe('Zakat works out to Rs 12,850');
  });
});
