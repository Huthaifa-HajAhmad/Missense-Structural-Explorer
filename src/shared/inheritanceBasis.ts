/**
 * inheritanceBasis.ts — what the curated gene–disease records say about inheritance, for the two
 * frequency rules that depend on it: PM2's ceiling and BS2's genotype.
 *
 * WHY THIS EXISTS
 * ---------------
 * PM2's ceiling was chosen from pLI alone (≥ 0.9 → 0.01%, else 0.1%), and every surface had to say
 * "pLI does not establish disease-specific inheritance". Meanwhile the Gene–disease tab held curated
 * GenCC disease–inheritance records for the same gene, and nothing carried them to the rule. The
 * engine now reads them first and falls back to pLI only when the gene has no qualifying record.
 *
 * RULES
 * -----
 * • Only records with a GenCC validity of Definitive, Strong or Moderate count. Supportive, Limited,
 *   Disputed and Refuted records describe weaker or contested relationships and do not set a rule.
 * • A gene is "recessive only" when every qualifying record is autosomal recessive. ANY qualifying
 *   dominant-acting record (dominant, semidominant, X-linked, mitochondrial, other) gives the lower
 *   PM2 ceiling: the variant could cause that disease, and the lower ceiling is the conservative
 *   reading for pathogenic evidence. A gene-level engine does not choose one disease for the reader.
 * • The homozygote count is the BS2 genotype for autosomal disease. It is not for a gene whose every
 *   qualifying record is X-linked, Y-linked or mitochondrial (hemizygotes and heteroplasmy are the
 *   relevant genotypes, and the payload carries neither); BS2 is then not applied.
 *
 * Penetrance is NOT curated by any source here. BS2 assumes full penetrance at an early age, so the
 * surfaces keep stating that caveat; this module cannot resolve it.
 *
 * Pure: imports only zod-free types.
 */

/** GenCC validity levels that may set a frequency rule. */
export const QUALIFYING_VALIDITY = ['Definitive', 'Strong', 'Moderate'] as const;

/** HPO inheritance ids, as GenCC records them. */
const AR = 'HP:0000007';
const SEX_OR_MITO = new Set(['HP:0001417', 'HP:0001419', 'HP:0001423', 'HP:0001450', 'HP:0001427']);

export interface CuratedInheritance {
  source: 'GenCC';
  /** Distinct inheritance labels among qualifying records, e.g. ["Autosomal dominant", "Semidominant"]. */
  modes: string[];
  /** Every qualifying record is autosomal recessive. */
  recessiveOnly: boolean;
  /** Every qualifying record is X-linked, Y-linked or mitochondrial. */
  sexOrMitoOnly: boolean;
  /** Qualifying records counted, for the trace. */
  records: number;
}

export interface FrameLike {
  inheritance: { id: string; label: string };
  validity: ReadonlyArray<{ level: string }>;
}

/** The summary, or null when the gene has no qualifying record (the rule then falls back to pLI). */
export function summariseCuratedInheritance(frames: ReadonlyArray<FrameLike> | null | undefined): CuratedInheritance | null {
  const qualifying = (frames ?? []).filter(f => f.validity.some(v => (QUALIFYING_VALIDITY as readonly string[]).includes(v.level)));
  if (qualifying.length === 0) return null;
  const ids = qualifying.map(f => f.inheritance.id);
  return {
    source: 'GenCC',
    modes: [...new Set(qualifying.map(f => f.inheritance.label))].sort(),
    recessiveOnly: ids.every(id => id === AR),
    sexOrMitoOnly: ids.every(id => SEX_OR_MITO.has(id)),
    records: qualifying.length,
  };
}

export type Pm2CeilingBasis = 'curated-recessive' | 'curated-dominant' | 'pli-recessive' | 'pli-dominant' | 'unknown';

/**
 * Which PM2 ceiling applies, and why. `recessiveCeiling` / `dominantCeiling` / `pliCut` come from
 * `THRESHOLDS.populationFrequency` at the call site, so this module holds no number of its own.
 */
export function pm2CeilingFor(
  args: { inheritance: CuratedInheritance | null | undefined; pli: number | null | undefined },
  cut: { recessiveCeiling: number; dominantCeiling: number; pliCut: number },
): { ceiling: number; basis: Pm2CeilingBasis; text: string } {
  const { inheritance, pli } = args;
  if (inheritance) {
    const modes = inheritance.modes.join(', ');
    return inheritance.recessiveOnly
      ? { ceiling: cut.recessiveCeiling, basis: 'curated-recessive', text: `higher ceiling: every curated GenCC record is autosomal recessive` }
      : { ceiling: cut.dominantCeiling, basis: 'curated-dominant', text: `lower ceiling: curated GenCC inheritance includes ${modes}` };
  }
  if (typeof pli === 'number' && Number.isFinite(pli)) {
    return pli < cut.pliCut
      ? { ceiling: cut.recessiveCeiling, basis: 'pli-recessive', text: `higher ceiling (no curated inheritance; pLI ${pli.toFixed(2)} < ${cut.pliCut})` }
      : { ceiling: cut.dominantCeiling, basis: 'pli-dominant', text: `lower ceiling (no curated inheritance; pLI ${pli.toFixed(2)} ≥ ${cut.pliCut})` };
  }
  return { ceiling: cut.dominantCeiling, basis: 'unknown', text: 'lower ceiling (no curated inheritance and no pLI)' };
}

/** Chromosome of a gnomAD-style id ("X-123-A-G"), upper-cased without "chr", or null. */
export function variantChromosome(variantId: string | null | undefined): string | null {
  const m = /^(?:chr)?([0-9]{1,2}|X|Y|M|MT)[-:_]/i.exec(variantId ?? '');
  return m ? m[1].toUpperCase().replace(/^MT$/, 'M') : null;
}

/**
 * Whether the homozygote count is the right genotype for BS2 here. Not on X, Y or the mitochondrion,
 * and not for a gene curated only as X-linked, Y-linked or mitochondrial.
 */
export function homozygotesInformBs2(args: { variantId?: string | null; inheritance?: CuratedInheritance | null }): { applies: boolean; reason: string | null } {
  const chrom = variantChromosome(args.variantId);
  if (chrom === 'X' || chrom === 'Y' || chrom === 'M') {
    return { applies: false, reason: `the variant is on chromosome ${chrom}, where homozygote counts are not the genotype BS2 needs (hemizygotes or heteroplasmy are)` };
  }
  if (args.inheritance?.sexOrMitoOnly) {
    return { applies: false, reason: 'every curated inheritance for this gene is X-linked, Y-linked or mitochondrial' };
  }
  return { applies: true, reason: null };
}
