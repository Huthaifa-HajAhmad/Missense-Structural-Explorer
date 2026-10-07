/**
 * Curated model-organism phenotype annotations (Alliance) with uPheno cross-species exact matches.
 * Annotations are positive curations only: an empty list means nothing curated, never a normal
 * organism. A uPheno match says two terms describe the same phenotype, not that the gene causes
 * the human disease. Model phenotypes are not automatically PS3/BS3.
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';
import { speciesOrder } from './modelOrganisms.ts';

export const modelPhenotypeSchema = z.object({
  termId: z.string(), statement: z.string(), annotations: z.number().int().positive(),
  models: z.number().int().nonnegative(), humanTerms: z.array(z.string().regex(/^HP:\d{7}$/)),
});
export const speciesPhenotypesSchema = z.object({
  taxonId: z.string(), species: z.string(), orthologId: z.string(), symbol: z.string(),
  status: z.enum(['ready', 'error']), total: z.number().int().nonnegative(), phenotypes: z.array(modelPhenotypeSchema),
});
export const modelPhenotypesResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-found', 'error']),
  species: z.array(speciesPhenotypesSchema), mapping: z.enum(['available', 'unavailable']),
  provenance: z.array(contextProvenanceSchema), message: z.string().nullable(),
});
export type ModelPhenotypesResponse = z.infer<typeof modelPhenotypesResponseSchema>;
export type SpeciesPhenotypes = z.infer<typeof speciesPhenotypesSchema>;
export type ModelPhenotype = z.infer<typeof modelPhenotypeSchema>;

/** Group the uPheno exact-match table: every term sharing an UPHENO id is equivalent to the others. */
export function buildUphenoIndex(tsv: string) {
  const byUpheno = new Map<string, string[]>(); const termToUpheno = new Map<string, string[]>();
  for (const line of tsv.split('\n')) {
    if (!line || line.startsWith('#') || line.startsWith('subject_id')) continue;
    const [subject, predicate, object] = line.split('\t');
    if (predicate !== 'semapv:crossSpeciesExactMatch' || !subject?.startsWith('UPHENO:') || !object) continue;
    byUpheno.set(subject, [...(byUpheno.get(subject) ?? []), object]);
    termToUpheno.set(object, [...(termToUpheno.get(object) ?? []), subject]);
  }
  return { humanTerms(term: string): string[] {
    const hp = new Set<string>();
    for (const u of termToUpheno.get(term) ?? []) for (const t of byUpheno.get(u) ?? []) if (/^HP:\d{7}$/.test(t)) hp.add(t);
    return [...hp];
  } };
}

export const orderSpecies = (rows: SpeciesPhenotypes[]) => [...rows].sort((a, b) => speciesOrder(a.taxonId) - speciesOrder(b.taxonId) || a.symbol.localeCompare(b.symbol));
/** Rows whose uPheno equivalents include a term annotated to the chosen disease, so they read first. */
export function splitByDiseaseMatch(phenotypes: ModelPhenotype[], diseaseTerms: Map<string, string>) {
  const matched = phenotypes.filter(p => p.humanTerms.some(t => diseaseTerms.has(t)));
  return { matched, other: phenotypes.filter(p => !matched.includes(p)) };
}
export const matchedNames = (p: ModelPhenotype, diseaseTerms: Map<string, string>) => p.humanTerms.filter(t => diseaseTerms.has(t)).map(t => diseaseTerms.get(t)!);
