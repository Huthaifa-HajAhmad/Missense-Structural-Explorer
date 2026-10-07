import { describe, expect, it } from 'vitest';
import { buildVariantLocusEvidence, canonicalXref } from '../variantLocus';
const frame = { diseaseId: 'MONDO:0004976', xrefs: ['OMIM:105400', 'Orphanet:803'] };
const cv = (conditions?: { label: string; xrefs: { source: string; id: string }[] }[], trait = 'x') => ({ classification: 'Pathogenic', lastEvaluated: '', reviewStatus: 'r', alleleFrequencies: [], trait, uid: '9', conditions }) as any;
describe('variant locus', () => {
  it('normalises the identifier spellings of each database', () => {
    expect(canonicalXref('MONDO', 'MONDO:0004976')).toBe('mondo:0004976');
    expect(canonicalXref('OMIM', '105400')).toBe('omim:105400');
    expect(canonicalXref('Orphanet', 'ORPHA803')).toBe('orphanet:803');
    expect(canonicalXref('MedGen', 'C1')).toBeNull();
  });
  it('matches via any shared identifier', () => {
    expect(buildVariantLocusEvidence(cv([{ label: 'ALS', xrefs: [{ source: 'OMIM', id: '105400' }] }]), frame).state).toBe('listed');
  });
  it('matches a MONDO-only frame', () => {
    expect(buildVariantLocusEvidence(cv([{ label: 'X', xrefs: [{ source: 'MONDO', id: 'MONDO:1' }] }]), { diseaseId: 'MONDO:1', xrefs: [] }).state).toBe('listed');
  });
  it('pads MONDO and accepts prefix-less ids; unmapped databases are not "other conditions"', () => {
    expect(canonicalXref('MONDO', '4976')).toBe('mondo:0004976'); expect(canonicalXref('MONDO', 'MONDO:0004976')).toBe('mondo:0004976');
    expect(buildVariantLocusEvidence(cv([{ label: 'PKU', xrefs: [{ source: 'MedGen', id: 'C0031485' }] }]), frame).state).toBe('no-condition-ids');
  });
  it('does not match on label', () => {
    expect(buildVariantLocusEvidence(cv([{ label: 'amyotrophic lateral sclerosis', xrefs: [{ source: 'OMIM', id: '1' }] }]), frame).state).toBe('other-conditions');
  });
  it('separates the absent states', () => {
    expect(buildVariantLocusEvidence(null, frame).state).toBe('no-clinvar');
    expect(buildVariantLocusEvidence(cv(undefined, 'ALS'), frame).state).toBe('no-condition-ids');
    expect(buildVariantLocusEvidence(cv([{ label: 'A', xrefs: [] }]), frame).state).toBe('no-condition-ids');
    expect(buildVariantLocusEvidence(cv([], ''), frame).state).toBe('no-conditions');
  });
});
