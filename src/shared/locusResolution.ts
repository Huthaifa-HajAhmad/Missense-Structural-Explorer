/**
 * locusResolution.ts — how the pipeline found the variant's genomic locus, and what to say when it
 * only found an older-build one.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Every coordinate-keyed source (gnomAD r4, AlphaGenome, GPN-Star, PopEVE, splice geometry) reads
 * `predictorData.gnomadVariantId` and refuses it unless it is on GRCh38. That id is produced by a
 * ladder: Ensembl VEP by coordinate, then by protein HGVS, then a MyVariant.info fallback whose ids
 * are always GRCh37, lifted onto GRCh38 when it can be verified.
 *
 * When the whole ladder fails on GRCh38, the run is left holding a GRCh37 locus, and every source
 * correctly refuses it. The defect this module ends is what the surfaces then SAID: the refusal was
 * worded as a fact about the variant ("this coordinate is GRCh37 / hg19 and was not scored"),
 * classified as permanent ("Not covered" — "nothing anyone can do"), and cached as a finished
 * result. All three were false: the variant has a GRCh38 locus, the lookup that would have found it
 * failed transiently, and a re-run usually succeeds. Observed on NAE1 p.Asp116Gly, re-run from
 * Recents during an Ensembl outage.
 *
 * WHAT IT PROVIDES
 * ----------------
 * - `locusResolutionSchema`: the trail the server now records on `predictorData.locusResolution`.
 * - `isFallbackLocus`: whether a result's coordinate is a non-canonical FALLBACK rather than a build
 *   the user supplied. Works on payloads that predate the trail (see the function).
 * - `fallbackLocusSentence`: the one sentence every surface uses for that state, so the Population
 *   card, the rule trace, the header and the evidence rails cannot drift into different claims.
 *
 * Pure: imports only zod and `src/shared/` (scripts/check-boundaries.ts).
 */
import { z } from "zod";
import { CANONICAL_ASSEMBLY, ASSEMBLY_LABELS } from "./assembly";
import type { GenomeAssembly } from "./variantNotation";

/** One rung of the locus ladder, as attempted on this run. */
export const locusResolutionStepSchema = z.object({
  step: z.enum([
    /** Ensembl VEP region query, by a coordinate the caller supplied. */
    "vep-coordinate",
    /** Ensembl VEP HGVS query, by protein notation (the transcript ladder). */
    "vep-hgvs",
    /** MyVariant.info / dbNSFP lookup by gene and protein change. Its ids are GRCh37. */
    "myvariant",
    /** Ensembl assembly map: forward map, reverse map and reference base, all three verified. */
    "ensembl-lift",
    /** dbNSFP's own GRCh38 position, verified against the UCSC hg38 reference base. */
    "dbnsfp-grch38",
  ]),
  outcome: z.enum(["ok", "failed", "skipped"]),
  /** Why, in a form fit for a log line and for an agent reading the payload. */
  detail: z.string().max(300).optional(),
});

export const locusResolutionSchema = z.object({
  /** Which branch produced the payload. */
  route: z.enum(["vep-coordinate", "vep-hgvs", "fallback"]),
  /** How the GRCh38 locus was established, or null when it was not. */
  canonicalBy: z.enum(["vep", "ensembl-lift", "dbnsfp-grch38"]).nullable(),
  /**
   * True when the locus is NOT canonical and another attempt could change that (an outage, a
   * timeout, an open circuit breaker). False when it is canonical, or when every failure was a fact
   * about the variant that a retry cannot alter.
   */
  retryable: z.boolean(),
  steps: z.array(locusResolutionStepSchema).max(12),
});

export type LocusResolutionStep = z.infer<typeof locusResolutionStepSchema>;
export type LocusResolution = z.infer<typeof locusResolutionSchema>;

/** The slice of an analysis result this module reads. Structural, so legacy payloads fit. */
export interface LocusResultLike {
  predictorData?: {
    gnomadVariantAssembly?: GenomeAssembly | null;
    gnomadVariantId?: string | null;
    locusResolution?: LocusResolution | null;
  } | null;
  coordinateLift?: {
    fromAssembly?: GenomeAssembly | null;
    fromCoordinates?: string | null;
  } | null;
}

