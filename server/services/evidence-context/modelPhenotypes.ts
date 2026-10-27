import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { buildUphenoIndex, modelPhenotypesResponseSchema, type ModelPhenotypesResponse, type SpeciesPhenotypes } from '../../../src/shared/modelPhenotypes.ts';
import { loadOrthologCore } from './modelOrganisms.ts';
import { loadAllianceRelease } from './allianceRelease.ts';
import { governedFetch } from "../infra/http-client.ts";

const ALLIANCE = 'https://www.alliancegenome.org/api/gene/';
const UPHENO_URL = 'https://raw.githubusercontent.com/obophenotype/upheno/master/mappings/upheno-species-independent.sssom.tsv';
// Organisms whose Alliance phenotype terms uPheno covers. Yeast and others are not listed here.
const IN_SCOPE = ['NCBITaxon:10090', 'NCBITaxon:10116', 'NCBITaxon:7955', 'NCBITaxon:8364', 'NCBITaxon:8355', 'NCBITaxon:7227', 'NCBITaxon:6239'];
const record = z.object({
  phenotypeStatement: z.string().nullable().optional(),
  primaryAnnotations: z.array(z.object({ uniqueId: z.string().optional() }).passthrough()).default([]),
});
const page = z.object({ results: z.array(record).default([]), total: z.number().int().nonnegative() });
const cache = new LRUCache<string, ModelPhenotypesResponse>({ max: 300, ttl: 24 * 60 * 60 * 1000 });
const flights = new Map<string, Promise<ModelPhenotypesResponse>>();
type Upheno = { index: ReturnType<typeof buildUphenoIndex>; sha: string; at: string; expires: number };
let uphenoCache: Upheno | null = null;
let uphenoFlight: Promise<Upheno> | null = null;

async function uphenoIndex() {
  if (uphenoCache && uphenoCache.expires > Date.now()) return uphenoCache;
  uphenoFlight ??= (async () => {
    const response = await governedFetch(UPHENO_URL, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text(); const index = buildUphenoIndex(raw);
    if (!raw.includes('crossSpeciesExactMatch')) throw new Error('Unexpected uPheno table');
    uphenoCache = { index, sha: createHash('sha256').update(raw).digest('hex'), at: new Date().toISOString(), expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    return uphenoCache;
  })().finally(() => { uphenoFlight = null; });
  return uphenoFlight;
}

export async function loadModelPhenotypes(gene: string): Promise<ModelPhenotypesResponse> {
  const hit = cache.get(gene); if (hit) return hit;
  const running = flights.get(gene); if (running) return running;
  const task = (async (): Promise<ModelPhenotypesResponse> => {
    const fail = (status: 'not-found' | 'error', message: string): ModelPhenotypesResponse => ({ gene, status, species: [], mapping: 'unavailable', provenance: [], message });
    try {
    // Everything independent starts at once: the uPheno table (a large download, cached a week) and the
    // Alliance release do not depend on the gene, and the ortholog list does not wait for the IMPC
    // screen. They used to run one after another, which made this the slowest Evidence source.
    const uphenoRead = uphenoIndex().catch(() => null);
    const release = loadAllianceRelease();
    let models: Awaited<ReturnType<typeof loadOrthologCore>>;
    try { models = await loadOrthologCore(gene); }
    catch { return fail('error', 'Orthologs were not available, so model phenotypes cannot be listed.'); }
    if (models.status === 'not-found') return fail('not-found', models.message);
    const targets = models.orthologs.filter(o => IN_SCOPE.includes(o.taxonId));
    // Seven covered organisms, a handful of orthologs: one concurrent round, not serial batches of four.
    const [upheno, read] = await Promise.all([uphenoRead, Promise.all(targets.map(async (o): Promise<{ row: SpeciesPhenotypes; raw: string }> => {
        const base = { taxonId: o.taxonId, species: o.species, orthologId: o.id, symbol: o.symbol };
        try {
          const response = await governedFetch(`${ALLIANCE}${encodeURIComponent(o.id)}/phenotypes?limit=2000`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const raw = await response.text();
          const body = page.parse(JSON.parse(raw));
          if (body.results.length !== body.total) throw new Error('Incomplete phenotype page');
          const phenotypes = body.results.flatMap(r => {
            const ids = r.primaryAnnotations.map(a => (a.uniqueId ?? '').split('|'));
            const term = ids.map(p => p.find(x => /^(MP|ZP|WBPhenotype|FBcv|XPO|RDO|APO|HP):\w+/.test(x))).find(Boolean);
            if (!term || !r.phenotypeStatement) return [];
            return [{ termId: term, statement: r.phenotypeStatement, annotations: r.primaryAnnotations.length || 1,
              models: new Set(ids.map(p => p[0]).filter(Boolean)).size, humanTerms: [] as string[] }];
          }).sort((a, b) => a.statement.localeCompare(b.statement));
          return { row: { ...base, status: 'ready', total: body.total, phenotypes }, raw };
        } catch { return { row: { ...base, status: 'error', total: 0, phenotypes: [] }, raw: '' }; }
      }))]);
    // Human matches are attached once the uPheno table is in; the species reads did not wait for it.
    // The hash still covers the raw pages in ortholog order.
    const species = read.map(r => r.row);
    const rawAll = read.map(r => r.raw).join('');
    if (upheno) for (const s of species) for (const ph of s.phenotypes) ph.humanTerms = upheno.index.humanTerms(ph.termId);
    const result = modelPhenotypesResponseSchema.parse({ gene, status: 'ready', species, mapping: upheno ? 'available' : 'unavailable',
      provenance: [
        { source: 'Alliance of Genome Resources phenotypes', url: 'https://www.alliancegenome.org/', licence: 'CC BY 4.0', release: await release, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(rawAll).digest('hex'), timestampBasis: 'download' },
        ...(upheno ? [{ source: 'uPheno cross-species exact matches', url: UPHENO_URL, licence: 'CC BY 4.0', release: null, retrievedAt: upheno.at, sha256: upheno.sha, timestampBasis: 'download' as const }] : []),
      ], message: species.length ? null : 'No ortholog in a covered organism.' });
    if (species.every(s => s.status === 'ready') && upheno) cache.set(gene, result);
    return result;
    } catch { return fail('error', 'Model phenotypes could not be read.'); }
  })().finally(() => { flights.delete(gene); });
  flights.set(gene, task); return task;
}
