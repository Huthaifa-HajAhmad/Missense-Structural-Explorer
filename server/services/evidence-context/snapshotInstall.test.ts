import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installOnce, resetInstallState, RETRY_AFTER_MS, autoInstallEnabled } from './snapshotInstall';
import { loadGeneDiseaseContext } from './store';
import { downloadGenccSnapshot } from './gencc';
import { loadMechanismContext } from './g2p';

const dirs: string[] = [];
const previous = process.env.GENCC_CONTEXT_PATH;
async function target() { const dir = await mkdtemp(path.join(tmpdir(), 'mse-install-')); dirs.push(dir); return path.join(dir, 'snapshot.json'); }
beforeEach(() => { resetInstallState(); vi.stubEnv('NODE_ENV', 'production'); });
afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  if (previous === undefined) delete process.env.GENCC_CONTEXT_PATH; else process.env.GENCC_CONTEXT_PATH = previous;
  await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

describe('first-use snapshot install', () => {
  it('is off under test and when switched off, so no test or air-gapped host reaches the network', () => {
    vi.stubEnv('NODE_ENV', 'test'); expect(autoInstallEnabled()).toBe(false);
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('EVIDENCE_CONTEXT_AUTO_INSTALL', '0'); expect(autoInstallEnabled()).toBe(false);
  });
  it('runs one download for concurrent callers and writes atomically', async () => {
    const file = await target(); const build = vi.fn(async () => ({ ok: true }));
    const results = await Promise.all([installOnce(file, build), installOnce(file, build), installOnce(file, build)]);
    expect(results).toEqual([true, true, true]); expect(build).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ ok: true });
    expect(await readdir(path.dirname(file))).toEqual(['snapshot.json']);   // no stray temp file
  });
  it('remembers a failure for 15 minutes instead of hammering a down source, then retries', async () => {
    const file = await target(); const build = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ ok: true });
    // A synthetic clock, not Date.now(): recording the failure at wall time put the retry boundary
    // 1 ms from the call that failed, and the scheduler overran it on CI.
    const t0 = 1_000_000;
    expect(await installOnce(file, build, t0)).toBe(false);
    expect(await installOnce(file, build, t0 + 1000)).toBe(false); expect(build).toHaveBeenCalledOnce();
    expect(await installOnce(file, build, t0 + RETRY_AFTER_MS - 1)).toBe(false); expect(build).toHaveBeenCalledOnce();
    expect(await installOnce(file, build, t0 + RETRY_AFTER_MS)).toBe(true); expect(build).toHaveBeenCalledTimes(2);
  });
  it('installs a MISSING GenCC snapshot on first request and never replaces an installed one', async () => {
    const file = await target(); process.env.GENCC_CONTEXT_PATH = file;
    const csv = 'uuid,gene_curie,gene_symbol,disease_curie,disease_title,moi_curie,moi_title,classification_title,submitter_title,submitter_curie,disease_original_curie,submitted_as_date,submitted_as_public_report_url\n1,HGNC:1,SOD1,MONDO:0007103,ALS1,HP:0000006,Dominant,Definitive,ClinGen,GENCC:1,,2026-01-01,\n';
    const fetchMock = vi.fn(async () => new Response(csv, { headers: { 'content-type': 'text/csv; charset=UTF-8', 'last-modified': 'Sun, 04 Oct 2026 06:01:50 GMT' } }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await loadGeneDiseaseContext('SOD1');
    expect(first.status).toBe('ready'); expect(first.frames).toHaveLength(1);
    expect(first.provenance?.release).toBe('Export of 2026-10-04');   // the source's own export date, not "not reported"
    await loadGeneDiseaseContext('SOD1'); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('falls back to the plain not-installed state when the download fails', async () => {
    const file = await target(); process.env.GENCC_CONTEXT_PATH = file;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })));
    expect((await loadGeneDiseaseContext('SOD1')).status).toBe('not-installed');
    await expect(downloadGenccSnapshot()).rejects.toThrow(/503/);
  });
  it('installs a MISSING G2P snapshot on first request through the same path', async () => {
    const file = await target(); process.env.G2P_CONTEXT_PATH = file;
    const header = ['g2p id', 'gene symbol', 'hgnc id', 'disease name', 'disease MONDO', 'allelic requirement', 'cross cutting modifier', 'confidence', 'molecular mechanism', 'molecular mechanism support', 'molecular mechanism categorisation', 'molecular mechanism evidence', 'variant consequence', 'variant types', 'publications', 'date of last review'].join(',');
    const csv = `${header}
G2P00001,SOD1,11179,ALS1,MONDO:0007103,monoallelic_autosomal,,definitive,gain of function,inferred,,,,,123,2024-01-01
`;
    const fetchMock = vi.fn(async () => new Response(csv, { headers: { 'content-type': 'text/csv' } }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await loadMechanismContext('SOD1');
    expect(first.status).toBe('ready'); expect(first.records).toHaveLength(1);
    await loadMechanismContext('SOD1'); expect(fetchMock).toHaveBeenCalledOnce();
    delete process.env.G2P_CONTEXT_PATH;
  });
});
