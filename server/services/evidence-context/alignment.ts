import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { alignmentResponseSchema, type AlignmentResponse } from '../../../src/shared/residueAlignment.ts';

const URL_BASE = 'https://rest.ensembl.org/homology/symbol/human/';
const TAXA: Record<string, string> = { mus_musculus: 'NCBITaxon:10090', rattus_norvegicus: 'NCBITaxon:10116', danio_rerio: 'NCBITaxon:7955',
  xenopus_tropicalis: 'NCBITaxon:8364', drosophila_melanogaster: 'NCBITaxon:7227', caenorhabditis_elegans: 'NCBITaxon:6239' };
const TYPES: Record<string, string> = { ortholog_one2one: '1:1', ortholog_one2many: '1:many', ortholog_many2many: 'many:many', ortholog_many2one: 'many:1' };
const side = z.object({ id: z.string(), protein_id: z.string(), species: z.string(), align_seq: z.string(), perc_id: z.number().nullable(), perc_pos: z.number().nullable() });
const schema = z.object({ data: z.array(z.object({ id: z.string(), homologies: z.array(z.object({ type: z.string(), source: side, target: side })) })) });
const cache = new LRUCache<string, AlignmentResponse>({ max: 300, ttl: 24 * 60 * 60 * 1000 });
const flights = new Map<string, Promise<AlignmentResponse>>();

export async function loadAlignment(gene: string): Promise<AlignmentResponse> {
  const hit = cache.get(gene); if (hit) return hit;
  const running = flights.get(gene); if (running) return running;
  const task = (async (): Promise<AlignmentResponse> => {
    try {
      const species = Object.keys(TAXA).map(s => `target_species=${s}`).join(';');
      const url = `${URL_BASE}${encodeURIComponent(gene)}?type=orthologues;sequence=protein;aligned=1;${species};compara=vertebrates`;
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      if (response.status === 400 || response.status === 404) return { gene, status: 'not-found', sourceProteinId: null, homologies: [], provenance: null, message: 'Ensembl Compara has no human gene with this symbol.' };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text(); const body = schema.parse(JSON.parse(raw));
      const homologies = body.data.flatMap(d => d.homologies.filter(h => h.type.startsWith('ortholog') && h.source.species === 'homo_sapiens' && TAXA[h.target.species])
        .map(h => ({ type: TYPES[h.type] ?? h.type, species: h.target.species, taxonId: TAXA[h.target.species],
          geneId: h.target.id, proteinId: h.target.protein_id, sourceAligned: h.source.align_seq, targetAligned: h.target.align_seq,
          humanIdentity: h.source.perc_id, orthologIdentity: h.target.perc_id, humanSimilarity: h.source.perc_pos, sourceProtein: h.source.protein_id })));
      const sources = new Set(homologies.map(h => h.sourceProtein));
      if (sources.size > 1) throw new Error('Ambiguous human source protein');
      const result = alignmentResponseSchema.parse({ gene, status: homologies.length ? 'ready' : 'not-found', sourceProteinId: [...sources][0] ?? null,
        homologies: homologies.map(({ sourceProtein: _s, ...h }) => h),
        provenance: { source: 'Ensembl Compara', url, licence: 'Ensembl data are open (EMBL-EBI terms of use)', release: null, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), timestampBasis: 'download' },
        message: homologies.length ? null : 'No aligned orthologs returned for the selected model organisms.' });
      cache.set(gene, result); return result;
    } catch { return { gene, status: 'error', sourceProteinId: null, homologies: [], provenance: null, message: 'Ensembl did not return a complete, valid protein alignment.' }; }
  })().finally(() => { flights.delete(gene); });
  flights.set(gene, task); return task;
}
