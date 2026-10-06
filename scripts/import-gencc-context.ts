/** Manual operator import: download once, validate fully, replace atomically. No scheduled mutation. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildGenccSnapshot, GENCC_DOWNLOAD_URL } from '../server/services/evidence-context/gencc.ts';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const payload = inputIndex >= 0 ? await readFile(args[inputIndex + 1], 'utf8') : await (async () => {
  const response = await fetch(GENCC_DOWNLOAD_URL, { signal: AbortSignal.timeout(90000), headers: { Accept: 'text/csv' } });
  if (!response.ok) throw new Error(`GenCC HTTP ${response.status}`);
  if (!(response.headers.get('content-type') ?? '').includes('text/csv')) throw new Error('GenCC did not return CSV');
  return response.text();
})();
const snapshot = buildGenccSnapshot(payload, {
  source: 'GenCC', url: GENCC_DOWNLOAD_URL, licence: 'CC0 1.0', release: null,
  retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(payload).digest('hex'),
  timestampBasis: inputIndex >= 0 ? 'local-import' : 'download',
});
const target = path.resolve(process.env.GENCC_CONTEXT_PATH ?? 'data/gencc-context.json');
await mkdir(path.dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.tmp`;
try {
  await writeFile(temporary, JSON.stringify(snapshot) + '\n');
  await rename(temporary, target);
} finally { await rm(temporary, { force: true }); }
console.log(JSON.stringify({ path: target, assertions: snapshot.rowCount, genes: Object.keys(snapshot.genes).length, sha256: snapshot.provenance.sha256 }));
