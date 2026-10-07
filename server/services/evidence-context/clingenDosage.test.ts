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
});
