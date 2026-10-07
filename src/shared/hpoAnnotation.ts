/**
 * HPO annotations for the disease the researcher chose. These are suggestions: each term is
 * accepted individually, and an accepted term stays review context. It is never a patient
 * observation. Inheritance and clinical-course terms are not phenotypic abnormalities and are
 * dropped from system roll-up. The category-to-system grouping is local, not an official mapping.
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';
import type { ReviewSystemId } from './phenotypeFrame.ts';

export const HPO_DISEASE_ID = /^(?:OMIM|ORPHA):\d{1,8}$/;
export const hpoTermSchema = z.object({
  id: z.string().regex(/^HP:\d{7}$/), name: z.string(), category: z.string(),
  frequency: z.string().nullable(), onset: z.string().nullable(), sources: z.array(z.string()),
});
export const hpoResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-found', 'error']),
  disease: z.object({ queried: z.string(), id: z.string(), name: z.string(), mondoId: z.string().nullable() }).nullable(),
  terms: z.array(hpoTermSchema), provenance: contextProvenanceSchema.nullable(), message: z.string().nullable(),
});
export type HpoResponse = z.infer<typeof hpoResponseSchema>;
export type HpoTerm = z.infer<typeof hpoTermSchema>;

/** Categories that describe course or inheritance, not an affected organ. */
export const NON_PHENOTYPIC_CATEGORIES = ['Inheritance', 'Clinical course'];
const CATEGORY_SYSTEM: Record<string, ReviewSystemId> = {
  'Skeletal system': 'skeletal', Limbs: 'skeletal', 'Head and neck': 'skeletal', 'Cardiovascular System': 'cardiovascular',
  'Nervous System': 'nervous', Ear: 'hearing', Eye: 'vision', Musculature: 'muscle', 'Genitourinary System': 'renal',
  'Digestive System': 'digestive', 'Respiratory System': 'respiratory', 'Skin, Hair, and Nails': 'skin',
  'Immune System': 'immune', 'Blood and Blood-forming Tissues': 'immune',
};
export const systemForCategory = (category: string): ReviewSystemId | null => CATEGORY_SYSTEM[category] ?? null;

export function groupHpoTerms(data: HpoResponse | null) {
  const groups = new Map<string, HpoTerm[]>();
  for (const t of data?.terms ?? []) { if (NON_PHENOTYPIC_CATEGORIES.includes(t.category)) continue; groups.set(t.category, [...(groups.get(t.category) ?? []), t]); }
  return [...groups.entries()].map(([category, terms]) => ({ category, system: systemForCategory(category), terms }))
    .sort((a, b) => b.terms.length - a.terms.length || a.category.localeCompare(b.category));
}
/** Systems implied by the terms the researcher accepted, so each can be added with one explicit click. */
export function systemsFromAccepted(data: HpoResponse | null, accepted: string[]): Array<{ system: ReviewSystemId; terms: number }> {
  const counts = new Map<ReviewSystemId, number>();
  for (const t of data?.terms ?? []) {
    const system = accepted.includes(t.id) ? systemForCategory(t.category) : null;
    if (system) counts.set(system, (counts.get(system) ?? 0) + 1);
  }
  return [...counts].map(([system, terms]) => ({ system, terms }));
}
export const toggleAcceptedTerm = (accepted: string[], id: string) => accepted.includes(id) ? accepted.filter(x => x !== id) : [...accepted, id];
/** First OMIM then ORPHA cross-reference of the chosen disease; HPO is keyed by those, not MONDO. */
export function hpoQueryIds(xrefs: string[]): string[] {
  const ids = [...new Set(xrefs.map(x => x.replace(/^Orphanet:/i, 'ORPHA:')).filter(x => HPO_DISEASE_ID.test(x)))];
  return [...ids.filter(x => x.startsWith('OMIM')), ...ids.filter(x => x.startsWith('ORPHA'))].slice(0, 4);
}
