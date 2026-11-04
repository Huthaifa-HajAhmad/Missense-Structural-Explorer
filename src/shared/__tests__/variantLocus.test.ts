import { describe, expect, it } from 'vitest';
import { buildVariantLocusEvidence, canonicalXref } from '../variantLocus';
const frame = { diseaseId: 'MONDO:0004976', xrefs: ['OMIM:105400', 'Orphanet:803'] };
const cv = (conditions?: { label: string; xrefs: { source: string; id: string }[]; record?: object }[], trait = 'x') => ({ classification: 'Pathogenic', lastEvaluated: '', reviewStatus: 'r', alleleFrequencies: [], trait, uid: '9', conditions }) as any;
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

describe('variant locus with ClinVar’s full record', () => {
  // CNNM2 p.Glu357Lys: the aggregate lists "not provided"; the selected disease sits on its own record.
  const record = { accession: 'RCV000172914', classification: 'Pathogenic', reviewStatus: 'no assertion criteria provided', lastEvaluated: '2014-04-01', inAggregate: false };
  const disease = { diseaseId: 'MONDO:0020787', xrefs: ['OMIM:616418'] };
  const full = [
    { label: 'Hypomagnesemia, seizures, and intellectual disability 1', xrefs: [{ source: 'MONDO', id: 'MONDO:0020787' }, { source: 'OMIM', id: '616418' }], record },
    { label: 'not provided', xrefs: [{ source: 'MedGen', id: 'C3661900' }] },
  ];
  it('lists the selected disease when it is on a record outside the aggregate, and keeps that record', () => {
    const e = buildVariantLocusEvidence({ ...cv(full), conditionsRead: 'full-record' }, disease);
    expect(e.state).toBe('listed');
    expect(e.matchedRecords).toEqual([{ label: full[0].label, record }]);
    expect(e.other).toEqual([]);
    expect(e.fullRecord).toBe(true);
  });
  it('never matches the "not provided" placeholder, and gives a variant that has only it its own state', () => {
    const onlyUnnamed = [full[1]];
    const e = buildVariantLocusEvidence({ ...cv(onlyUnnamed), conditionsRead: 'summary-only' }, disease);
    expect(e.state).toBe('not-provided');
    expect(e.fullRecord).toBe(false);
    expect(buildVariantLocusEvidence(cv([{ label: 'Not Specified', xrefs: [{ source: 'MONDO', id: 'MONDO:0020787' }] }]), disease).state).toBe('not-provided');
  });
  it('drops the placeholder from the other conditions when a named one is present', () => {
    const e = buildVariantLocusEvidence(cv([full[1], { label: 'Other disease', xrefs: [{ source: 'OMIM', id: '1' }] }]), disease);
    expect(e.state).toBe('other-conditions');
    expect(e.other).toEqual(['Other disease']);
  });
  it('does not call a condition it cannot compare a different one', () => {
    // MedGen-only: neither a match nor evidence of another disease. The card must not say "other conditions".
    const e = buildVariantLocusEvidence(cv([{ label: 'PKU', xrefs: [{ source: 'MedGen', id: 'C1' }] }]), disease);
    expect(e.state).toBe('no-condition-ids');
    expect(e.unmatchable).toEqual(['PKU']);
    expect(e.other).toEqual([]);
    expect(e.fullRecord).toBe(false);
    const both = buildVariantLocusEvidence(cv([{ label: 'PKU', xrefs: [{ source: 'MedGen', id: 'C1' }] }, { label: 'ALS', xrefs: [{ source: 'OMIM', id: '105400' }] }]), disease);
    expect(both.state).toBe('other-conditions');
    expect(both.other).toEqual(['ALS']);
    expect(both.unmatchable).toEqual(['PKU']);
  });
  it('treats ClinVar’s record of absence as its own state, not as a record with no conditions', () => {
    const sentinel = { classification: 'Not found in ClinVar', lastEvaluated: '', reviewStatus: '', alleleFrequencies: [], trait: '', uid: null } as any;
    const e = buildVariantLocusEvidence(sentinel, disease);
    expect(e.state).toBe('not-listed');
    expect(e.matchedRecords).toEqual([]);
    expect(buildVariantLocusEvidence(null, disease).state).toBe('no-clinvar');
  });
  it('gives one block per ClinVar record, joining the names of a record that matches under several', () => {
    const shared = { ...record, accession: 'RCV000000001' };
    const e = buildVariantLocusEvidence(cv([
      { label: 'Name A', xrefs: [{ source: 'OMIM', id: '616418' }], record: shared },
      { label: 'Name B', xrefs: [{ source: 'MONDO', id: 'MONDO:0020787' }], record: shared },
    ]), disease);
    expect(e.matchedRecords).toEqual([{ label: 'Name A; Name B', record: shared }]);
    expect(e.matched).toEqual(['Name A', 'Name B']);
  });
  it('matches without a record when only the summary was read', () => {
    const e = buildVariantLocusEvidence(cv([{ label: 'X', xrefs: [{ source: 'OMIM', id: '616418' }] }]), disease);
    expect(e.state).toBe('listed');
    expect(e.matchedRecords).toEqual([]);
    expect(e.matched).toEqual(['X']);
  });
});
