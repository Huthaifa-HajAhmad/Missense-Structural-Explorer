import { describe, expect, it } from 'vitest';
import { mapResidue, buildAlignmentEvidence, type AlignedHomology } from '../residueAlignment';
import { locatePext, orderPextTissues, pextSiteFromVariantId, type PextResponse } from '../pext';

const hom = (sourceAligned: string, targetAligned: string): AlignedHomology => ({ type: '1:1', species: 'mus_musculus', taxonId: 'NCBITaxon:10090', geneId: 'ENSMUSG1', proteinId: 'ENSMUSP1',
  sourceAligned, targetAligned, humanIdentity: 80, orthologIdentity: 80, humanSimilarity: 90 });

describe('gap-aware residue mapping', () => {
  it('walks columns: a gap in the human sequence shifts the ortholog position, not the human one', () => {
    const m = mapResidue(hom('AB-CDE', 'ABXCDE'), 'ABCDE', 3, 'C', 'Q');
    expect(m).toMatchObject({ state: 'identical', targetResidue: 'C', targetPosition: 4 });
    expect(m.window?.human[m.window.focus]).toBe('C');
  });
  it('reports a gap, a different residue, and the substituted residue found in the ortholog', () => {
    expect(mapResidue(hom('AB-CDE', 'AB--DE'), 'ABCDE', 3, 'C', 'Q').state).toBe('gap');
    expect(mapResidue(hom('ABCDE', 'ABQDE'), 'ABCDE', 3, 'C', 'Q')).toMatchObject({ state: 'different', carriesVariantResidue: true });
  });
  it('makes no residue claim when the app sequence is not the alignment source', () => {
    expect(mapResidue(hom('ABCDE', 'ABCDE'), 'ABCDX', 3, 'C', 'Q').state).toBe('reference-mismatch');
    expect(mapResidue(hom('ABCDE', 'ABCDE'), 'ABCDE', 3, 'D', 'Q').state).toBe('reference-mismatch');
    expect(mapResidue(hom('ABCDE', 'ABCDE'), null, 3, 'C', 'Q').state).toBe('reference-mismatch');
    const evidence = buildAlignmentEvidence({ gene: 'X', status: 'ready', sourceProteinId: 'P', homologies: [hom('ABCDE', 'ABCDE')], provenance: null, message: null }, 'ZZZZZ', 3, 'C', 'Q');
    expect(evidence.mismatched).toBe(true);
  });
});

const pext: PextResponse = { gene: 'G', status: 'ready', geneId: 'ENSG1', chrom: '17', flags: [], provenance: null, message: null, regions: [
  { start: 100, stop: 110, mean: 0.5, tissues: [{ tissue: 'heart_left_ventricle', value: 0.2 }, { tissue: 'liver', value: 0.9 }, { tissue: 'cells_ebv_transformed_lymphocytes', value: null }] },
  { start: 200, stop: 210, mean: 0.1, tissues: [] }] };
describe('pext placement', () => {
  it('accepts only a verified GRCh38 locus', () => {
    expect(pextSiteFromVariantId('17-110-A-T', 'GRCh38', false)).toEqual({ chrom: '17', pos: 110 });
    expect(pextSiteFromVariantId('17-110-A-T', 'GRCh37', false)).toBeNull();
    expect(pextSiteFromVariantId('17-110-A-T', 'GRCh38', true)).toBeNull();
    expect(pextSiteFromVariantId('nonsense', 'GRCh38', false)).toBeNull();
  });
  it('is 1-based inclusive at both boundaries and distinguishes the no-region states', () => {
    expect(locatePext(pext, { chrom: '17', pos: 100 }).index).toBe(0);
    expect(locatePext(pext, { chrom: '17', pos: 110 }).index).toBe(0);
    expect(locatePext(pext, { chrom: '17', pos: 111 }).state).toBe('no-region');
    expect(locatePext(pext, { chrom: '9', pos: 105 }).state).toBe('other-chromosome');
    expect(locatePext(pext, null).state).toBe('no-locus');
  });
  it('keeps every tissue, leads with selected systems and keeps null as no value', () => {
    const t = orderPextTissues(pext.regions[0], ['cardiovascular']);
    expect(t.relevant.map(x => x.tissue)).toEqual(['heart_left_ventricle']);
    expect(t.other.map(x => x.tissue)).toEqual(['liver', 'cells_ebv_transformed_lymphocytes']);
  });
});

import { validityPosition, VALIDITY_SCALE } from '../diseaseFrame';
describe('GenCC scale position', () => {
  it('places listed classifications, tolerates the Evidence suffix and refuses to force the rest onto a rung', () => {
    expect(validityPosition('Definitive')).toBe(VALIDITY_SCALE.length - 1);
    expect(validityPosition('Refuted Evidence')).toBe(0);
    expect(validityPosition('Disputed Evidence')).toBe(1);
    expect(validityPosition('Animal Model Only')).toBeNull();
    expect(validityPosition('No Known Disease Relationship')).toBeNull();
  });
});

import { groupHpoTerms, systemForCategory } from '../hpoAnnotation';
describe('review-driven regressions', () => {
  it('maps every HPO category spelling the service returns, ignoring case', () => {
    for (const [c, s] of [['Cardiovascular', 'cardiovascular'], ['Immunology', 'immune'], ['Blood and blood-forming tissues', 'immune'], ['Genitourinary system', 'renal'], ['Nervous System', 'nervous']] as const) expect(systemForCategory(c)).toBe(s);
    expect(systemForCategory('Connective tissue')).toBeNull();
    expect(groupHpoTerms({ gene: 'G', status: 'ready', disease: null, provenance: null, message: null, terms: [{ id: 'HP:0000001', name: 'x', category: 'Cardiovascular', frequency: null, onset: null, sources: [] }] })[0].system).toBe('cardiovascular');
  });
  it('treats gnomAD chrom M and the variant id MT as the same chromosome', () => {
    expect(locatePext({ ...pext, chrom: 'M', regions: [{ start: 1, stop: 9, mean: 0, tissues: [] }] }, { chrom: 'MT', pos: 5 }).state).toBe('region');
  });
});
