import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { pextResponseSchema, type PextResponse } from '../../../src/shared/pext.ts';
import { governedFetch } from "../infra/http-client.ts";

const URL = 'https://gnomad.broadinstitute.org/api';
const QUERY = 'query($s:String!){ gene(gene_symbol:$s, reference_genome:GRCh38){ gene_id symbol chrom pext { flags regions { start stop mean tissues { tissue value } } } } }';
const schema = z.object({ data: z.object({ gene: z.object({ gene_id: z.string(), symbol: z.string(), chrom: z.string(),
  pext: z.object({ flags: z.array(z.string()), regions: z.array(z.unknown()) }).nullable() }).nullable() }), errors: z.unknown().optional() });
const cache = new LRUCache<string, PextResponse>({ max: 300, ttl: 24 * 60 * 60 * 1000 });
const flights = new Map<string, Promise<PextResponse>>();
const empty = (gene: string, status: PextResponse['status'], message: string | null): PextResponse => ({ gene, status, geneId: null, chrom: null, flags: [], regions: [], provenance: null, message });

export async function loadPext(gene: string): Promise<PextResponse> {
  const hit = cache.get(gene); if (hit) return hit;
  const running = flights.get(gene); if (running) return running;
  const task = (async (): Promise<PextResponse> => {
    try {
      const response = await governedFetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: QUERY, variables: { s: gene } }), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text(); const body = schema.parse(JSON.parse(raw));
      if (body.errors) {
        if (JSON.stringify(body.errors).includes('Gene not found')) return empty(gene, 'not-found', 'No gnomAD GRCh38 gene with this exact symbol.');
        throw new Error('GraphQL error');
      }
      const g = body.data.gene;
      if (!g || g.symbol !== gene) return empty(gene, 'not-found', 'No gnomAD GRCh38 gene with this exact symbol.');
      const provenance = { source: 'gnomAD pext', url: URL, licence: 'gnomAD data are open (ODC-By 1.0)', release: 'gnomAD v4 / GTEx v10', retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), timestampBasis: 'download' as const };
      const result = pextResponseSchema.parse(g.pext
        ? { gene, status: 'ready', geneId: g.gene_id, chrom: g.chrom, flags: g.pext.flags, regions: g.pext.regions, provenance, message: null }
        : { gene, status: 'no-pext', geneId: g.gene_id, chrom: g.chrom, flags: [], regions: [], provenance, message: 'gnomAD has no pext for this gene. That is not a statement about its expression.' });
      cache.set(gene, result); return result;
    } catch { return empty(gene, 'error', 'gnomAD did not return a complete, valid pext response.'); }
  })().finally(() => { flights.delete(gene); });
  flights.set(gene, task); return task;
}
