import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModelOrganisms } from './modelOrganisms';
import { resetAllianceReleaseCache } from './allianceRelease';
afterEach(() => { vi.unstubAllGlobals(); resetAllianceReleaseCache(); });
const row = (id: string, symbol: string, taxon: string, name: string, subject = 'HGNC:10004') => ({ stringencyFilter: 'stringent', geneToGeneOrthologyGenerated: {
  subjectGene: { primaryExternalId: subject }, objectGene: { primaryExternalId: id, geneSymbol: { displayText: symbol }, taxon: { curie: taxon, name } },
  isBestScore: { name: 'Yes' }, isBestScoreReverse: { name: 'No' }, confidence: { name: 'high' }, predictionMethodsMatched: [{}, {}] } });
function mock(opts: { rows?: unknown[]; total?: number; impc?: 'ok' | 'down'; hgnc?: unknown[]; release?: 'ok' | 'down' } = {}) {
  const rows = opts.rows ?? [row('MGI:1338824', 'Rgs9', 'NCBITaxon:10090', 'Mus musculus'), row('ZFIN:1', 'rgs9a', 'NCBITaxon:7955', 'Danio rerio')];
  const fetch = vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes('genenames')) return new Response(JSON.stringify({ response: { numFound: 1, docs: opts.hgnc ?? [{ hgnc_id: 'HGNC:10004', symbol: decodeURIComponent(url.split('/').pop()!), status: 'Approved' }] } }));
    if (url.includes('releaseInfo')) return opts.release === 'down' ? new Response('x', { status: 503 }) : new Response(JSON.stringify({ releaseVersion: '9.1.0', releaseDate: '2026-09-02T04:59:38.733+00:00' }));
    if (url.includes('alliancegenome')) return new Response(JSON.stringify({ results: rows, total: opts.total ?? rows.length }));
    if (opts.impc === 'down') return new Response('x', { status: 503 });
    return new Response(JSON.stringify({ response: { numFound: 1, docs: [{ mgi_accession_id: 'MGI:1338824', marker_symbol: 'Rgs9', phenotyping_data_available: true,
      significant_top_level_mp_terms: ['vision/eye phenotype'], not_significant_top_level_mp_terms: ['muscle phenotype'] }] } }));
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
describe('model-organism adapter', () => {
  it('reads exact identity, orthologs with nested best-score flags and the IMPC screen', async () => {
    const fetch = mock(); const result = await loadModelOrganisms('RGS9');
    expect(result).toMatchObject({ status: 'ready', hgncId: 'HGNC:10004', impc: { status: 'ready', screens: [{ symbol: 'Rgs9', significant: ['vision/eye phenotype'] }] } });
    expect(result.orthologs[0]).toMatchObject({ species: 'Mouse', bestForward: true, bestReverse: false, methodCount: 2 });
    expect(result.provenance).toHaveLength(2);
    expect(result.provenance[0].release).toBe('9.1.0 (2026-09-02)');
    await loadModelOrganisms('RGS9'); expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('leaves the Alliance release unreported, without failing the read, when the release lookup is down', async () => {
    mock({ release: 'down' }); const result = await loadModelOrganisms('RGS9B');
    expect(result.status).toBe('ready'); expect(result.provenance[0].release).toBeNull();
  });
  it('does not resolve aliases and reports not-found', async () => {
    mock({ hgnc: [{ hgnc_id: 'HGNC:1', symbol: 'OTHER', status: 'Approved' }] });
    expect(await loadModelOrganisms('ALIAS1')).toMatchObject({ status: 'not-found', orthologs: [] });
  });
  it('fails visibly on a truncated page or foreign subject instead of reporting no ortholog', async () => {
    mock({ total: 5 }); expect((await loadModelOrganisms('TRUNC1')).status).toBe('error');
    mock({ rows: [row('MGI:9', 'x', 'NCBITaxon:10090', 'Mus musculus', 'HGNC:999')] }); expect((await loadModelOrganisms('FOREIGN1')).status).toBe('error');
  });
  it('keeps orthologs when IMPC is down and does not cache the partial result', async () => {
    const fetch = mock({ impc: 'down' }); const first = await loadModelOrganisms('PART1');
    expect(first).toMatchObject({ status: 'ready', impc: { status: 'error' } }); expect(first.orthologs).toHaveLength(2);
    await loadModelOrganisms('PART1'); expect(fetch.mock.calls.filter(c => String(c[0]).includes('genenames'))).toHaveLength(2);
  });
  it('treats a complete empty ortholog list as ready with no mouse screen', async () => {
    mock({ rows: [] }); expect(await loadModelOrganisms('NOORTH1')).toMatchObject({ status: 'ready', orthologs: [], impc: null });
  });
});
