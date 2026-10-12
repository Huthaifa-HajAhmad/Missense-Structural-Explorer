import { describe, expect, it } from 'vitest';
import { literatureCoverage } from '../reviewPresentation';
import { buildLiteratureEvidence } from '../literatureEvidence';

describe('loaded literature coverage', () => {
  it('partitions the loaded set, including curated additions, rather than remote hits', () => {
    const evidence = buildLiteratureEvidence({ gene: 'NAE1', variant: 'p.Asp116Gly', citations: [
      { id: '1', title: 'NAE1 p.Asp116Gly', abstract: '', authors: '', journal: '', year: null },
      { id: '2', title: 'NAE1 activity', abstract: '', authors: '', journal: '', year: null },
      { id: '3', title: 'Curated source elsewhere', abstract: '', authors: '', journal: '', year: null },
    ], response: { hitCount: 204, europePmcQuery: 'NAE1', fetchedAt: 1700000000000, degraded: false, pageSize: 25 }, executedQuery: '', narrowingFilter: '', groupFilter: 'all', pinnedIds: new Set(), probe: { state: 'idle', hitCount: null }, load: 'ready', error: null, curatedAdded: 1 });
    const rows = literatureCoverage(evidence.papers);
    expect(rows.map(r => [r.level, r.count, r.total])).toEqual([['variant', 1, 3], ['gene', 1, 3], ['elsewhere', 1, 3]]);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(evidence.papers.length);
    expect(evidence.facts.find(f => f.label === 'Query matches loaded')?.value).toBe('2');
  });
  it('does not divide by zero for an empty loaded set', () => {
    expect(literatureCoverage([]).every(row => row.count === 0 && row.total === 0 && row.percent === 0)).toBe(true);
  });
});
