import { describe, expect, it } from 'vitest';
import { overviewBins, proteinTicks } from '../overviewBins';

describe('protein overview density', () => {
  it('preserves every in-range record and position at both small and large widths', () => {
    const records = Array.from({ length: 1500 }, (_, i) => ({ pos: i + 1, variants: i % 7 }));
    records.push({ pos: 205, variants: 10 });
    for (const width of [320, 900, 1800]) {
      const { bins } = overviewBins([...records, { pos: 0, variants: 5 }, { pos: 1501, variants: 5 }], 1500, width);
      expect(bins.flatMap(b => b.items)).toHaveLength(1501);
      expect(bins.flatMap(b => b.items).reduce((n, g) => n + g.variants, 0)).toBe(records.reduce((n, g) => n + g.variants, 0));
      expect(bins.every(b => b.items.every(g => g.pos >= b.start && g.pos <= b.end))).toBe(true);
      expect(bins.at(-1)!.end).toBe(1500);
    }
  });

  it('keeps individual residues when they fit and marks both protein ends', () => {
    expect(overviewBins([{ pos: 5 }, { pos: 5 }, { pos: 6 }], 154, 5000).size).toBe(1);
    expect(overviewBins([], 1500, 0).bins).toEqual([]);
    for (const length of [1, 3, 154, 1500]) {
      const ticks = proteinTicks(length);
      expect(ticks[0]).toBe(1);
      expect(ticks.at(-1)).toBe(length);
      expect(new Set(ticks).size).toBe(ticks.length);
    }
  });
});
