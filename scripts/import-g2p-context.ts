import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildG2pSnapshot, G2P_DOWNLOAD_URL } from '../server/services/evidence-context/g2p.ts';
const args = process.argv.slice(2); const i = args.indexOf('--input');
const csv = i >= 0 ? await readFile(args[i + 1], 'utf8') : await (async () => {
  const response = await fetch(G2P_DOWNLOAD_URL, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`G2P HTTP ${response.status}`);
  return response.text();
})();
const snapshot = buildG2pSnapshot(csv, { source: 'Gene2Phenotype', url: G2P_DOWNLOAD_URL,
  licence: 'EMBL-EBI Terms of Use; source attribution requested', release: null,
  retrievedAt: new Date().toISOString(), timestampBasis: i >= 0 ? 'local-import' : 'download', sha256: createHash('sha256').update(csv).digest('hex') });
const target = path.resolve(process.env.G2P_CONTEXT_PATH ?? 'data/g2p-context.json');
await mkdir(path.dirname(target), { recursive: true });
const temporary = `${target}.${process.pid}.tmp`;
try {
  await writeFile(temporary, JSON.stringify(snapshot) + '\n'); await rename(temporary, target);
} finally { await rm(temporary, { force: true }); }
console.log(JSON.stringify({ path: target, records: snapshot.rowCount, genes: Object.keys(snapshot.genes).length, sha256: snapshot.provenance.sha256 }));
