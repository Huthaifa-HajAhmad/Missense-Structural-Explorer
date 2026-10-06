import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadGeneDiseaseContext } from './store';
import { buildGenccSnapshot } from './gencc';

const previous = process.env.GENCC_CONTEXT_PATH;
const dirs: string[] = [];
afterEach(async () => {
  if (previous === undefined) delete process.env.GENCC_CONTEXT_PATH;
  else process.env.GENCC_CONTEXT_PATH = previous;
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function target() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mse-gencc-test-'));
  dirs.push(dir);
  return path.join(dir, 'snapshot.json');
}
describe('installed GenCC context', () => {
  it('distinguishes missing installation from corrupt data and recovers after installation', async () => {
    const file = await target();
    process.env.GENCC_CONTEXT_PATH = file;
    expect((await loadGeneDiseaseContext('TEST')).status).toBe('not-installed');
    await writeFile(file, '{"invalid":true}');
    expect((await loadGeneDiseaseContext('TEST')).status).toBe('error');
    const csv = 'uuid,gene_curie,gene_symbol,disease_curie,disease_title,moi_curie,moi_title,classification_title,submitter_title,submitter_curie,disease_original_curie,submitted_as_date,submitted_as_public_report_url\n1,HGNC:1,TEST,MONDO:0000001,Example,HP:0000006,Dominant,Strong,Submitter,GENCC:1,OMIM:123456,2026-01-01,\n';
    const snapshot = buildGenccSnapshot(csv, { source: 'GenCC', url: 'https://thegencc.org/download', licence: 'CC0', release: null, retrievedAt: '2026-10-06', sha256: 'a'.repeat(64) });
    await writeFile(file, JSON.stringify(snapshot));
    const [known, absent] = await Promise.all([loadGeneDiseaseContext('TEST'), loadGeneDiseaseContext('UNKNOWN')]);
    expect(known.status).toBe('ready');
    expect(known.frames).toHaveLength(1);
    expect(absent.status).toBe('ready');
    expect(absent.frames).toEqual([]);
    expect(absent.provenance).toEqual(snapshot.provenance);
    for (const gene of ['constructor', 'toString', 'valueOf']) expect((await loadGeneDiseaseContext(gene)).frames).toEqual([]);
  });
});
