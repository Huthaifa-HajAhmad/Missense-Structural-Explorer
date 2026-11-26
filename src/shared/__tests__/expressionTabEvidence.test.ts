import { describe, expect, it } from 'vitest';
import { buildExpressionFinding, buildSourceFacts } from '../expressionTabEvidence';
import type { AdultExpressionResponse } from '../expressionModels';
import { pextTissueKey } from '../pext';

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
  const region = { start: 100, stop: 200, mean: 0.8473, tissues: [{ tissue: 'liver', value: 0.8 }, { tissue: 'adrenal_gland', value: 0.9 }] };
  it('states each source state in engine vocabulary rather than leaving blanks', () => {
    const facts = buildSourceFacts({ adult: finding, developmental: { status: 'ready', data: { status: 'not-installed', counts: null } },
      hpa: { status: 'error', data: null }, pext: { load: 'ready', status: 'ready', location: { state: 'no-region', region: null, index: -1 }, regionCount: 23 } });
    expect(facts.map(f => f.value)).toEqual(['4 sampled', 'Not available here', 'Provider error', 'Not placed']);
    expect(facts[3].sub).toBe('Outside the coding regions');
  });
  it.each(['loading', 'ready'] as const)('does not claim coding placement without a gene locus while %s', load => {
    const facts = buildSourceFacts({ adult: finding, developmental: undefined, hpa: undefined,
      pext: { load, status: load === 'ready' ? 'ready' : null, location: { state: 'no-gene-locus', region: null, index: -1 }, regionCount: 0 } });
    expect(facts[3].sub).toBe('No gene locus in this source');
    expect(facts[3].value).toBe(load === 'ready' ? 'Not placed' : 'Running');
  });
  it('quotes pext only when the variant sits on a region, and names the region among all of them', () => {
    const facts = buildSourceFacts({ adult: finding, developmental: { status: 'ready', data: { status: 'ready', counts: { includedSamples: 300, includedDonors: 40 } } },
      hpa: { status: 'ready', data: { status: 'ready', rna: { specificity: 'Low tissue specificity' }, protein: { evidence: 'Evidence at protein level' } } },
      pext: { load: 'ready', status: 'ready', location: { state: 'region', region, index: 15 }, regionCount: 23 } });
    expect(facts.map(f => f.value)).toEqual(['4 sampled', '300 samples', 'Low tissue specificity', 'pext 0.85']);
    expect(facts[3].sub).toBe('Coding region 16 of 23, mean of 2 tissues');
  });
  it('labels the HPA protein field as an existence summary, not a tissue detection', () => {
    // HPA's "Evidence" field summarises whether the protein exists at all (UniProt-style evidence level);
    // shown bare beside RNA specificity it read as "protein measured in tissues".
    const facts = buildSourceFacts({ adult: finding, developmental: undefined,
      hpa: { status: 'ready', data: { status: 'ready', rna: { specificity: 'Low tissue specificity' }, protein: { evidence: 'Evidence at protein level' } } },
      pext: { load: null, status: null, location: { state: 'no-locus', region: null, index: -1 }, regionCount: 0 } });
    expect(facts[2].sub).toBe('RNA tissue class; protein existence: evidence at protein level');
  });
});

describe('pext tissue names', () => {
  it('matches gnomAD snake_case ids to GTEx ids whatever their punctuation', () => {
    expect(pextTissueKey('Cells_EBV-transformed_lymphocytes')).toBe(pextTissueKey('cells_ebv_transformed_lymphocytes'));
    expect(pextTissueKey('Brain_Anterior_cingulate_cortex_BA24')).toBe('brain_anterior_cingulate_cortex_ba24');
  });
});
