import { describe, expect, it } from 'vitest';
import { literatureCoverage, literatureTextCoverage } from '../reviewPresentation';
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
    expect(literatureTextCoverage(evidence.papers)).toEqual({ total: 3, withAbstract: 0, withoutAbstract: 3 });
    const mixed = evidence.papers.map((paper, i) => ({ ...paper, citation: { ...paper.citation, abstract: i === 0 ? 'Measured enzyme activity.' : i === 1 ? '   ' : '' } }));
    expect(literatureTextCoverage(mixed)).toEqual({ total: 3, withAbstract: 1, withoutAbstract: 2 });
    expect(literatureTextCoverage([])).toEqual({ total: 0, withAbstract: 0, withoutAbstract: 0 });
    expect(evidence.facts.find(f => f.label === 'Query matches loaded')?.value).toBe('2');
  });
  it('does not divide by zero for an empty loaded set', () => {
    expect(literatureCoverage([]).every(row => row.count === 0 && row.total === 0 && row.percent === 0)).toBe(true);
  });
});
