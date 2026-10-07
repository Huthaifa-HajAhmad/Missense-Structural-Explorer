import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { DOSAGE_SOURCE_URL, dosageResponseSchema, parseDosageScore, type DosageResponse } from '../../../src/shared/dosageSensitivity.ts';

/**
 * The ClinGen dosage API ignores `search` and returns every gene (~2,200 rows, ~2 MB), so the table
 * is fetched once, cached for a day and filtered by EXACT symbol. Nothing is name-matched.
 */
const rowSchema = z.object({
  symbol: z.string(), hgnc_id: z.string().nullable().optional(), location: z.string().nullable().optional(),
  haplo_assertion: z.unknown(), triplo_assertion: z.unknown(),
  haplo_disease: z.string().nullable().optional(), haplo_mondo: z.string().nullable().optional(), haplo_disease_id: z.string().nullable().optional(), triplo_disease_id: z.string().nullable().optional(), haplo_history: z.string().nullable().optional(),
  triplo_disease: z.string().nullable().optional(), triplo_mondo: z.string().nullable().optional(), triplo_history: z.string().nullable().optional(),
  rawdate: z.string().nullable().optional(),
});
const tableSchema = z.object({ total: z.number().int(), rows: z.array(rowSchema) });
type Table = { rows: z.infer<typeof rowSchema>[]; sha256: string; retrievedAt: string };
const cache = new LRUCache<string, Table>({ max: 1, ttl: 24 * 60 * 60 * 1000 });
let flight: Promise<Table> | null = null;

async function loadTable(): Promise<Table> {
  const hit = cache.get('table'); if (hit) return hit;
  flight ??= (async () => {
    const response = await fetch(DOSAGE_SOURCE_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`ClinGen dosage HTTP ${response.status}`);
    const raw = await response.text(); const table = tableSchema.parse(JSON.parse(raw));
    if (!table.rows.length || table.rows.length !== table.total) throw new Error('Incomplete ClinGen dosage table');
    const value = { rows: table.rows, sha256: createHash('sha256').update(raw).digest('hex'), retrievedAt: new Date().toISOString() };
    cache.set('table', value); return value;
  })().finally(() => { flight = null; });
  return flight;
}

export async function loadDosageContext(gene: string): Promise<DosageResponse> {
  try {
    const table = await loadTable();
    const provenance = { source: 'ClinGen dosage sensitivity', url: DOSAGE_SOURCE_URL, licence: 'ClinGen terms of use; attribution requested',
      release: null, retrievedAt: table.retrievedAt, sha256: table.sha256, timestampBasis: 'download' as const };
    const row = table.rows.find(r => r.symbol === gene && /^HGNC:\d+$/.test(r.hgnc_id ?? ''));
    if (!row) return dosageResponseSchema.parse({ gene, status: 'not-found', record: null, provenance,
      message: 'No ClinGen dosage curation for this exact gene symbol. This does not mean copy-number changes are tolerated.' });
    const score = (value: unknown, disease?: string | null, id?: string | null, history?: string | null) =>
      ({ ...parseDosageScore(value), disease: disease || null, diseaseId: id && /^MONDO:\d+$/.test(id) ? id : null, history: history || null });
    return dosageResponseSchema.parse({ gene, status: 'ready', provenance, message: null, record: {
      symbol: row.symbol, geneId: row.hgnc_id, location: row.location ?? null,
      haploinsufficiency: score(row.haplo_assertion, row.haplo_disease, row.haplo_mondo ?? row.haplo_disease_id, row.haplo_history),
      triplosensitivity: score(row.triplo_assertion, row.triplo_disease, row.triplo_mondo ?? row.triplo_disease_id, row.triplo_history),
      evaluatedAt: row.rawdate?.slice(0, 10) ?? null, reportUrl: `https://search.clinicalgenome.org/kb/gene-dosage/${row.hgnc_id}` } });
  } catch { return { gene, status: 'error', record: null, provenance: null, message: 'ClinGen did not return a complete, valid dosage table.' }; }
}
