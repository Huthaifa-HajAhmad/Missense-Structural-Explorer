/** Public age cohorts remain source labels; never mapped to onset or exact ages. */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame';
import type { ReviewSystemId } from './phenotypeFrame';
export const DGTEX_COHORTS = {
  '1': 'Infant (0 to 2 years)', '2': 'Early Childhood (2 to 8 years)',
  '3': 'Pre-pubertal (8 to approximately 13)', '4': 'Post-pubertal (approximately 13 to 18)',
} as const;
export const developmentalGroupSchema = z.object({
  tissueId: z.string().regex(/^UBERON:\d{7}$/), tissue: z.string().min(1),
  cohortId: z.enum(['1', '2', '3', '4']), cohort: z.string(),
  sampleCount: z.number().int().positive(), donorCount: z.number().int().positive(),
}).superRefine((group, ctx) => {
  if (group.cohort !== DGTEX_COHORTS[group.cohortId] || group.donorCount > group.sampleCount)
    ctx.addIssue({ code: 'custom', message: 'Invalid source cohort or donor counts' });
});
export const developmentalCountsSchema = z.object({
  metadataSamples: z.number().int().positive(), includedSamples: z.number().int().positive(),
  excludedSamples: z.number().int().nonnegative(), wgsSamples: z.number().int().nonnegative(),
  includedDonors: z.number().int().positive(), metadataDonors: z.number().int().positive(),
});
export const developmentalExpressionResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-installed', 'not-found', 'error']),
  gencodeId: z.string().nullable(),
  observations: z.array(developmentalGroupSchema.and(z.object({ value: z.number().finite().nonnegative(), unit: z.literal('TPM') }))),
  counts: developmentalCountsSchema.nullable(), provenance: contextProvenanceSchema.nullable(),
  message: z.string().nullable(),
});
export type DevelopmentalExpressionResponse = z.infer<typeof developmentalExpressionResponseSchema>;
export type DevelopmentalObservation = DevelopmentalExpressionResponse['observations'][number];
/** Local display grouping by the release's tissue labels; no anatomy equivalence inference. */
export function developmentalTissueMatchesSystem(tissue: string, system: ReviewSystemId): boolean {
  const prefixes: Partial<Record<ReviewSystemId, string[]>> = {
    cardiovascular: ['Heart', 'Artery'], nervous: ['Brain', 'Nerve'], muscle: ['Muscle'], renal: ['Kidney'],
    hepatic: ['Liver'], immune: ['Spleen', 'Lymph Node', 'Thymus'], respiratory: ['Lung', 'Bronchus', 'Trachea'],
    skin: ['Skin'], digestive: ['Esophagus', 'Colon', 'Small Intestine', 'Stomach', 'Pancreas'],
  };
  return (prefixes[system] ?? []).some(prefix => tissue.startsWith(prefix));
}
export function buildDevelopmentalEvidence(data: DevelopmentalExpressionResponse | null, systems: ReviewSystemId[], cohort = 'all') {
  const observations = (data?.observations ?? []).filter(o => cohort === 'all' || o.cohortId === cohort);
  const relevant = observations.filter(o => systems.some(s => developmentalTissueMatchesSystem(o.tissue, s)));
  const other = observations.filter(o => !relevant.includes(o));
  const gaps = systems.filter(s => !observations.some(o => developmentalTissueMatchesSystem(o.tissue, s)));
  return { relevant, other, gaps, ready: data?.status === 'ready' };
}
