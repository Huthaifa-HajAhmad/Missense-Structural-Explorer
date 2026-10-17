import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { DOSAGE_SOURCE_URL, dosageResponseSchema, parseDosageScore, type DosageResponse } from '../../../src/shared/dosageSensitivity.ts';
import { fetchWithRetry } from "../infra/http-client.ts";

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

class DosageTableError extends Error {}
class DosageHttpError extends Error {
  constructor(public status: number) { super(`ClinGen dosage HTTP ${status}`); }
}

/** A failed lookup must never masquerade as an uncurated gene. Keep diagnostics useful without
 * exposing response bodies or parser internals to the reader. */
function failureMessage(error: unknown): string {
  if (error instanceof DosageTableError) return error.message;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 'ClinGen returned an invalid dosage table. Curation availability could not be checked.';
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) return 'The ClinGen dosage request timed out. Curation availability could not be checked.';
  const status = error instanceof DosageHttpError ? error.status : (error as { statusCode?: number } | null)?.statusCode;
  if (status && status >= 400) return `ClinGen dosage request failed (HTTP ${status}). Curation availability could not be checked.`;
  return 'The ClinGen dosage service could not be reached. Curation availability could not be checked.';
}

async function loadTable(): Promise<Table> {
  const hit = cache.get('table'); if (hit) return hit;
  flight ??= (async () => {
    // At most two attempts within one 30s budget, below the client's 40s deadline. The shared
    // client honours rate limits/refusals; invalid or incomplete bodies are never retried here.
    const response = await fetchWithRetry(DOSAGE_SOURCE_URL, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000),
      timeout: 12000, deadlineAt: Date.now() + 30000,
    }, 2, 500);
    if (!response.ok) throw new DosageHttpError(response.status);
    const raw = await response.text(); const table = tableSchema.parse(JSON.parse(raw));
    if (!table.rows.length || table.rows.length !== table.total) throw new DosageTableError('ClinGen returned an incomplete dosage table. Curation availability could not be checked.');
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
    const matches = table.rows.filter(r => r.symbol === gene);
    if (!matches.length) return dosageResponseSchema.parse({ gene, status: 'not-found', record: null, provenance,
      message: `No ClinGen dosage curation is listed for ${gene} in the complete source table. This does not mean copy-number changes are tolerated.` });
    const row = matches[0];
    if (matches.length !== 1 || !/^HGNC:\d+$/.test(row.hgnc_id ?? '')) throw new DosageTableError('ClinGen returned an ambiguous or invalid gene identifier for this symbol. Curation availability could not be checked.');
    const score = (value: unknown, disease?: string | null, id?: string | null, history?: string | null) =>
      ({ ...parseDosageScore(value), disease: disease || null, diseaseId: id && /^MONDO:\d+$/.test(id) ? id : null, history: history || null });
    return dosageResponseSchema.parse({ gene, status: 'ready', provenance, message: null, record: {
      symbol: row.symbol, geneId: row.hgnc_id, location: row.location ?? null,
      haploinsufficiency: score(row.haplo_assertion, row.haplo_disease, row.haplo_mondo ?? row.haplo_disease_id, row.haplo_history),
      triplosensitivity: score(row.triplo_assertion, row.triplo_disease, row.triplo_mondo ?? row.triplo_disease_id, row.triplo_history),
      evaluatedAt: row.rawdate?.slice(0, 10) ?? null, reportUrl: `https://search.clinicalgenome.org/kb/gene-dosage/${row.hgnc_id}` } });
  } catch (error) { return { gene, status: 'error', record: null, provenance: null, message: failureMessage(error) }; }
}
