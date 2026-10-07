import { describe, expect, it } from 'vitest';
import { buildExpressionFinding, buildSourceFacts } from '../expressionTabEvidence';
import type { AdultExpressionResponse } from '../expressionModels';

const t = (id: string, label: string, value: number | null) => ({ id, label, ontologyId: null, value, unit: 'TPM' as const, sampleCount: 10, samplingSite: null });
const adult = (tissues: AdultExpressionResponse['tissues'], status: AdultExpressionResponse['status'] = 'ready'): AdultExpressionResponse =>
  ({ gene: 'SOD1', status, gencodeId: 'G', tissues, provenance: null, message: null });
const SOD1 = adult([t('Liver', 'Liver', 393), t('Adrenal_Gland', 'Adrenal Gland', 389.1), t('Brain_Cortex', 'Brain - Cortex', 120), t('Muscle_Skeletal', 'Muscle - Skeletal', 0)]);

describe('expression finding', () => {
  it('without systems, names the highest tissue and says nothing about expressed or not', () => {
    const f = buildExpressionFinding(SOD1, 'ready', []);
    expect(f).toMatchObject({ state: 'ready', figure: 393, rank: 1, sampledTissues: 4, headline: 'Highest in Liver' });
    expect(`${f.headline} ${f.predicate}`).not.toMatch(/\bexpressed\b|not expressed/i);
  });
  it('reports coverage per system, ranks within all sampled tissues, and states the gap as a coverage limit', () => {
    const f = buildExpressionFinding(SOD1, 'ready', ['nervous', 'skeletal']);
    expect(f.headline).toBe('Measured in 1 of 2 review systems');
    expect(f.figure).toBe(120); expect(f.rank).toBe(3);
    expect(f.coverage.map(c => [c.id, c.state])).toEqual([['nervous', 'measured'], ['skeletal', 'not-sampled']]);
    expect(f.predicate).toMatch(/bone and growth-plate cartilage: that is a coverage limit, not a low reading/);
  });
  it('treats a zero median as a measurement, and shared values share the better rank', () => {
    const f = buildExpressionFinding(adult([t('Muscle_Skeletal', 'Muscle - Skeletal', 0), t('Heart_Left_Ventricle', 'Heart - Left Ventricle', 0)]), 'ready', ['muscle']);
    expect(f).toMatchObject({ figure: 0, rank: 1 });
    expect(f.predicate).toMatch(/a measured zero/);
  });
  it('says GTEx reaches none of the systems when every one is a gap, with no figure', () => {
    const f = buildExpressionFinding(SOD1, 'ready', ['hearing', 'vision']);
    expect(f.figure).toBeNull(); expect(f.headline).toMatch(/samples none of your 2 review systems/);
  });
  it('keeps provider faults, missing genes and loading apart from findings', () => {
    expect(buildExpressionFinding(null, 'error', []).state).toBe('error');
    expect(buildExpressionFinding(null, null, []).state).toBe('loading');
    expect(buildExpressionFinding(adult([], 'not-found'), 'ready', []).predicate).toMatch(/not evidence that the gene is unexpressed/);
    expect(buildExpressionFinding(adult([t('Liver', 'Liver', null)]), 'ready', []).state).toBe('no-values');
  });
});

describe('source facts', () => {
  const finding = buildExpressionFinding(SOD1, 'ready', []);
  it('states each source state in engine vocabulary rather than leaving blanks', () => {
    const facts = buildSourceFacts({ adult: finding, developmental: { status: 'ready', data: { status: 'not-installed', counts: null } },
      hpa: { status: 'error', data: null }, pext: { load: 'ready', status: 'ready', region: null, locationNote: 'Outside the coding regions' } });
    expect(facts.map(f => f.value)).toEqual(['4 sampled', 'Not available here', 'Provider error', 'Not placed']);
    expect(facts[3].sub).toBe('Outside the coding regions');
  });
  it('quotes pext only when the variant sits on a region, as a base-level figure', () => {
    const facts = buildSourceFacts({ adult: finding, developmental: { status: 'ready', data: { status: 'ready', counts: { includedSamples: 300, includedDonors: 40 } } },
      hpa: { status: 'ready', data: { status: 'ready', rna: { specificity: 'Low tissue specificity' }, protein: { evidence: 'Evidence at protein level' } } },
      pext: { load: 'ready', status: 'ready', region: { mean: 0.9876, tissues: 49 }, locationNote: null } });
    expect(facts.map(f => f.value)).toEqual(['4 sampled', '300 samples', 'Low tissue specificity', 'pext 0.99']);
    expect(facts[3].sub).toMatch(/Base-level/);
  });
});
