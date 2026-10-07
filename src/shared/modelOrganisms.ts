/**
 * Model-organism context: orthology (Alliance) and mouse screen coverage (IMPC).
 * An empty phenotype list is "no returned annotation", never a normal organism, and
 * "no significant difference" is never "normal". No score, tally or ACMG input.
 */
import { z } from 'zod';
import { contextProvenanceSchema } from './diseaseFrame.ts';
import type { ReviewSystemId } from './phenotypeFrame.ts';

export const orthologSchema = z.object({
  id: z.string(), symbol: z.string(), taxonId: z.string(), species: z.string(),
  bestForward: z.boolean().nullable(), bestReverse: z.boolean().nullable(),
  confidence: z.string().nullable(), methodCount: z.number().int().nonnegative(),
});
export const impcScreenSchema = z.object({
  mgiId: z.string().regex(/^MGI:\d+$/), symbol: z.string(),
  phenotypeStatus: z.string().nullable(), phenotypingDataAvailable: z.boolean().nullable(),
  embryoDataAvailable: z.boolean().nullable(),
  significant: z.array(z.string()), notSignificant: z.array(z.string()),
});
export const modelOrganismResponseSchema = z.object({
  gene: z.string(), status: z.enum(['ready', 'not-found', 'error']),
  hgncId: z.string().nullable(), orthologs: z.array(orthologSchema),
  impc: z.object({ status: z.enum(['ready', 'not-found', 'error']), screens: z.array(impcScreenSchema) }).nullable(),
  provenance: z.array(contextProvenanceSchema), message: z.string().nullable(),
});
export type ModelOrganismResponse = z.infer<typeof modelOrganismResponseSchema>;
export type Ortholog = z.infer<typeof orthologSchema>;
export type ImpcScreen = z.infer<typeof impcScreenSchema>;

const SPECIES: Record<string, { key: string; label: string; order: number }> = {
  'NCBITaxon:10090': { key: 'mouse', label: 'Mouse', order: 0 },
  'NCBITaxon:10116': { key: 'rat', label: 'Rat', order: 1 },
  'NCBITaxon:7955': { key: 'zebrafish', label: 'Zebrafish', order: 2 },
  'NCBITaxon:8355': { key: 'frog', label: 'Frog (X. laevis)', order: 3 },
  'NCBITaxon:8364': { key: 'frog', label: 'Frog (X. tropicalis)', order: 3 },
  'NCBITaxon:7227': { key: 'fly', label: 'Fruit fly', order: 4 },
  'NCBITaxon:6239': { key: 'worm', label: 'Worm', order: 5 },
};
export const speciesLabel = (taxonId: string, fallback: string) => SPECIES[taxonId]?.label ?? fallback;
export const speciesOrder = (taxonId: string) => SPECIES[taxonId]?.order ?? 9;

export type OrthologGroup = { taxonId: string; species: string; rows: Ortholog[]; oneToMany: boolean };
/** One group per species; every ortholog stays listed (one-to-many is shown, not collapsed). */
export function groupOrthologs(orthologs: Ortholog[]): OrthologGroup[] {
  const groups = new Map<string, OrthologGroup>();
  for (const o of orthologs) {
    const g = groups.get(o.species) ?? { taxonId: o.taxonId, species: o.species, rows: [], oneToMany: false };
    g.rows.push(o); g.oneToMany = g.rows.length > 1; groups.set(o.species, g);
  }
  return [...groups.values()].sort((a, b) => speciesOrder(a.taxonId) - speciesOrder(b.taxonId) || a.species.localeCompare(b.species));
}

// Local display grouping of IMPC top-level MP terms. Not an official MP-to-system mapping.
const MP_TERMS: Record<ReviewSystemId, string[]> = {
  skeletal: ['skeleton phenotype', 'limbs/digits/tail phenotype', 'craniofacial phenotype'],
  cardiovascular: ['cardiovascular system phenotype'],
  nervous: ['nervous system phenotype', 'behavior/neurological phenotype'],
  hearing: ['hearing/vestibular/ear phenotype'], vision: ['vision/eye phenotype'],
  muscle: ['muscle phenotype'], renal: ['renal/urinary system phenotype'], hepatic: ['liver/biliary system phenotype'],
  immune: ['immune system phenotype', 'hematopoietic system phenotype'], respiratory: ['respiratory system phenotype'],
  skin: ['integument phenotype', 'pigmentation phenotype'], digestive: ['digestive/alimentary phenotype'],
};
export type ScreenCell = 'significant' | 'not-significant' | 'mixed' | 'not-reported';
export function screenCellForSystem(screen: ImpcScreen, system: ReviewSystemId): ScreenCell {
  const terms = MP_TERMS[system];
  const hit = terms.some(t => screen.significant.includes(t));
  const quiet = terms.some(t => screen.notSignificant.includes(t));
  return hit && quiet ? 'mixed' : hit ? 'significant' : quiet ? 'not-significant' : 'not-reported';
}
export const SCREEN_CELL_LABEL: Record<ScreenCell, string> = {
  significant: 'Significant difference', 'not-significant': 'No significant difference',
  mixed: 'Significant in some terms only', 'not-reported': 'Not reported',
};
export const unmappedScreenTerms = (screen: ImpcScreen) => {
  const known = new Set(Object.values(MP_TERMS).flat());
  return [...screen.significant, ...screen.notSignificant].filter(t => !known.has(t));
};

export function buildModelEvidence(data: ModelOrganismResponse | null, systems: ReviewSystemId[]) {
  const groups = groupOrthologs(data?.orthologs ?? []);
  const screens = data?.impc?.status === 'ready' ? data.impc.screens : [];
  return { ready: data?.status === 'ready', groups, screens, systems,
    screened: screens.some(s => s.phenotypingDataAvailable === true),
    noOrtholog: data?.status === 'ready' && !groups.length };
}
