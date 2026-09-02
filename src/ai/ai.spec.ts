import { ContextService } from './context.service';
import { SnapshotRow, SnapshotsService } from './snapshots.service';

describe('AI companion pieces', () => {
  describe('anonymizer', () => {
    const service = new ContextService(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
    );
    const reveal = new Map<string, string>([
      ['Person-1', 'Tehmina Nisar'],
      ['Person-2', 'Ali'],
      ['Shop-1', 'Bacha Shop'],
    ]);

    it('masks real names in free text before they leave the server', () => {
      const masked = service.maskFreeText('Paid Tehmina Nisar at Bacha Shop with Ali', reveal);
      expect(masked).toBe('Paid Person-1 at Shop-1 with Person-2');
    });

    it('reveals tokens back into real names for display', () => {
      const revealed = service.deanonymize(
        'Aap ko Person-1 ko $800 dene hain. Shop-1 se kam kharido.',
        reveal,
      );
      expect(revealed).toBe('Aap ko Tehmina Nisar ko $800 dene hain. Bacha Shop se kam kharido.');
    });

    it('round-trips cleanly', () => {
      const original = 'Tehmina Nisar owes visits to Bacha Shop';
      const there = service.maskFreeText(original, reveal);
      expect(service.deanonymize(there, reveal)).toBe(original);
    });
  });

  describe('pattern progress', () => {
    const service = new SnapshotsService(null as never, null as never);
    const row = (cycleKey: string, spentPkr: number, dining: number): SnapshotRow => ({
      cycleKey,
      cycleEnd: cycleKey,
      report: null,
      data: {
        incomePkr: 100000,
        incomeUsd: 0,
        spentPkr,
        spentUsd: 0,
        savingsPkr: 100000 - spentPkr,
        capPkr: 100000,
        capUsedPct: spentPkr / 1000,
        categories: [{ name: 'Dining out', spentPkr: dining }],
        topShops: [],
        debtsEnd: { iOwePkr: 0, owedToMePkr: 0, iOweUsd: 0, owedToMeUsd: 0 },
        entries: 10,
      },
    });

    it('computes 3-month deltas deterministically', () => {
      const rows = [
        row('2026-08-15', 60000, 8000),
        row('2026-07-15', 70000, 10000),
        row('2026-06-15', 80000, 12000),
        row('2026-05-15', 90000, 14000),
      ];
      const progress = service.progress(rows) as {
        vs3Months: { spentDeltaPkr: number; biggestCategoryMoves: { deltaPkr: number }[] };
        vs6Months: unknown;
      };
      expect(progress.vs3Months.spentDeltaPkr).toBe(-30000);
      expect(progress.vs3Months.biggestCategoryMoves[0].deltaPkr).toBe(-6000);
      expect(progress.vs6Months).toBeNull();
    });

    it('returns empty for no history', () => {
      expect(service.progress([])).toEqual({});
    });
  });
});
