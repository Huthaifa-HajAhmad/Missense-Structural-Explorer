/** Local review mappings, not HPO logical axioms. Onset is never converted to sampled age. */
import { z } from 'zod';
export const REVIEW_SYSTEMS = [
  { id: 'skeletal', label: 'Skeletal', anatomy: 'Bone and cartilage; skeletal muscle is a separate tissue' },
  { id: 'cardiovascular', label: 'Cardiovascular', anatomy: 'Heart chambers and vessels' },
  { id: 'nervous', label: 'Nervous system', anatomy: 'Brain regions, spinal cord and peripheral nerves' },
  { id: 'hearing', label: 'Hearing', anatomy: 'Cochlea and auditory structures' },
  { id: 'vision', label: 'Vision', anatomy: 'Retina and other ocular structures' },
  { id: 'muscle', label: 'Muscle', anatomy: 'Skeletal muscle' },
  { id: 'renal', label: 'Renal', anatomy: 'Kidney cortex and medulla' },
  { id: 'hepatic', label: 'Hepatic', anatomy: 'Liver' },
  { id: 'immune', label: 'Immune', anatomy: 'Immune cell types and lymphoid tissues' },
  { id: 'respiratory', label: 'Respiratory', anatomy: 'Lung and airways' },
  { id: 'skin', label: 'Skin', anatomy: 'Skin and appendages' },
  { id: 'digestive', label: 'Digestive', anatomy: 'Digestive tract and associated organs' },
] as const;
export type ReviewSystemId = typeof REVIEW_SYSTEMS[number]['id'];
export const ONSET_LABELS = { unknown: 'Not specified', antenatal: 'Antenatal', congenital: 'Congenital', neonatal: 'Neonatal', infantile: 'Infantile', childhood: 'Childhood', juvenile: 'Juvenile', adult: 'Adult', 'young-adult': 'Young adult', late: 'Late onset' } as const;
export const phenotypeSelectionSchema = z.object({
  diseaseKey: z.string().nullable(),
  systems: z.array(z.enum(REVIEW_SYSTEMS.map(s => s.id) as [ReviewSystemId, ...ReviewSystemId[]])),
  excludedSuggestions: z.array(z.string()),
  /** HPO term ids the researcher accepted as review context. Never patient observations. */
  acceptedTerms: z.array(z.string().regex(/^HP:\d{7}$/)).default([]),
  onset: z.enum(['unknown', 'antenatal', 'congenital', 'neonatal', 'infantile', 'childhood', 'juvenile', 'adult', 'young-adult', 'late']),
});
export type PhenotypeSelection = z.infer<typeof phenotypeSelectionSchema>;
export function emptyPhenotypeSelection(): PhenotypeSelection {
  return { diseaseKey: null, systems: [], excludedSuggestions: [], acceptedTerms: [], onset: 'unknown' };
}
export function selectDisease(selection: PhenotypeSelection, diseaseKey: string | null): PhenotypeSelection {
  // A frame change cannot replace the researcher's review systems or onset.
  return { ...selection, diseaseKey, excludedSuggestions: [], acceptedTerms: [] };
}
export function toggleReviewSystem(selection: PhenotypeSelection, system: ReviewSystemId): PhenotypeSelection {
  return { ...selection, systems: selection.systems.includes(system)
    ? selection.systems.filter(s => s !== system) : [...selection.systems, system] };
}
