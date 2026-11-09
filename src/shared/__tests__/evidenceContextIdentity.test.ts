import { describe, expect, it } from 'vitest';
import { evidenceContextIdentity, onlyFillsInIdentity } from '../evidenceContextIdentity';
describe('context selection annotation identity', () => {
  it('keeps transcript, isoform, assembly and resolved locus selections separate', () => {
    const metadata = { gene: 'TEST', uniprotId: 'P1', variant: 'p.Ala1Val' };
    const base = evidenceContextIdentity({ metadata }, '', '');
    for (const extra of [{ transcriptId: 'ENST1.1' }, { uniprotIsoform: 'P1-2' }, { assembly: 'GRCh37' }, { liftedGenomicCoordinates: '1-100-A-G' }]) {
      expect(evidenceContextIdentity({ metadata, ...extra }, '', '')).not.toBe(base);
    }
    expect(evidenceContextIdentity({ metadata }, 'OTHER', 'OTHER')).toBe(base);
  });
});

describe('an identity that gains detail while a result streams in', () => {
  const metadata = { gene: 'TEST', uniprotId: 'P1', variant: 'p.Ala1Val' };
  const key = (extra: object = {}) => evidenceContextIdentity({ metadata, ...extra }, '', '');
  it('counts a transcript arriving as more detail, not a change', () => {
    expect(onlyFillsInIdentity(key(), key({ transcriptId: 'ENST1.1' }))).toBe(true);
  });
  it('counts one transcript replacing another as a change', () => {
    expect(onlyFillsInIdentity(key({ transcriptId: 'ENST1.1' }), key({ transcriptId: 'ENST2.1' }))).toBe(false);
  });
});
