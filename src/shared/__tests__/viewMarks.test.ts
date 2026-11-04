import { describe, expect, it } from 'vitest';
import { clinvarMark, dosageMark, hotspotMark, pextMark, proteinAtlasMark } from '../viewMarks';

const reading = (code: number | null) => ({ code }) as any;

describe('view marks say no more than the data does', () => {
  it('marks ClinVar only for a classification that may be quoted', () => {
    expect(clinvarMark({ classification: 'Pathogenic', uid: '1' })).toBeDefined();
    expect(clinvarMark({ classification: 'Unknown', uid: '1' })).toBeUndefined();
    expect(clinvarMark({ classification: 'Not found in ClinVar', uid: null })).toBeUndefined();
    expect(clinvarMark(null)).toBeUndefined();
    // A failed read means a record in hand is stale and must not be quoted.
    expect(clinvarMark({ classification: 'Pathogenic', uid: '1' }, { clinvar: 'timeout' })).toBeUndefined();
  });

  it('marks hotspots for a hotspot rung only, not for regional constraint', () => {
    expect(hotspotMark([{ key: 'regional', atVariant: 'inside' }])).toBeUndefined();
    expect(hotspotMark([{ key: 'regional', atVariant: 'inside' }, { key: 'cspec', atVariant: 'outside' }])).toBeUndefined();
    expect(hotspotMark([{ key: 'per-published', atVariant: 'inside' }])).toBeDefined();
    expect(hotspotMark([{ key: 'spatial', atVariant: 'inside' }])).toBeDefined();
    expect(hotspotMark([])).toBeUndefined();
    expect(hotspotMark(undefined)).toBeUndefined();
  });

  it('marks dosage only when ClinGen scored the gene, and score 0 is no evidence', () => {
    expect(dosageMark({ state: 'ready', readings: [reading(3), reading(0)] })).toBeDefined();
    expect(dosageMark({ state: 'ready', readings: [reading(40), reading(null)] })).toBeDefined();
    expect(dosageMark({ state: 'ready', readings: [reading(0), reading(0)] })).toBeUndefined();
    expect(dosageMark({ state: 'ready', readings: [reading(null), reading(null)] })).toBeUndefined();
    expect(dosageMark({ state: 'not-found', readings: [] })).toBeUndefined();
    expect(dosageMark({ state: 'error', readings: [reading(3)] })).toBeUndefined();
  });

  it('marks the Protein Atlas only for a full record', () => {
    expect(proteinAtlasMark({ status: 'ready', rna: {}, cells: {}, protein: {} })).toBeDefined();
    expect(proteinAtlasMark({ status: 'ready', rna: {} })).toBeUndefined();
    expect(proteinAtlasMark({ status: 'not-found' })).toBeUndefined();
    expect(proteinAtlasMark(null)).toBeUndefined();
  });

  it('marks pext only when the variant is inside a region', () => {
    expect(pextMark({ mean: 0.9 })).toBeDefined();
    expect(pextMark(null)).toBeUndefined();
  });
});
