import { afterEach, describe, expect, it, vi } from 'vitest';

// Shapes copied from the live registry on 2026-10-28. Registry text is verbatim; fields the loader never
// reads are dropped. Answers are keyed by URL without its query string.
const LIST = 'https://cspec.genome.network/cspec/api/svis';
const VHL_RULE_SET = 'https://cspec.genome.network/cspec/api/RuleSet/id/1527855768';
const SOD1_RULE_SET = 'https://cspec.genome.network/cspec/api/RuleSet/id/1575650635';
const ITGA2B_RELEASED_RULE_SET = 'https://cspec.genome.network/cspec/api/RuleSet/id/135640993';
const ITGA2B_IN_PREP_RULE_SET = 'https://cspec.genome.network/cspec/api/RuleSet/id/469246174';
const HOT_SPOT = 'Located in a mutational hot spot and/or critical and well-established functional domain (e.g. active site of an enzyme) without benign variation.';

const vhlSpec = {
  '@id': 'https://cspec.genome.network/cspec/api/SequenceVariantInterpretation/id/GN078',
  affiliation: { label: 'VHL Variant Curation Expert Panel' },
  ruleSets: [{ '@id': VHL_RULE_SET, genes: [{ label: 'VHL', diseases: [{ label: 'MONDO:0008667' }] }] }],
  status: 'Released', url: 'https://cspec.genome.network/cspec/ui/svi/doc/GN078', version: '1.1',
};
// The registry's panel label carries a trailing space, which the loader trims.
const sod1Spec = {
  '@id': 'https://cspec.genome.network/cspec/api/SequenceVariantInterpretation/id/GN132',
  affiliation: { label: 'Amyotrophic Lateral Sclerosis Spectrum Disorders Variant Curation Expert Panel ' },
  ruleSets: [{ '@id': SOD1_RULE_SET, genes: [{ label: 'SOD1' }] }],
  status: 'Pilot Rules In Prep', url: 'https://cspec.genome.network/cspec/ui/svi/doc/GN132', version: '1.0',
};
const gn011Spec = {
  '@id': 'https://cspec.genome.network/cspec/api/SequenceVariantInterpretation/id/GN011',
  affiliation: { label: 'Platelet Disorders Variant Curation Expert Panel' },
  ruleSets: [{ '@id': ITGA2B_RELEASED_RULE_SET, genes: [
    { label: 'ITGA2B', diseases: [{ label: 'MONDO:0100326' }] }, { label: 'ITGB3', diseases: [{ label: 'MONDO:0100326' }] },
  ] }],
  status: 'Released', url: 'https://cspec.genome.network/cspec/ui/svi/doc/GN011', version: '2.1',
};
const gn221Spec = {
  '@id': 'https://cspec.genome.network/cspec/api/SequenceVariantInterpretation/id/GN221',
  affiliation: { label: 'Platelet Disorders Variant Curation Expert Panel' },
  ruleSets: [{ '@id': ITGA2B_IN_PREP_RULE_SET, genes: [{ label: 'ITGA2B', diseases: [{ label: 'MONDO:0008552' }] }] }],
  status: 'Pilot Rules In Prep', url: 'https://cspec.genome.network/cspec/ui/svi/doc/GN221', version: '1.0',
};

