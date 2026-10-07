/**
 * Base-level pext (gnomAD v4, GTEx v10): the proportion of a gene's expression, in each tissue,
 * from transcripts that touch a coding base. It is a MAXIMUM over transcripts at that base, so it
 * does not show that the transcript carrying the missense annotation is expressed. Regions are
 * CDS-only, 1-based inclusive; UTR and intronic positions have no region. No cut-point is applied.
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';
import type { ReviewSystemId } from './phenotypeFrame.ts';

export const pextRegionSchema = z.object({
  start: z.number().int().positive(), stop: z.number().int().positive(), mean: z.number().finite().nullable(),
  tissues: z.array(z.object({ tissue: z.string(), value: z.number().finite().nullable() })),
}).refine(r => r.start <= r.stop, 'Inverted pext region');
export const pextResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'no-pext', 'not-found', 'error']),
  geneId: z.string().nullable(), chrom: z.string().nullable(), flags: z.array(z.string()), regions: z.array(pextRegionSchema),
  provenance: contextProvenanceSchema.nullable(), message: z.string().nullable(),
});
export type PextResponse = z.infer<typeof pextResponseSchema>;
export type PextRegion = z.infer<typeof pextRegionSchema>;

export type PextSite = { chrom: string; pos: number };
/** Only a verified GRCh38 gnomAD-style `chrom-pos-ref-alt` id may locate the variant. */
export function pextSiteFromVariantId(id: string | null | undefined, assembly: string | null | undefined, fallback: boolean): PextSite | null {
  if (assembly !== 'GRCh38' || fallback || !id) return null;
  const m = /^(?:chr)?([0-9]{1,2}|X|Y|MT?)-(\d+)-[ACGT]+-[ACGT]+$/i.exec(id.trim());
  return m ? { chrom: m[1].toUpperCase() === 'M' ? 'MT' : m[1].toUpperCase(), pos: Number(m[2]) } : null;
}
export type PextLocation = 'region' | 'no-region' | 'no-locus' | 'other-chromosome';
export function locatePext(data: PextResponse | null, site: PextSite | null) {
  if (!site) return { state: 'no-locus' as PextLocation, region: null, index: -1 };
  const chrom = (data?.chrom ?? '').toUpperCase().replace(/^CHR/, '').replace(/^M$/, 'MT');
  if (!data || chrom !== site.chrom) return { state: 'other-chromosome' as PextLocation, region: null, index: -1 };
  const index = data.regions.findIndex(r => r.start <= site.pos && site.pos <= r.stop); // inclusive
  return index < 0 ? { state: 'no-region' as PextLocation, region: null, index } : { state: 'region' as PextLocation, region: data.regions[index], index };
}
export const pextTissueLabel = (id: string) => id.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
// Local display grouping only, on gnomAD's snake_case tissue names.
const PREFIX: Partial<Record<ReviewSystemId, string[]>> = {
  cardiovascular: ['heart_', 'artery_'], nervous: ['brain_', 'nerve_'], muscle: ['muscle_'], renal: ['kidney_'], hepatic: ['liver'],
  immune: ['spleen', 'whole_blood'], respiratory: ['lung'], skin: ['skin_'],
  digestive: ['esophagus_', 'colon_', 'small_intestine', 'stomach', 'pancreas'],
};
export const pextTissueMatches = (tissue: string, system: ReviewSystemId) => (PREFIX[system] ?? []).some(p => tissue.startsWith(p));
export function orderPextTissues(region: PextRegion, systems: ReviewSystemId[]) {
  const all = [...region.tissues].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const relevant = all.filter(t => systems.some(s => pextTissueMatches(t.tissue, s)));
  return { relevant, other: all.filter(t => !relevant.includes(t)) };
}
