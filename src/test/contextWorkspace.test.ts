import { describe, expect, it } from 'vitest';
import { contextWorkspaceFixture } from './contextWorkspaceFixture';
import { contextPage, expressionReadings, speciesReadings, speciesCoverage, geneDiseaseReadings } from '../shared/contextWorkspace';
import { buildGeneDiseaseModel } from '../shared/geneDiseaseEvidence';
import { buildExpressionFinding } from '../shared/expressionTabEvidence';

describe('context workspace scientific and presentation contracts', () => {
  it('counts source coverage without merging provider identifiers or one-to-many orthologs', () => {
    const f = contextWorkspaceFixture();
    const rows = speciesReadings({ models: f.models, alignment: f.alignment, phenotypes: f.phenotypes, sequence: 'MACDEFGHIK', position: 3, wildType: 'C', mutant: 'Q', diseaseTerms: null, diseaseKey: 'A' });
    const fish = speciesCoverage(rows).find(s => s.taxon === 'NCBITaxon:7955')!;
    expect(fish.counts.orthologs).toBe(2);
    const filtered = contextPage(rows, { group: 'orthologs', query: fish.taxon });
    expect(filtered.rows).toHaveLength(2);
    expect(new Set(filtered.rows.map(r => r.key)).size).toBe(2);
    const unknown = { ...rows.find(r => r.group === 'orthologs')!, key: 'unknown', taxon: 'NCBITaxon:9999999', name: 'An unnamed ortholog' };
    expect(speciesCoverage([unknown])[0]).toMatchObject({ label: 'Taxon NCBITaxon:9999999', counts: { orthologs: 1, alignment: 0, phenotypes: 0 } });
    expect(contextPage([unknown], { group: 'orthologs', query: unknown.taxon }).rows[0]).toBe(unknown);
    expect(speciesCoverage([])).toEqual([]);
  });
  it('keeps missing, zero and no sampled tissue distinct, including in the hero', () => {
    const f = contextWorkspaceFixture();
    const rows = expressionReadings(f.adult, f.developmental, ['cardiovascular', 'hearing']);
    expect(rows.find(r => r.name === 'Skeletal muscle')?.value).toBe(0);
    expect(rows.find(r => r.key === 'adult:Heart_Left_Ventricle')?.value).toBeNull();
    const finding = buildExpressionFinding(f.adult, 'ready', ['cardiovascular', 'hearing']);
    expect(finding.coverage.map(c => c.state)).toEqual(['no-reading', 'not-sampled']);
    expect(finding.headline).toBe('No gene reading in your sampled review systems');
  });
  it('keeps RNA sources and cohorts separate, with a fixed source domain under filtering', () => {
    const f = contextWorkspaceFixture();
    const rows = expressionReadings(f.adult, f.developmental, []);
    const p = contextPage(rows, { group: 'adult', query: 'muscle' });
    expect(p.rows).toHaveLength(1); expect(p.rows[0].value).toBe(0); expect(p.max).toBe(380);
    const d = contextPage(rows, { group: 'developmental', query: '', cohort: '1' });
    expect(d.rows).toHaveLength(1); expect(d.rows[0].notes.join(' ')).toContain('Single donor'); expect(d.max).toBe(36);
    expect(expressionReadings({ ...f.adult, status: 'error' }, null, [])).toHaveLength(0);
  });
  it('bounds dense views and keeps every source record reachable', () => {
    const f = contextWorkspaceFixture(); const base = expressionReadings(f.adult, null, [])[0];
    const rows = Array.from({ length: 150 }, (_, i) => ({ ...base, key: `r${i}`, name: `Tissue ${i}` }));
    expect(contextPage(rows, { group: 'adult', query: '' })).toMatchObject({ total: 150 });
    expect(contextPage(rows, { group: 'adult', query: '' }).rows).toHaveLength(20);
    expect(contextPage(rows, { group: 'adult', query: '', limit: 150 }).rows).toHaveLength(150);
  });
  it('retains one-to-many orthologs, gaps, mismatch and disease-scoped phenotype identities', () => {
    const f = contextWorkspaceFixture();
    const input = { models: f.models, alignment: f.alignment, phenotypes: f.phenotypes, sequence: 'MACDEFGHIK', position: 3, wildType: 'C', mutant: 'Q', diseaseTerms: ['HP:0000001'], diseaseKey: 'A' };
    const rows = speciesReadings(input);
    expect(rows.filter(r => r.group === 'orthologs' && r.taxon === 'NCBITaxon:7955')).toHaveLength(2);
    expect(rows.find(r => r.mapping?.state === 'gap')?.valueText).toBe('Gap in alignment');
    expect(rows.find(r => r.mapping?.carriesVariantResidue)?.notes.join(' ')).toContain('does not establish tolerance');
    const mismatched = speciesReadings({ ...input, sequence: 'MVVDEFGHIK' }).filter(r => r.group === 'alignment');
    expect(mismatched.every(r => r.mapping?.window === null)).toBe(true);
    const old = rows.find(r => r.group === 'phenotypes')!;
    expect(old.relevant).toBe(true);
    expect(speciesReadings({ ...input, diseaseKey: 'B' }).find(r => r.group === 'phenotypes')?.key).not.toBe(old.key);
    expect(speciesReadings({ ...input, phenotypes: { ...f.phenotypes, mapping: 'unavailable' } }).find(r => r.group === 'phenotypes')?.relevant).toBe(false);
  });
  it('refuses the overlap claim when the disease terms were never available to compare', () => {
    const f = contextWorkspaceFixture();
    const input = { models: f.models, alignment: f.alignment, phenotypes: f.phenotypes, sequence: 'MACDEFGHIK', position: 3, wildType: 'C', mutant: 'Q', diseaseKey: 'A' };
    // Null terms (no disease chosen / HPO not read) is not a negative result:
    const none = speciesReadings({ ...input, diseaseTerms: null }).find(r => r.group === 'phenotypes')!;
    expect(none.facts.find(f2 => f2.label === 'Disease term overlap')?.value).toBe('No disease terms to compare with');
    expect(none.relevant).toBe(false);
    // Empty terms read the same way: an empty comparison is not "no returned overlap".
    const empty = speciesReadings({ ...input, diseaseTerms: [] }).find(r => r.group === 'phenotypes')!;
    expect(empty.facts.find(f2 => f2.label === 'Disease term overlap')?.value).toBe('No disease terms to compare with');
    // Terms that ran but found nothing keep the honest negative wording.
    const ran = speciesReadings({ ...input, diseaseTerms: ['HP:9999999'] }).find(r => r.group === 'phenotypes')!;
    expect(ran.facts.find(f2 => f2.label === 'Disease term overlap')?.value).toBe('No returned overlap');
  });
  it('counts inheritance frames accurately and keeps assertions categorical with stable keys', () => {
    const f = contextWorkspaceFixture();
    const input = { gene: 'SOD1', disease: { status: 'ready' as const, data: f.disease }, dosage: undefined, selectedKey: null };
    expect(buildGeneDiseaseModel(input).headline).toBe('2 disease–inheritance frames');
    const model = buildGeneDiseaseModel({ ...input, selectedKey: f.disease.frames[0].key });
    const rows = geneDiseaseReadings(model);
    expect(rows).toHaveLength(3); expect(rows.every(r => r.value === null)).toBe(true);
    expect(rows.map(r => r.valueText)).toContain('Disputed Evidence');
  });
});
