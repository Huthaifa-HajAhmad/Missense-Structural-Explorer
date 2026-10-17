import { afterEach, describe, expect, it, vi } from 'vitest';
const row = (symbol: string, extra = {}) => ({ symbol, hgnc_id: 'HGNC:1', location: '1p1', haplo_assertion: '30: Gene associated with autosomal recessive phenotype', triplo_assertion: -5, haplo_disease: 'D', haplo_mondo: 'MONDO:1', rawdate: '2026-08-11T12:15:51.000-0400', ...extra });
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function load(rows: unknown[], total = rows.length, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, text: async () => JSON.stringify({ total, rows }) })));
  return (await import('./clingenDosage.ts')).loadDosageContext;
}
describe('ClinGen dosage adapter', () => {
  it('matches the exact symbol and normalises codes, dates and absent triplosensitivity', async () => {
    const r = await (await load([row('SOD1'), row('SOD10', { haplo_assertion: 3 })]))('SOD1');
    expect(r.status).toBe('ready'); expect(r.record?.haploinsufficiency).toMatchObject({ state: 'scored', code: 30, diseaseId: 'MONDO:1' });
    expect(r.record?.triplosensitivity.state).toBe('not-reported'); expect(r.record?.evaluatedAt).toBe('2026-08-11');
    expect(r.provenance?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('reads the disease ID from either field name ClinGen uses', async () => {
    const r = await (await load([row('G', { haplo_mondo: undefined, haplo_disease_id: 'MONDO:7' })]))('G');
    expect(r.record?.haploinsufficiency.diseaseId).toBe('MONDO:7');
  });
  it('reports not-found for an unlisted gene without guessing aliases', async () => {
    expect((await (await load([row('SOD1')]))('sod1')).status).toBe('not-found');
  });
  it('fails closed on an incomplete table or HTTP error', async () => {
    expect((await (await load([row('A')], 5))('A')).status).toBe('error');
    expect((await (await load([row('A')], 1, false))('A')).status).toBe('error');
  });
  it('does not turn a matching row with a missing HGNC ID into a negative lookup', async () => {
    const r = await (await load([row('NAE1', { hgnc_id: '' })]))('NAE1');
    expect(r.status).toBe('error');
    expect(r.message).toContain('invalid gene identifier');
    expect(r.provenance).toBeNull();
  });
  it('rejects ambiguous duplicate symbol rows instead of taking the first assertion', async () => {
    const r = await (await load([row('NAE1'), row('NAE1', { hgnc_id: 'HGNC:2' })]))('NAE1');
    expect(r.status).toBe('error');
    expect(r.message).toContain('ambiguous');
  });
  it('shares one complete table across concurrent genes and subsequent negative lookups', async () => {
    const loader = await load([row('PTEN')]);
    const [positive, negative] = await Promise.all([loader('PTEN'), loader('NAE1')]);
    expect(positive.status).toBe('ready');
    expect(negative).toMatchObject({ status: 'not-found', record: null, provenance: { source: 'ClinGen dosage sensitivity' } });
    expect(negative.message).toContain('NAE1 in the complete source table');
    expect((await loader('NAE1')).provenance?.sha256).toBe(positive.provenance?.sha256);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not cache incomplete reads and reports the successful retry with provenance', async () => {
    const loader = await load([row('PTEN')], 2);
    expect((await loader('NAE1')).message).toContain('incomplete');
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ rows: [row('PTEN')], total: 1 })));
    const retried = await loader('NAE1');
    expect(retried.status).toBe('not-found');
    expect(retried.provenance?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('recovers one transient transport failure without requiring a manual retry', async () => {
    const loader = await load([row('PTEN')]);
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await loader('PTEN')).status).toBe('ready');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([
    [new DOMException('timeout', 'TimeoutError'), 'timed out'],
    [new TypeError('fetch failed'), 'could not be reached'],
    [new SyntaxError('bad JSON'), 'invalid dosage table'],
  ])('keeps transport and parsing diagnostics distinct', async (error, message) => {
    const loader = await load([row('PTEN')]);
    vi.mocked(fetch).mockRejectedValue(error);
    const failed = await loader('NAE1');
    expect(failed.status).toBe('error');
    expect(failed.message).toContain(message);
    expect(failed.message).not.toContain('No ClinGen dosage curation');
    expect(failed.provenance).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
