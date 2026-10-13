import { createHash } from 'node:crypto';
import { z } from 'zod';
import { LRUCache } from 'lru-cache';
import { hpaResponseSchema, parseHpaMeasures, type HpaResponse } from '../../../src/shared/hpa.ts';
import { governedFetch } from "../infra/http-client.ts";

const HGNC_URL = 'https://rest.genenames.org/fetch/symbol/';
const hgncSchema = z.object({ response: z.object({ docs: z.array(z.object({ symbol: z.string(), status: z.string(), ensembl_gene_id: z.string().regex(/^ENSG\d{11}$/).optional() })) }) });
const str = z.string().nullable().optional();
const hpaSchema = z.object({
  Gene: z.string(), Ensembl: z.string(), Evidence: str,
  'RNA tissue specificity': str, 'RNA tissue distribution': str, 'RNA tissue specific nTPM': z.unknown(),
  'RNA single cell type specificity': str, 'RNA single cell type distribution': str, 'RNA single cell type specific nCPM': z.unknown(),
  'Protein tissue specificity': str, Antibody: z.array(z.string()).nullable().optional(),
  'Reliability (IH)': str, 'Reliability (IF)': str,
}).passthrough();
const cache = new LRUCache<string, HpaResponse>({ max: 500, ttl: 24 * 60 * 60 * 1000 });
const flights = new Map<string, Promise<HpaResponse>>();
const empty = (gene: string, status: HpaResponse['status'], message: string): HpaResponse => ({ gene, status, ensemblId: null, rna: null, cells: null, protein: null, provenance: null, message });

export async function loadHpa(gene: string): Promise<HpaResponse> {
  const hit = cache.get(gene); if (hit) return hit;
  const running = flights.get(gene); if (running) return running;
  const task = (async (): Promise<HpaResponse> => {
    try {
      const hgnc = await governedFetch(HGNC_URL + encodeURIComponent(gene), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!hgnc.ok) throw new Error(`HGNC HTTP ${hgnc.status}`);
      // Exact approved symbol only; the Ensembl id then keys HPA, so a synonym can never select a different gene.
      const doc = hgncSchema.parse(await hgnc.json()).response.docs.find(d => d.symbol === gene && d.status === 'Approved');
      if (!doc?.ensembl_gene_id) return empty(gene, 'not-found', 'No approved HGNC gene with an Ensembl identifier for this exact symbol.');
      const url = `https://www.proteinatlas.org/${doc.ensembl_gene_id}.json`;
      const response = await governedFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (response.status === 404) return empty(gene, 'not-found', 'The Human Protein Atlas has no entry for this gene.');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.text(); const j = hpaSchema.parse(JSON.parse(raw));
      if (j.Gene !== gene || j.Ensembl !== doc.ensembl_gene_id) throw new Error('HPA identity mismatch');
      const result = hpaResponseSchema.parse({ gene, status: 'ready', ensemblId: j.Ensembl,
        rna: { specificity: j['RNA tissue specificity'] ?? null, distribution: j['RNA tissue distribution'] ?? null, enrichedTissues: parseHpaMeasures(j['RNA tissue specific nTPM']) },
        cells: { specificity: j['RNA single cell type specificity'] ?? null, distribution: j['RNA single cell type distribution'] ?? null, enrichedCells: parseHpaMeasures(j['RNA single cell type specific nCPM']) },
        protein: { evidence: j.Evidence ?? null, tissueSpecificity: j['Protein tissue specificity'] ?? null, antibodies: j.Antibody ?? [], reliabilityIhc: j['Reliability (IH)'] ?? null, reliabilityIf: j['Reliability (IF)'] ?? null },
        provenance: { source: 'Human Protein Atlas', url, licence: 'CC BY-SA 4.0', release: null, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), timestampBasis: 'download' }, message: null });
      cache.set(gene, result); return result;
    } catch { return empty(gene, 'error', 'The Human Protein Atlas did not return a complete, valid gene summary.'); }
  })().finally(() => { flights.delete(gene); });
  flights.set(gene, task); return task;
}
