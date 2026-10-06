// Bounded contract probes; run manually, never as part of the analysis pipeline.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const urls = [
  'https://thegencc.org/download/action/submissions-export-csv',
  'https://search.clinicalgenome.org/kb/gene-validity/download',
  'https://www.ebi.ac.uk/gene2phenotype/api/gene/FGFR3/',
  'https://www.ebi.ac.uk/gene2phenotype/api/panel/all/download/',
];
const results = await Promise.all(urls.map(async url => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const payload = await r.text();
    return { url, status: r.status, contentType: r.headers.get('content-type'),
      accessedAt: new Date().toISOString(), bytes: Buffer.byteLength(payload),
      sha256: createHash('sha256').update(payload).digest('hex'), head: payload.slice(0, 1300) };
  } catch (e) { return { url, accessedAt: new Date().toISOString(), error: e.message }; }
}));
await mkdir('doc/research', { recursive: true });
await writeFile('doc/research/evidence-context-probes.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
