import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAlignment } from './alignment';
import { loadPext } from './pext';
afterEach(() => vi.unstubAllGlobals());
const side = (id: string, species: string, align: string, perc = 90) => ({ id, protein_id: `${id}P`, species, align_seq: align, perc_id: perc, perc_pos: perc });
const homology = (type: string, species: string, target: string) => ({ type, source: side('ENSG1', 'homo_sapiens', 'AB-CDE'), target: side(`G_${species}`, species, target) });
describe('alignment adapter', () => {
  it('keeps every in-scope ortholog with its type and drops paralogs and unlisted species', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'ENSG1', homologies: [
      homology('ortholog_one2one', 'mus_musculus', 'ABXCDE'), homology('ortholog_one2many', 'danio_rerio', 'AB--DE'),
      homology('within_species_paralog', 'homo_sapiens', 'ABCCDE'), homology('ortholog_one2one', 'gallus_gallus', 'ABXCDE')] }] }))));
    const r = await loadAlignment('ALN1');
    expect(r.status).toBe('ready'); expect(r.homologies.map(h => [h.species, h.type])).toEqual([['mus_musculus', '1:1'], ['danio_rerio', '1:many']]);
  });
  it('treats an unknown symbol as not-found and an HTTP failure as error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 }))); expect((await loadAlignment('ALN2')).status).toBe('not-found');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 }))); expect((await loadAlignment('ALN3')).status).toBe('error');
  });
  it('rejects unequal aligned lengths instead of mapping them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'ENSG1', homologies: [homology('ortholog_one2one', 'mus_musculus', 'ABX')] }] }))));
    expect((await loadAlignment('ALN4')).status).toBe('error');
  });
});
const gene = (pext: unknown, symbol = 'PX1') => new Response(JSON.stringify({ data: { gene: { gene_id: 'ENSG1', symbol, chrom: '17', pext } } }));
describe('pext adapter', () => {
  it('returns regions and flags, and separates a null pext from a missing gene', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gene({ flags: ['low_max_pext'], regions: [{ start: 1, stop: 5, mean: 0.1, tissues: [{ tissue: 'liver', value: 0.2 }] }] })));
    expect(await loadPext('PX1')).toMatchObject({ status: 'ready', chrom: '17', flags: ['low_max_pext'] });
    vi.stubGlobal('fetch', vi.fn(async () => gene(null, 'PX2'))); expect(await loadPext('PX2')).toMatchObject({ status: 'no-pext', regions: [] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'Gene not found' }], data: { gene: null } })))); expect((await loadPext('PX3')).status).toBe('not-found');
  });
  it('does not accept a different symbol and fails on an invalid region', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => gene({ flags: [], regions: [] }, 'OTHER'))); expect((await loadPext('PX4')).status).toBe('not-found');
    vi.stubGlobal('fetch', vi.fn(async () => gene({ flags: [], regions: [{ start: 9, stop: 1, mean: 0, tissues: [] }] }, 'PX5'))); expect((await loadPext('PX5')).status).toBe('error');
  });
});
