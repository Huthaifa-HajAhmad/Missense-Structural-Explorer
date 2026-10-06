import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadDevelopmentalExpression } from './dgtex';
const previous = process.env.DGTEX_CONTEXT_PATH; const dirs: string[] = [];
afterEach(async () => {
  if (previous === undefined) delete process.env.DGTEX_CONTEXT_PATH; else process.env.DGTEX_CONTEXT_PATH = previous;
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'mse-dgtex-test-')); dirs.push(dir);
  const target = path.join(dir, 'snapshot.sqlite'); process.env.DGTEX_CONTEXT_PATH = target; return target;
}
function install(target: string, medians = '[0]') {
  const db = new DatabaseSync(target);
  db.exec('CREATE TABLE genes (id TEXT, symbol TEXT, medians TEXT); CREATE TABLE metadata (id INTEGER, json TEXT)');
  db.prepare('INSERT INTO genes VALUES (?, ?, ?)').run('ENSG00000000001.1', 'TEST', medians);
  db.prepare('INSERT INTO metadata VALUES (1, ?)').run(JSON.stringify({ schemaVersion: 1, geneCount: 1,
    reference: 'GENCODE v47 / GRCh38', statistic: 'median of within-donor median TPM',
    files: ['samples', 'subjects', 'dictionary', 'tpm'].map(kind => ({ kind, url: 'https://gtexportal.org/', sha256: 'a'.repeat(64) })),
    counts: { metadataSamples: 3, includedSamples: 1, excludedSamples: 1, wgsSamples: 1, includedDonors: 1, metadataDonors: 2 },
    coverage: [{ tissueId: 'UBERON:0002107', tissue: 'Liver', cohortId: '1', cohort: 'Infant (0 to 2 years)', sampleCount: 1, donorCount: 1 }],
    provenance: { source: 'dGTEx', url: 'https://gtexportal.org/', licence: 'Portal terms', release: 'V1', retrievedAt: '2026-10-06', sha256: 'a'.repeat(64) } }));
  db.close();
}
describe('developmental snapshot availability and identity', () => {
  it('rejects a snapshot whose stored gene count contradicts the manifest', async () => {
    const target = await fixture(); install(target);
    const db = new DatabaseSync(target); db.exec('DELETE FROM genes'); db.close();
    expect((await loadDevelopmentalExpression('TEST')).status).toBe('error');
  });
  it('distinguishes missing and corrupt installation from no gene and measured zero', async () => {
    const target = await fixture();
    expect((await loadDevelopmentalExpression('TEST')).status).toBe('not-installed');
    await writeFile(target, 'corrupt'); expect((await loadDevelopmentalExpression('TEST')).status).toBe('error');
    await rm(target); install(target);
    const result = await loadDevelopmentalExpression('TEST');
    expect(result.status).toBe('ready'); expect(result.observations[0].value).toBe(0);
    expect(result.observations[0].cohort).toBe('Infant (0 to 2 years)');
    expect((await loadDevelopmentalExpression('UNKNOWN')).status).toBe('not-found');
  });
  it('rejects incomplete values and ambiguous symbols rather than choosing a reference', async () => {
    const target = await fixture(); install(target, '[]');
    expect((await loadDevelopmentalExpression('TEST')).status).toBe('error');
    const db = new DatabaseSync(target); db.prepare('INSERT INTO genes VALUES (?, ?, ?)').run('ENSG00000000002.1', 'TEST', '[1]'); db.close();
    expect((await loadDevelopmentalExpression('TEST')).status).toBe('error');
  });
});
