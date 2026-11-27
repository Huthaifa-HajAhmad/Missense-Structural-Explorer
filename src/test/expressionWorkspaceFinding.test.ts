import { describe, expect, it } from 'vitest';
import { expressionWorkspaceFinding } from '../shared/expressionWorkspaceFinding';
import { contextWorkspaceFixture } from './contextWorkspaceFixture';

describe('active-source expression finding', () => {
  const f = contextWorkspaceFixture();
  const input = { section: 'developmental', adult: { status: 'ready' as const, data: f.adult }, developmental: { status: 'ready' as const, data: f.developmental }, systems: [], cohort: 'all' };
  it('keeps pediatric zero, age cohort and adult findings separate', () => {
    const zero = expressionWorkspaceFinding({ ...input, cohort: '1' });
    expect(zero.headline).toBe('Brain · 0 TPM');
    expect(zero.detail).toContain('Infant (0 to 2 years)');
    expect(expressionWorkspaceFinding(input).headline).toBe('Brain · 36 TPM');
    expect(expressionWorkspaceFinding({ ...input, section: 'adult' }).headline).toContain('380 TPM');
  });
  it('distinguishes unavailable, error, absent gene and uncovered scope', () => {
    expect(expressionWorkspaceFinding({ ...input, developmental: { status: 'error', data: null } }).headline).toContain('could not be read');
    expect(expressionWorkspaceFinding({ ...input, developmental: { status: 'ready', data: { ...f.developmental, status: 'not-installed' } } }).headline).toContain('not available here');
    expect(expressionWorkspaceFinding({ ...input, developmental: { status: 'ready', data: { ...f.developmental, status: 'not-found' } } }).headline).toContain('No pediatric gene reading');
    expect(expressionWorkspaceFinding({ ...input, systems: ['hearing'] }).headline).toContain('No pediatric measurements in this review scope');
  });
});

describe('sub-tab readings: the open sub-tab names its own measurement', () => {
  const f = contextWorkspaceFixture();
  const base = { section: 'adult', adult: { status: 'ready' as const, data: f.adult }, developmental: undefined, systems: [], cohort: 'all' };
  const hpa = (evidence: string | null) => ({ status: 'ready' as const, data: { gene: 'SOD1', status: 'ready' as const, ensemblId: 'ENSG00000142168',
    rna: { specificity: 'Low tissue specificity', distribution: null, enrichedTissues: [] }, cells: null,
    protein: { evidence, tissueSpecificity: null, antibodies: [], reliabilityIhc: null, reliabilityIf: null }, provenance: null, message: null } });

  it('reads protein existence on the protein sub-tab, not the RNA median', () => {
    const reading = expressionWorkspaceFinding({ ...base, measure: 'protein', hpa: hpa('Evidence at protein level') });
    expect(reading.source).toBe('Human Protein Atlas · protein');
    expect(reading.headline).toBe('Evidence at protein level');
    expect(JSON.stringify(reading)).not.toContain('TPM');
  });
  it('says when the protein atlas gives no protein-level evidence', () => {
    expect(expressionWorkspaceFinding({ ...base, measure: 'protein', hpa: hpa(null) }).headline).toBe('No protein-level evidence reported');
  });
  it('reads the variant region pext on the expression-at-variant sub-tab, not the RNA median', () => {
    const reading = expressionWorkspaceFinding({ ...base, measure: 'pext', pext: { load: 'ready', status: 'ready', regionCount: 17,
      location: { state: 'region', region: { start: 100, stop: 200, mean: 0.85, tissues: [] }, index: 2 } } });
    expect(reading.source).toBe('gnomAD · base-level pext');
    expect(reading.headline).toBe('Coding region 3 of 17 · pext 0.85');
    expect(JSON.stringify(reading)).not.toContain('TPM');
  });
  it('says why the variant has no pext reading', () => {
    const reading = expressionWorkspaceFinding({ ...base, measure: 'pext', pext: { load: 'ready', status: 'ready', regionCount: 17,
      location: { state: 'no-region', region: null, index: -1 } } });
    expect(reading.headline).toBe('No pext value at this variant');
    expect(reading.detail).toBe('Outside the coding regions');
  });
  it('keeps the RNA reading when no sub-tab measure is open', () => {
    expect(expressionWorkspaceFinding(base).headline).toContain('380 TPM');
  });
});
