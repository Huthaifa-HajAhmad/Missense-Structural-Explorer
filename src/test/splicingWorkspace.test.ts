import { describe, expect, it } from 'vitest';
import { splicingReadings, spliceRequestIdentity } from '../shared/splicingWorkspace';
import { buildSplicingEvidence } from '../shared/splicingEvidence';
import { splicingWorkspaceFixture } from './splicingWorkspaceFixture';

const rows = (name = 'Reverse strand', small = false) => {
  const result = splicingWorkspaceFixture(name);
  return splicingReadings(buildSplicingEvidence({ result, showSmallSignals: small }), result);
};
const fact = (name: string, key: string, label: string) => rows(name).find(r => r.key === key)?.facts.find(f => f.label === label)?.value;

describe('splicing workspace records', () => {
  it('keeps exact deltas and genomic offsets, converting only the transcript offset', () => {
    expect(fact('Reverse strand', 'spliceai-ds_al', 'Genomic offset from variant')).toBe('+25 bp');
    expect(fact('Reverse strand', 'spliceai-ds_al', 'Transcript offset from variant')).toBe('−25 bp');
    expect(fact('Forward strand', 'spliceai-ds_al', 'Transcript offset from variant')).toBe('+25 bp');
    expect(rows().find(r => r.key === 'spliceai-ds_al')?.site).toContain('Coincides with an annotated acceptor');
    expect(rows().find(r => r.key === 'spliceai-ds_ag')?.valueText).toBe('0.004');
  });
  it('keeps zero, absent channels and absent positions distinct', () => {
    const zero = rows('Zero').filter(r => r.channel);
    const missing = rows('Missing').filter(r => r.channel);
    expect(zero).toHaveLength(4);
    expect(missing).toHaveLength(4);
    expect(zero.every(r => r.value === 0 && r.valueText === '0')).toBe(true);
    expect(missing.every(r => r.value === null && r.notes.join(' ').includes('did not answer within the request budget'))).toBe(true);
    expect(rows('Missing positions').find(r => r.key === 'spliceai-ds_al')).toMatchObject({ value: 0.3, position: 'Not reported', site: 'Delta position not reported' });
  });
  it('does not interpret a genomic offset as transcript direction without a strand', () => {
    expect(fact('Unknown strand', 'spliceai-ds_al', 'Transcript offset from variant')).toBe('Strand unresolved');
    expect(rows('Unknown strand').find(r => r.key === 'spliceai-ds_al')?.position).toBe('+25 bp · genomic');
  });
  it('preserves source records across display filters and carries actual provenance', () => {
    expect(rows('Small signals', true)).toEqual(rows('Small signals', false));
    expect(fact('Reverse strand', 'spliceai-ds_ag', 'Reporting window')).toBe('±500 bp');
    expect(fact('Reverse strand', 'spliceai-ds_ag', 'Masking')).toBe('Masked');
    expect(fact('Reverse strand', 'spliceai-ds_ag', 'Prediction annotation set')).toBe('Illustrative annotation set');
  });
  it('guards request identity by allele, coordinate and assembly, not score updates', () => {
    const a = splicingWorkspaceFixture();
    const b = splicingWorkspaceFixture('New variant');
    expect(spliceRequestIdentity(a)).not.toBe(spliceRequestIdentity(b));
    expect(spliceRequestIdentity(a)).toBe(spliceRequestIdentity({ ...a, conservationData: { ...a.conservationData!, spliceai: null } }));
    expect(spliceRequestIdentity(a)).not.toBe(spliceRequestIdentity({ ...a, metadata: { ...a.metadata, assembly: 'GRCh37' } } as typeof a));
  });
});
