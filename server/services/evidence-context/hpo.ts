import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { HPO_DISEASE_ID, hpoResponseSchema, type HpoResponse } from '../../../src/shared/hpoAnnotation.ts';
import { governedFetch } from "../infra/http-client.ts";

const BASE = 'https://ontology.jax.org/api/network/annotation/';
const termSchema = z.object({ id: z.string(), name: z.string(), category: z.string().optional(),
  metadata: z.object({ onset: z.string().nullable().optional(), frequency: z.string().nullable().optional(), sources: z.array(z.string()).optional() }).optional() });
const schema = z.object({
  disease: z.object({ id: z.string(), name: z.string(), mondoId: z.string().nullable().optional() }),
  categories: z.record(z.string(), z.array(termSchema)),
});
const cache = new LRUCache<string, HpoResponse>({ max: 1000, ttl: 24 * 60 * 60 * 1000 });
const flights = new Map<string, Promise<HpoResponse>>();
const none = (gene: string, status: HpoResponse['status'], message: string): HpoResponse => ({ gene, status, disease: null, terms: [], provenance: null, message });

/** `query` is the raw `?disease=` value: one or more OMIM/ORPHA ids, tried in order. HPO is not keyed by MONDO. */
export async function loadHpoAnnotation(gene: string, query: unknown): Promise<HpoResponse> {
  const ids = String(query ?? '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4);
  if (!ids.length || ids.some(id => !HPO_DISEASE_ID.test(id))) return none(gene, 'not-found', 'Choose a disease with an OMIM or Orphanet identifier to read its HPO annotations.');
  const key = `${gene}|${ids.join(',')}`;
  const hit = cache.get(key); if (hit) return hit;
  const running = flights.get(key); if (running) return running;
  const task = (async (): Promise<HpoResponse> => {
    try {
      for (const id of ids) {
        const url = BASE + id;
        const response = await governedFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
        if (response.status === 404) continue;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.text(); const body = schema.parse(JSON.parse(raw));
        const terms = Object.entries(body.categories).flatMap(([category, list]) => list.map(t => ({
          id: t.id, name: t.name, category, frequency: t.metadata?.frequency || null, onset: t.metadata?.onset || null, sources: t.metadata?.sources ?? [] })));
        const result = hpoResponseSchema.parse({ gene, status: 'ready', disease: { queried: id, id: body.disease.id, name: body.disease.name, mondoId: body.disease.mondoId ?? null }, terms,
          provenance: { source: 'Human Phenotype Ontology (JAX)', url, licence: 'HPO annotations: HPO licence, attribution required', release: null, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), timestampBasis: 'download' },
          message: terms.length ? null : 'This disease has no HPO term annotations.' });
        cache.set(key, result); return result;
      }
      const none404 = none(gene, 'not-found', 'HPO has no annotation record for this disease identifier.');
      cache.set(key, none404); return none404;
    } catch { return none(gene, 'error', 'HPO did not return a complete, valid annotation response.'); }
  })().finally(() => { flights.delete(key); });
  flights.set(key, task); return task;
}
