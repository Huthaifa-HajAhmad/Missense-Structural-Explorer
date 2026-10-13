import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { adultExpressionResponseSchema, type AdultExpressionResponse } from '../../../src/shared/expressionModels.ts';
import { governedFetch } from "../infra/http-client.ts";
const BASE = 'https://gtexportal.org/api/v2';
const DATASET = 'gtex_v10';
const paging = z.object({ totalNumberOfItems: z.number().int(), numberOfPages: z.number().int() });
const geneSchema = z.object({ data: z.array(z.object({ geneSymbol: z.string(), gencodeId: z.string(), gencodeVersion: z.string(), genomeBuild: z.string() })), paging_info: paging });
const expressionSchema = z.object({ data: z.array(z.object({
  median: z.number().finite().nonnegative(), tissueSiteDetailId: z.string(), datasetId: z.string(),
  gencodeId: z.string(), geneSymbol: z.string(), unit: z.literal('TPM'),
})), paging_info: paging });
const tissueSchema = z.object({ data: z.array(z.object({
  tissueSiteDetailId: z.string(), tissueSiteDetail: z.string(), datasetId: z.string(),
  ontologyId: z.string().nullable().optional(), samplingSite: z.string().nullable().optional(),
  rnaSeqSampleSummary: z.object({ totalCount: z.number().int().nonnegative() }).nullable().optional(),
})), paging_info: paging });
const cache = new LRUCache<string, AdultExpressionResponse>({ max: 500, ttl: 24 * 60 * 60 * 1000 });
const flights = new Map<string, Promise<AdultExpressionResponse>>();
async function read(url: URL) {
  const response = await governedFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`GTEx HTTP ${response.status}`);
  const raw = await response.text(); return { raw, data: JSON.parse(raw) as unknown };
}
function complete<T>(response: { data: T[]; paging_info: { totalNumberOfItems: number; numberOfPages: number } }) {
  if (response.paging_info.numberOfPages > 1 || response.data.length !== response.paging_info.totalNumberOfItems) throw new Error('Incomplete GTEx response');
  return response.data;
}
export async function fetchAdultExpression(gene: string): Promise<AdultExpressionResponse> {
  const key = `${DATASET}|v39|${gene}`;
  const hit = cache.get(key); if (hit) return hit;
  const running = flights.get(key); if (running) return running;
  const task = (async (): Promise<AdultExpressionResponse> => {
    try {
      const geneUrl = new URL(`${BASE}/reference/gene`);
      geneUrl.search = new URLSearchParams({ geneId: gene, gencodeVersion: 'v39', genomeBuild: 'GRCh38/hg38' }).toString();
      const reference = await read(geneUrl);
      const candidates = complete(geneSchema.parse(reference.data)).filter(g => g.geneSymbol === gene && g.gencodeVersion === 'v39' && g.genomeBuild === 'GRCh38/hg38');
      if (!candidates.length) return { gene, status: 'not-found', gencodeId: null, tissues: [], provenance: null, message: 'No exact gene identity in the GTEx v10 reference.' };
      if (candidates.length !== 1) throw new Error('Ambiguous GTEx gene identity');
      const gencodeId = candidates[0].gencodeId;
      const expressionUrl = new URL(`${BASE}/expression/medianGeneExpression`);
      expressionUrl.search = new URLSearchParams({ gencodeId, datasetId: DATASET, itemsPerPage: '250' }).toString();
      const tissueUrl = new URL(`${BASE}/dataset/tissueSiteDetail`);
      tissueUrl.search = new URLSearchParams({ datasetId: DATASET, itemsPerPage: '250' }).toString();
      const [expression, tissue] = await Promise.all([read(expressionUrl), read(tissueUrl)]);
      const values = complete(expressionSchema.parse(expression.data));
      const metadata = complete(tissueSchema.parse(tissue.data));
      if (values.some(v => v.datasetId !== DATASET || v.gencodeId !== gencodeId || v.geneSymbol !== gene) || metadata.some(t => t.datasetId !== DATASET)) throw new Error('GTEx identity mismatch');
      if (new Set(values.map(v => v.tissueSiteDetailId)).size !== values.length || new Set(metadata.map(t => t.tissueSiteDetailId)).size !== metadata.length) throw new Error('Duplicate GTEx tissue');
      if (values.some(v => !metadata.some(t => t.tissueSiteDetailId === v.tissueSiteDetailId))) throw new Error('Unresolved GTEx tissue metadata');
      const response = adultExpressionResponseSchema.parse({ gene, status: values.length ? 'ready' : 'not-found', gencodeId,
        tissues: metadata.map(t => ({ id: t.tissueSiteDetailId, label: t.tissueSiteDetail,
          ontologyId: t.ontologyId ?? null, value: values.find(v => v.tissueSiteDetailId === t.tissueSiteDetailId)?.median ?? null,
          unit: 'TPM', sampleCount: t.rnaSeqSampleSummary?.totalCount ?? null, samplingSite: t.samplingSite ?? null })),
        provenance: { source: 'GTEx', url: expressionUrl.href, licence: 'GTEx portal data-use policy', release: 'gtex_v10 / GENCODE v39', retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update([reference.raw, expression.raw, tissue.raw].join('\n')).digest('hex') },
        message: values.length ? null : 'No gene-expression rows returned; this is not a detection call.' });
      cache.set(key, response); return response;
    } catch { return { gene, status: 'error', gencodeId: null, tissues: [], provenance: null, message: 'GTEx did not return a complete, valid gene-expression response.' }; }
  })().finally(() => { flights.delete(key); });
  flights.set(key, task); return task;
}
