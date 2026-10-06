import { describe, expect, it } from 'vitest';
import { evidenceContextIdentity } from '../evidenceContextIdentity';
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
