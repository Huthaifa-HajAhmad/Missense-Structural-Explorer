import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { contextProvenanceSchema, mechanismContextSchema, type ContextProvenance } from '../../../src/shared/diseaseFrame.ts';
import { mechanismRecordSchema, type MechanismRecord } from '../../../src/shared/mechanismContext.ts';
import { parseCsv } from './gencc.ts';
export const G2P_DOWNLOAD_URL = 'https://www.ebi.ac.uk/gene2phenotype/api/panel/all/download/';
export const g2pSnapshotSchema = z.object({ schemaVersion: z.literal(1), provenance: contextProvenanceSchema,
  rowCount: z.number().int().positive(), genes: z.record(z.string(), z.array(mechanismRecordSchema)) }).superRefine((snapshot, ctx) => {
  const ids = new Set<string>(); let count = 0;
  for (const [gene, records] of Object.entries(snapshot.genes)) for (const record of records) {
    if (record.gene !== gene || ids.has(record.id)) ctx.addIssue({ code: 'custom', message: 'G2P gene index or record identity mismatch' });
    ids.add(record.id); count++;
  }
  if (count !== snapshot.rowCount) ctx.addIssue({ code: 'custom', message: 'G2P record count mismatch' });
});
export function buildG2pSnapshot(csv: string, provenance: ContextProvenance) {
  const [header, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''));
  const required = ['g2p id', 'gene symbol', 'hgnc id', 'disease name', 'disease MONDO', 'allelic requirement', 'cross cutting modifier', 'confidence',
    'molecular mechanism', 'molecular mechanism support', 'molecular mechanism categorisation', 'molecular mechanism evidence',
    'variant consequence', 'variant types', 'publications', 'date of last review'];
  if (!header || required.some(k => !header.includes(k)) || new Set(header).size !== header.length) throw new Error('G2P CSV schema changed');
  const genes: Record<string, MechanismRecord[]> = Object.create(null); const ids = new Set<string>();
  for (const row of rows) {
    if (row.length !== header.length) throw new Error('G2P column count mismatch');
    const r = Object.fromEntries(header.map((key, i) => [key, row[i].trim()]));
    if (ids.has(r['g2p id'])) throw new Error('Duplicate G2P record'); ids.add(r['g2p id']);
    const record = mechanismRecordSchema.parse({ id: r['g2p id'], geneId: `HGNC:${r['hgnc id']}`, gene: r['gene symbol'],
      diseaseId: r['disease MONDO'] || null, diseaseLabel: r['disease name'], allelicRequirement: r['allelic requirement'],
      modifier: r['cross cutting modifier'], confidence: r.confidence, mechanism: r['molecular mechanism'], support: r['molecular mechanism support'],
      categorisation: r['molecular mechanism categorisation'], evidence: r['molecular mechanism evidence'], consequence: r['variant consequence'],
      variantTypes: r['variant types'], publications: r.publications.split(';').map(v => v.trim()).filter(Boolean), reviewedAt: r['date of last review'] || null });
    (genes[record.gene] ??= []).push(record);
  }
  return g2pSnapshotSchema.parse({ schemaVersion: 1, rowCount: rows.length, genes, provenance });
}
let cached: { path: string; mtime: number; size: number; data: z.infer<typeof g2pSnapshotSchema> } | null = null;
export async function loadMechanismContext(gene: string): Promise<z.infer<typeof mechanismContextSchema>> {
  try {
    const target = path.resolve(process.env.G2P_CONTEXT_PATH ?? 'data/g2p-context.json'); const info = await stat(target);
    if (!cached || cached.path !== target || cached.mtime !== info.mtimeMs || cached.size !== info.size) {
      const data = g2pSnapshotSchema.parse(JSON.parse(await readFile(target, 'utf8')));
      cached = { path: target, mtime: info.mtimeMs, size: info.size, data };
    }
    return { status: 'ready', records: Object.hasOwn(cached.data.genes, gene) ? cached.data.genes[gene] : [], provenance: cached.data.provenance, message: null };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { status: missing ? 'not-installed' : 'error', records: [], provenance: null, message: missing
      ? 'A G2P snapshot is not installed.' : 'The G2P snapshot could not be read or validated.' };
  }
}