const vhlRuleSet = {
  genes: [{ label: 'VHL' }],
  criteriaCodes: [{
    label: 'PM1', description: HOT_SPOT,
    evidenceStrengths: [
      { label: 'Stand Alone', applicability: 'Not Applicable for this VCEP' },
      { label: 'Very Strong', applicability: 'Not Applicable for this VCEP' },
      { label: 'Strong', applicability: 'Not Applicable' },
      { label: 'Moderate', applicability: 'Applicable', description: 'Putative missense variants that are known germline hotspots AND/OR in key functional domains AND/OR somatic variants that have ≥10 instances for the same AA in cancerhotspots.org. See the table of Germline and Somatic Hotspots.' },
      { label: 'Supporting', applicability: 'Applicable', description: 'Putative missense variants seen in somatic databases, having \\<10 instances for the same AA in cancerhotspots.org. See the table of Germline and Somatic Hotspots.' },
    ],
  }],
};
// The SOD1 rule set has no criteriaCodes key at all: its panel has not yet published any criteria.
const sod1RuleSet = { genes: [{ label: 'SOD1' }] };
const gn011RuleSet = {
  genes: [{ label: 'ITGA2B' }, { label: 'ITGB3' }],
  criteriaCodes: [{
    label: 'PM1', description: HOT_SPOT,
    evidenceStrengths: [
      { label: 'Stand Alone', applicability: 'Not applicable' },
      { label: 'Very Strong', applicability: 'Not applicable' },
      { label: 'Strong', applicability: 'Not applicable' },
      { label: 'Moderate', applicability: 'Applicable with VCEP specification', description: 'Rule does not apply due to genes being highly polymorphic.' },
      { label: 'Supporting', applicability: 'Not applicable' },
    ],
  }],
};

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** Answers each CSpec URL from a fixture. A number is an HTTP status; an Error is a transport failure; an unlisted URL is a 404. */
function stubCspec(answers: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const answer = answers[url.split('?')[0]];
    if (answer instanceof Error) throw answer;
    if (answer === undefined) return { ok: false, status: 404, text: async () => '' };
    if (typeof answer === 'number') return { ok: false, status: answer, text: async () => 'upstream body must never reach the reader' };
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
async function loader() { return (await import('./cspec.ts')).loadCspecPm1; }

describe('CSpec PM1 adapter', () => {
  it('reads a released specification and its PM1 criterion verbatim, keeping the registry applicability words', async () => {
    stubCspec({ [LIST]: { data: [vhlSpec, sod1Spec] }, [VHL_RULE_SET]: vhlRuleSet });
    const r = await (await loader())('VHL');
    expect(r.status).toBe('ok'); expect(r.reason).toBeNull();
    expect(r.sourceUrl).toBe('https://cspec.genome.network/cspec/api/svis?detail=high');
    expect(r.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.specs).toHaveLength(1);
    expect(r.specs[0]).toMatchObject({ id: 'GN078', url: 'https://cspec.genome.network/cspec/ui/svi/doc/GN078', panel: 'VHL Variant Curation Expert Panel', status: 'Released', released: true, version: '1.1', diseases: ['MONDO:0008667'], pm1Reason: null });
    expect(r.specs[0].pm1?.description).toBe(HOT_SPOT);
    expect(r.specs[0].pm1?.strengths.map(s => [s.label, s.applicable, s.applicability])).toEqual([
      ['Stand Alone', false, 'Not Applicable for this VCEP'], ['Very Strong', false, 'Not Applicable for this VCEP'],
      ['Strong', false, 'Not Applicable'], ['Moderate', true, 'Applicable'], ['Supporting', true, 'Applicable'],
    ]);
    expect(r.specs[0].pm1?.strengths[4].description).toContain('having \\<10 instances');
  });

  it('lists a specification still in preparation with no PM1 criterion as absent, not as a failure', async () => {
    stubCspec({ [LIST]: { data: [vhlSpec, sod1Spec] }, [SOD1_RULE_SET]: sod1RuleSet });
    const r = await (await loader())('SOD1');
    expect(r).toMatchObject({ status: 'ok', reason: null, specs: [{
      id: 'GN132', panel: 'Amyotrophic Lateral Sclerosis Spectrum Disorders Variant Curation Expert Panel', status: 'Pilot Rules In Prep',
      released: false, version: '1.0', diseases: [], pm1: null, pm1Reason: null,
    }] });
  });

  it('matches the exact symbol, ignoring case, and never by name similarity', async () => {
    stubCspec({ [LIST]: { data: [vhlSpec, sod1Spec] }, [VHL_RULE_SET]: vhlRuleSet });
    const load = await loader();
    expect((await load('vhl')).specs.map(s => s.id)).toEqual(['GN078']);
    expect((await load('VH')).status).toBe('none');
    expect((await load('VHLX')).status).toBe('none');
  });

  it('answers none only when the registry answered and lists no specification for the gene', async () => {
    stubCspec({ [LIST]: { data: [sod1Spec] } });
    const r = await (await loader())('BRCA1');
    expect(r.status).toBe('none');
    expect(r.specs).toEqual([]);
    expect(r.reason).toContain('BRCA1');
    expect(r.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it.each<[unknown, string]>([
    [503, 'request failed (HTTP 503)'],
    [new TypeError('fetch failed'), 'could not be reached'],
    [new DOMException('timeout', 'TimeoutError'), 'timed out'],
    [{ data: [] }, 'unexpected response'],
  ])('reports a failed or incomplete registry read as error, never as no specification', async (answer, message) => {
    stubCspec({ [LIST]: answer });
    const r = await (await loader())('VHL');
    expect(r.status).toBe('error');
    expect(r.specs).toEqual([]);
    expect(r.retrievedAt).toBeNull();
    expect(r.reason).toContain(message);
    expect(r.reason).not.toContain('upstream body');
  });

  it('keeps a specification whose rule set cannot be read in place with pm1 null and a reason, and leaves its neighbour intact', async () => {
    stubCspec({ [LIST]: { data: [gn011Spec, gn221Spec] }, [ITGA2B_RELEASED_RULE_SET]: gn011RuleSet, [ITGA2B_IN_PREP_RULE_SET]: 503 });
    const r = await (await loader())('ITGA2B');
    expect(r.status).toBe('ok');
    expect(r.specs.map(s => [s.id, s.released, s.diseases])).toEqual([['GN011', true, ['MONDO:0100326']], ['GN221', false, ['MONDO:0008552']]]);
    expect(r.specs[0].pm1Reason).toBeNull();
    expect(r.specs[0].pm1?.strengths[3]).toEqual({
      label: 'Moderate', applicable: true, applicability: 'Applicable with VCEP specification', description: 'Rule does not apply due to genes being highly polymorphic.',
    });
    expect(r.specs[1].pm1).toBeNull();
    expect(r.specs[1].pm1Reason).toBe('CSpec request failed (HTTP 503). The PM1 text for GN221 could not be read.');
  });

  it('reads the list once and each rule set once, and retries a failed rule-set read on the next request', async () => {
    const answers: Record<string, unknown> = { [LIST]: { data: [gn011Spec, gn221Spec] }, [ITGA2B_RELEASED_RULE_SET]: gn011RuleSet, [ITGA2B_IN_PREP_RULE_SET]: 503 };
    const fetchMock = stubCspec(answers);
    const load = await loader();
    expect((await load('ITGA2B')).specs[1].pm1Reason).not.toBeNull();
    answers[ITGA2B_IN_PREP_RULE_SET] = { genes: [{ label: 'ITGA2B' }] };
    expect((await load('ITGA2B')).specs[1]).toMatchObject({ pm1: null, pm1Reason: null });
    await load('ITGA2B');
    // list, released rule set, failed in-prep rule set, then its successful retry: nothing else is fetched.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reads released only from the exact registry word', async () => {
    stubCspec({ [LIST]: { data: [{ ...vhlSpec, status: 'Approved For Release' }] }, [VHL_RULE_SET]: vhlRuleSet });
    const r = await (await loader())('VHL');
    expect(r.specs[0]).toMatchObject({ status: 'Approved For Release', released: false });
  });
});
