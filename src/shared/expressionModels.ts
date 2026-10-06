/** Measurements, sampling and assay coverage are separate. A numeric zero remains a value. */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';
import type { ReviewSystemId } from './phenotypeFrame.ts';
export const tissueExpressionSchema = z.object({
  id: z.string(), label: z.string(), ontologyId: z.string().nullable(), value: z.number().finite().nonnegative().nullable(),
  unit: z.literal('TPM'), sampleCount: z.number().int().nonnegative().nullable(), samplingSite: z.string().nullable(),
});
export const adultExpressionResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-found', 'error']),
  gencodeId: z.string().nullable(), tissues: z.array(tissueExpressionSchema),
  provenance: contextProvenanceSchema.nullable(), message: z.string().nullable(),
});
export type AdultExpressionResponse = z.infer<typeof adultExpressionResponseSchema>;
export type TissueExpression = z.infer<typeof tissueExpressionSchema>;
// Local display grouping only. No inferred organ coverage and no ontology equivalence claim.
export function tissueMatchesSystem(id: string, system: ReviewSystemId): boolean {
  const prefixes: Partial<Record<ReviewSystemId, string[]>> = {
    cardiovascular: ['Heart_', 'Artery_'], nervous: ['Brain_', 'Nerve_'], muscle: ['Muscle_'],
    renal: ['Kidney_'], hepatic: ['Liver'], immune: ['Spleen', 'Whole_Blood'], respiratory: ['Lung'],
    skin: ['Skin_'], digestive: ['Esophagus_', 'Colon_', 'Small_Intestine_', 'Stomach', 'Pancreas'],
  };
  return (prefixes[system] ?? []).some(prefix => id.startsWith(prefix));
}
export function buildAdultExpressionEvidence(data: AdultExpressionResponse | null, systems: ReviewSystemId[]) {
  const tissues = data?.tissues ?? [];
  const relevant = tissues.filter(t => systems.some(s => tissueMatchesSystem(t.id, s)));
  const other = tissues.filter(t => !relevant.includes(t));
  const gaps = systems.filter(system => !tissues.some(t => tissueMatchesSystem(t.id, system)));
  return { relevant, other, gaps, ready: data?.status === 'ready' };
}
export type ExpressionObservation = {
  value: number | null; sampled: boolean | null; detectionCall: 'detected' | 'not-detected' | null;
  sourceInstalled: boolean; providerError: boolean;
};
export function expressionObservationState(observation: ExpressionObservation) {
  if (observation.value !== null && Number.isFinite(observation.value)) return 'measured' as const;
  if (!observation.sourceInstalled) return 'not-installed' as const;
  if (observation.providerError) return 'upstream-error' as const;
  if (observation.sampled === false) return 'not-sampled' as const;
  if (observation.sampled === true && observation.detectionCall === 'not-detected') return 'not-detected' as const;
  return 'unknown' as const;
}
export function modelPhenotypeState(input: { tested: boolean | null; abnormal: boolean; explicitNormal: boolean; lethalBeforeAssessment: boolean }) {
  if (input.abnormal) return 'abnormal' as const;
  if (input.lethalBeforeAssessment) return 'lethal-before-assessment' as const;
  if (input.tested === true && input.explicitNormal) return 'tested-no-abnormality-reported' as const;
  if (input.tested === false) return 'not-phenotyped' as const;
  return 'assessment-unknown' as const;
}
