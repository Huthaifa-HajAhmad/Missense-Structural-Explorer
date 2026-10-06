import { DatabaseSync } from 'node:sqlite';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { developmentalGroupSchema, developmentalCountsSchema, developmentalExpressionResponseSchema, type DevelopmentalExpressionResponse } from '../../../src/shared/developmentalExpression.ts';
import { contextProvenanceSchema } from '../../../src/shared/diseaseFrame.ts';
export const dgtexManifestSchema = z.object({
  schemaVersion: z.literal(1), geneCount: z.number().int().positive(), coverage: z.array(developmentalGroupSchema),
  counts: developmentalCountsSchema, reference: z.literal('GENCODE v47 / GRCh38'),
  statistic: z.literal('median of within-donor median TPM'), provenance: contextProvenanceSchema,
  files: z.array(z.object({ kind: z.string(), url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
}).superRefine((m, ctx) => {
  const identities = m.coverage.map(g => `${g.tissueId}|${g.tissue}|${g.cohortId}`);
  if (new Set(identities).size !== identities.length || m.coverage.reduce((n, g) => n + g.sampleCount, 0) !== m.counts.includedSamples
    || m.counts.includedSamples + m.counts.excludedSamples + m.counts.wgsSamples !== m.counts.metadataSamples
    || m.counts.includedDonors > m.counts.metadataDonors || m.coverage.some(g => g.donorCount > m.counts.includedDonors)
    || m.files.length !== 4 || new Set(m.files.map(f => f.kind)).size !== 4
    || ['samples', 'subjects', 'dictionary', 'tpm'].some(kind => !m.files.some(f => f.kind === kind)))
    ctx.addIssue({ code: 'custom', message: 'Incomplete or inconsistent developmental manifest' });
});
export async function loadDevelopmentalExpression(gene: string): Promise<DevelopmentalExpressionResponse> {
  const empty = { gene, gencodeId: null, observations: [], counts: null, provenance: null };
  let db: DatabaseSync | null = null;
  try {
    const target = path.resolve(process.env.DGTEX_CONTEXT_PATH ?? 'data/dgtex-context.sqlite');
    await stat(target);
    // Short-lived read handle permits explicit operator replacement on Windows.
    db = new DatabaseSync(target, { readOnly: true });
    const metadata = db.prepare('SELECT json FROM metadata WHERE id=1').get() as { json: string } | undefined;
    const manifest = dgtexManifestSchema.parse(JSON.parse(metadata?.json ?? 'null'));
    const count = db.prepare('SELECT COUNT(*) AS n FROM genes').get() as { n: number };
    if (count.n !== manifest.geneCount) throw new Error('Developmental gene count mismatch');
    const rows = db.prepare('SELECT id, medians FROM genes WHERE symbol=? LIMIT 2').all(gene) as { id: string; medians: string }[];
    if (rows.length > 1) throw new Error('Ambiguous gene symbol in GENCODE v47');
    if (!rows.length) return { ...empty, status: 'not-found', counts: manifest.counts, provenance: manifest.provenance,
      message: 'No exact gene symbol in this GENCODE v47 snapshot; no absence-of-expression claim.' };
    if (!/^ENSG\d{11}\.\d+$/.test(rows[0].id)) throw new Error('Invalid reference gene');
    const values = z.array(z.number().finite().nonnegative()).parse(JSON.parse(rows[0].medians));
    if (values.length !== manifest.coverage.length) throw new Error('Incomplete gene coverage');
    return developmentalExpressionResponseSchema.parse({ gene, status: 'ready', gencodeId: rows[0].id,
      observations: manifest.coverage.map((group, i) => ({ ...group, value: values[i], unit: 'TPM' })),
      counts: manifest.counts, provenance: manifest.provenance, message: null });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { ...empty, status: missing ? 'not-installed' : 'error', message: missing
      ? 'A dGTEx V1 snapshot is not installed on this server.' : 'The dGTEx snapshot could not be read or resolved unambiguously.' };
  } finally { db?.close(); }
}
