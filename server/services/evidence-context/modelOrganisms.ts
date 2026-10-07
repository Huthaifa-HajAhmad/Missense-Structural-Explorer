import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { loadAllianceRelease } from './allianceRelease.ts';
import { modelOrganismResponseSchema, speciesLabel, type ImpcScreen, type ModelOrganismResponse, type Ortholog } from '../../../src/shared/modelOrganisms.ts';

const HGNC_URL = 'https://rest.genenames.org/fetch/symbol/';
const ALLIANCE_URL = 'https://www.alliancegenome.org/api/gene/';
const IMPC_URL = 'https://www.ebi.ac.uk/mi/impc/solr/gene/select';

const hgncSchema = z.object({ response: z.object({ numFound: z.number(), docs: z.array(z.object({ hgnc_id: z.string().regex(/^HGNC:\d+$/), symbol: z.string(), status: z.string() })) }) });
const name = z.object({ name: z.string() }).nullable().optional();
const orthologRow = z.object({
  stringencyFilter: z.string(),
  geneToGeneOrthologyGenerated: z.object({
    subjectGene: z.object({ primaryExternalId: z.string() }),
    objectGene: z.object({ primaryExternalId: z.string(), geneSymbol: z.object({ displayText: z.string() }),
      taxon: z.object({ curie: z.string(), name: z.string() }) }),
    isBestScore: name, isBestScoreReverse: name, confidence: name,
    predictionMethodsMatched: z.array(z.unknown()).optional(),
  }),
});
const allianceSchema = z.object({ results: z.array(orthologRow), total: z.number().int().nonnegative() });
const impcSchema = z.object({ response: z.object({ numFound: z.number().int(), docs: z.array(z.object({
  mgi_accession_id: z.string().regex(/^MGI:\d+$/), marker_symbol: z.string(),
  phenotype_status: z.string().nullable().optional(), phenotyping_data_available: z.boolean().nullable().optional(),
  embryo_data_available: z.boolean().nullable().optional(),
  significant_top_level_mp_terms: z.array(z.string()).optional(), not_significant_top_level_mp_terms: z.array(z.string()).optional(),
})) }) });

const cache = new LRUCache<string, ModelOrganismResponse>({ max: 500, ttl: 24 * 60 * 60 * 1000 });
const flights = new Map<string, Promise<ModelOrganismResponse>>();
async function read(url: string, accept = 'application/json') {
  const response = await fetch(url, { headers: { Accept: accept }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const raw = await response.text(); return { raw, data: JSON.parse(raw) as unknown, url };
}
const sha = (...parts: string[]) => createHash('sha256').update(parts.join('\n')).digest('hex');
const best = (v?: { name: string } | null) => v ? v.name === 'Yes' : null;

export async function loadModelOrganisms(gene: string): Promise<ModelOrganismResponse> {
  const hit = cache.get(gene); if (hit) return hit;
  const running = flights.get(gene); if (running) return running;
  const task = (async (): Promise<ModelOrganismResponse> => {
    const fail = (message: string): ModelOrganismResponse => ({ gene, status: 'error', hgncId: null, orthologs: [], impc: null, provenance: [], message });
    try {
      // Exact approved symbol only: aliases and previous symbols are not resolved by guess.
      const hgnc = await read(HGNC_URL + encodeURIComponent(gene));
      const doc = hgncSchema.parse(hgnc.data).response.docs.find(d => d.symbol === gene && d.status === 'Approved');
      if (!doc) return { gene, status: 'not-found', hgncId: null, orthologs: [], impc: null, provenance: [], message: 'No approved HGNC gene with this exact symbol.' };
      const alliance = await read(`${ALLIANCE_URL}${doc.hgnc_id}/orthologs`);
      const parsed = allianceSchema.parse(alliance.data);
      // A truncated page must never read as "no ortholog".
      if (parsed.results.length !== parsed.total) throw new Error('Incomplete orthology page');
      const rows = parsed.results.filter(r => r.stringencyFilter === 'stringent');
      if (rows.some(r => r.geneToGeneOrthologyGenerated.subjectGene.primaryExternalId !== doc.hgnc_id)) throw new Error('Orthology identity mismatch');
      const orthologs: Ortholog[] = rows.map(({ geneToGeneOrthologyGenerated: g }) => ({
        id: g.objectGene.primaryExternalId, symbol: g.objectGene.geneSymbol.displayText, taxonId: g.objectGene.taxon.curie,
        species: speciesLabel(g.objectGene.taxon.curie, g.objectGene.taxon.name),
        bestForward: best(g.isBestScore), bestReverse: best(g.isBestScoreReverse),
        confidence: g.confidence?.name ?? null, methodCount: g.predictionMethodsMatched?.length ?? 0,
      }));
      const provenance = [
        { source: 'Alliance of Genome Resources orthology', url: alliance.url, licence: 'CC BY 4.0', release: await loadAllianceRelease(), retrievedAt: new Date().toISOString(), sha256: sha(hgnc.raw, alliance.raw), timestampBasis: 'download' as const },
      ];
      let impc: ModelOrganismResponse['impc'] = null;
      const mouse = [...new Set(orthologs.filter(o => o.taxonId === 'NCBITaxon:10090' && /^MGI:\d+$/.test(o.id)).map(o => o.id))];
      if (mouse.length) {
        try {
          const query = `mgi_accession_id:(${mouse.map(id => `"${id}"`).join(' OR ')})`;
          const url = `${IMPC_URL}?${new URLSearchParams({ q: query, wt: 'json', rows: '10' })}`;
          const result = await read(url);
          const docs = impcSchema.parse(result.data).response.docs;
          const screens: ImpcScreen[] = docs.filter(d => mouse.includes(d.mgi_accession_id)).map(d => ({
            mgiId: d.mgi_accession_id, symbol: d.marker_symbol, phenotypeStatus: d.phenotype_status ?? null,
            phenotypingDataAvailable: d.phenotyping_data_available ?? null, embryoDataAvailable: d.embryo_data_available ?? null,
            significant: d.significant_top_level_mp_terms ?? [], notSignificant: d.not_significant_top_level_mp_terms ?? [],
          }));
          impc = { status: screens.length ? 'ready' : 'not-found', screens };
          provenance.push({ source: 'IMPC gene summary', url: result.url, licence: 'IMPC data-release terms (open access)', release: null, retrievedAt: new Date().toISOString(), sha256: sha(result.raw), timestampBasis: 'download' as const });
        } catch { impc = { status: 'error', screens: [] }; }
      }
      const response = modelOrganismResponseSchema.parse({ gene, status: 'ready', hgncId: doc.hgnc_id, orthologs, impc, provenance,
        message: orthologs.length ? null : 'No stringent ortholog in this Alliance response.' });
      // A partial result (IMPC down) is shown but not cached, so the next visit re-asks.
      if (impc?.status !== 'error') cache.set(gene, response);
      return response;
    } catch { return fail('Alliance of Genome Resources did not return a complete, valid orthology response.'); }
  })().finally(() => { flights.delete(gene); });
  flights.set(gene, task); return task;
}