/**
 * True when the run's coordinate is on a non-canonical build because the GRCh38 lookup failed, not
 * because the user submitted an older-build coordinate.
 *
 * Two sources of truth, strongest first:
 *  1. The server's own trail (`locusResolution.route === "fallback"`), on payloads that carry it.
 *  2. For payloads that predate the trail: the user did not submit on that build. A GRCh37
 *     predictor coordinate on a run submitted on GRCh38 (or as protein/cDNA notation, which the
 *     analysis route records as GRCh38) can only have come from the MyVariant fallback, the only
 *     producer of GRCh37 ids in the pipeline (`vep-orchestrator.ts`). A user who DID submit GRCh37
 *     sees the existing build wording, which is true for them.
 */
export function isFallbackLocus(result: LocusResultLike | null | undefined): boolean {
  const pred = result?.predictorData;
  if (!pred) return false;

  // 1. The server's trail: the fallback branch answered and no GRCh38 locus was verified. This also
  //    covers a run that found no locus at all, which has no id and no build to inspect.
  const trail = pred.locusResolution;
  if (trail) return trail.route === "fallback" && trail.canonicalBy === null;

  // 2. Legacy payloads: infer from what the user submitted.
  const assembly = pred.gnomadVariantAssembly ?? null;
  if (!pred.gnomadVariantId || !assembly || assembly === CANONICAL_ASSEMBLY) return false;
  // `fromAssembly` is the build the user SUBMITTED in. A protein or cDNA input carries the analysis
  // route's default (GRCh38), so a GRCh37 locus is the user's own build only when this says GRCh37.
  const userSubmittedThisBuild = result?.coordinateLift?.fromAssembly === assembly;
  return !userSubmittedThisBuild;
}

/**
 * Whether re-running is worth offering. A fallback locus without a trail is treated as retryable:
 * the only thing known is that the lookup failed, and every recorded cause of that is transient.
 */
export function isRetryableFallbackLocus(result: LocusResultLike | null | undefined): boolean {
  if (!isFallbackLocus(result)) return false;
  const trail = result?.predictorData?.locusResolution;
  return trail ? trail.retryable : true;
}

/**
 * The sentence for a source that could not be queried because the locus is a fallback.
 *
 * Says what happened (the lookup failed), what was left (an older-build locus), why the source
 * declined it (it indexes GRCh38), and what fixes it (a re-run) — and explicitly that it is not a
 * property of the variant, which is the claim the previous wording made by implication.
 *
 * @param source  display name of the declining source, e.g. "gnomAD r4"
 */
export function fallbackLocusSentence(
  source: string,
  assembly: GenomeAssembly | null,
  options: { retryable?: boolean } = {},
): string {
  return `${source} was not queried: ${fallbackCause(assembly, options.retryable ?? true)}`;
}

/**
 * The cause clause shared by every surface, lower-case so it can follow a source name.
 *
 * The server writes refusals as `${sourceKey} was not queried: …` so the client's `humaniseRefusal`
 * (which rewrites a leading source key into its display name) keeps working on these too.
 */
export function fallbackCause(assembly: GenomeAssembly | null, retryable: boolean): string {
  const canonical = ASSEMBLY_LABELS[CANONICAL_ASSEMBLY];
  const found = assembly
    ? `only a ${ASSEMBLY_LABELS[assembly]} locus was found, and this source indexes ${canonical}`
    : "no genomic locus could be established";
  return (
    `the ${CANONICAL_ASSEMBLY} lookup for this variant did not complete on this run, so ${found}. ` +
    `This is a lookup failure, not a property of the variant` +
    (retryable ? " — re-run the analysis to retry." : ".")
  );
}

/** A short form for tight chrome (the header's run-state slot). */
export function fallbackLocusShortLabel(assembly: GenomeAssembly | null): string {
  if (!assembly) return "Locus not resolved";
  return `${assembly === "GRCh37" ? "hg19" : assembly} fallback`;
}
