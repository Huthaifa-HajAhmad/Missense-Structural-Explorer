/**
 * assembly.ts — Single source of truth for genome-build policy across the pipeline.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The application supports two human genome builds, but the build was only ever tracked
 * inside the translation route: `assembly` is detected from an inline annotation, used to
 * pick the right Ensembl host, echoed to the client — and then dropped. The analysis
 * request had no assembly field at all, so every coordinate-consuming service downstream
 * silently assumed GRCh38.
 *
 * That is not a cosmetic gap. Most of the evidence sources are single-build:
 *   GPN-Star            GRCh38-only Tabix index
 *   local dbNSFP        hg38 columns
 *   Genos               sends `genome_build: 'hg38'`
 *   dbnsfp.org          sends `genome_build: 'hg38'`
 *   SpliceAI Lookup     separate service per build, client defaulted to GRCh38
 *   MyVariant.info      `_id` is hg19 by default, and was parsed as though it were GRCh38
 *
 * Feeding a GRCh37 coordinate to a GRCh38 service fails in one of two ways, and the second
 * is the dangerous one: the service either rejects it (loud, safe) or — when the GRCh38
 * base at that numeric position happens to match the supplied REF, which is common — it
 * accepts and scores a *different locus*, returning plausible numbers attributed to this
 * variant. Silent wrongness in a clinical report is worse than a missing value.
 *
 * THE POLICY, and why it is shaped this way
 * -----------------------------------------
 * 1. Every build-dependent consumer DECLARES the builds it can serve (`ASSEMBLY_SUPPORT`).
 *    Unknown consumers are treated as build-naive rather than assumed compatible.
 * 2. Coordinates are LIFTED to the canonical build when the input build differs, and the
 *    lift is REVERSE-VERIFIED before use (`reverseVerified`). A lift is only ever accepted
 *    when mapping back reproduces the original position exactly.
 * 3. When a lift cannot be verified, or a coordinate's build is unknown, the evidence is
 *    reported as UNAVAILABLE (or unavailable-unless-provable) — never coerced, never
 *    guessed. Absence is a truthful answer; a wrong-build score is not.
 *
 * Canonicalising to one build is what Ensembl VEP and gnomAD themselves do, so it also
 * means a GRCh37 and a GRCh38 query for the same variant converge on identical evidence
 * rather than diverging.
 *
 * BOUNDARY CONTRACT
 * -----------------
 * Imported by BOTH `server/` and `src/`. Pure: no imports outside `src/shared/`
 * (enforced by scripts/check-boundaries.ts).
 */
import type { GenomeAssembly } from "./variantNotation.ts";

/** The build every single-build service in this application is pinned to. */
export const CANONICAL_ASSEMBLY: GenomeAssembly = "GRCh38";

/** Human-facing labels, for provenance rows and error messages. */
export const ASSEMBLY_LABELS: Record<GenomeAssembly, string> = {
  GRCh37: "GRCh37 / hg19",
  GRCh38: "GRCh38 / hg38",
};

/**
 * Declared build support for every coordinate-consuming source.
 *
 * `["GRCh37", "GRCh38"]` means the source is build-aware (it is told the build, or has a
 * service per build). A single-element array means the source is pinned to that build and
 * MUST NOT receive a coordinate from the other one.
 *
 * Keeping this in one table is the point: previously each source hard-coded its own build
 * (`'hg38'`, `GRCh38`, `reference_genome: GRCh37`) with nothing recording the obligation,
 * so a caller had no way to know a mismatch was even possible.
 */
export const ASSEMBLY_SUPPORT = {
  "ensembl-vep": ["GRCh37", "GRCh38"],
  "variant-validator": ["GRCh37", "GRCh38"],
  "spliceai-lookup": ["GRCh37", "GRCh38"],
  /** hg38-only Tabix index (songlab/gpn-msa-hg38-scores). */
  "gpn-star": ["GRCh38"],
  /** AlphaGenome Atlas holds GRCh38 SNVs; the model inputs GRCh38 sequence. */
  alphagenome: ["GRCh38"],
  /** PopEVE is matched against `popeve_grch38.vcf.gz` on chrom/pos/ref/alt. */
  popEVE: ["GRCh38"],
  /** Splice-junction geometry is resolved against GRCh38 Ensembl exon boundaries. */
  "splice-proximity": ["GRCh38"],
  /** Local dbNSFP SQLite ingest carries hg38 columns only. */
  "dbnsfp-local": ["GRCh38"],
  /** Requests hard-code `genome_build: 'hg38'`. */
  genos: ["GRCh38"],
  dbnsfpOrg: ["GRCh38"],
  /** gnomAD r4 variant ids are GRCh38. */
  "gnomad-variants": ["GRCh38"],
  /** Gene-level constraint aggregates; no coordinates cross the boundary. */
  "gnomad-constraint": ["GRCh37", "GRCh38"],
  /** RefSeq transcript sequences are assembly-independent by construction. */
  "uniprot-sequence": ["GRCh37", "GRCh38"],
} as const satisfies Record<string, readonly GenomeAssembly[]>;

export type AssemblyAwareSource = keyof typeof ASSEMBLY_SUPPORT;

/** Whether a source can be given a coordinate from the supplied build. */
export function sourceSupportsAssembly(
  source: AssemblyAwareSource,
  assembly: GenomeAssembly
): boolean {
  return (ASSEMBLY_SUPPORT[source] as readonly GenomeAssembly[]).includes(assembly);
}

/** The builds a source can serve. Useful for wording "this source covers GRCh38 only". */
export function supportedAssemblies(source: AssemblyAwareSource): readonly GenomeAssembly[] {
  return ASSEMBLY_SUPPORT[source];
}

/** The build a coordinate is expressed in. */
export interface AssemblyTaggedCoordinate {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  /** The build these numeric coordinates belong to. */
  assembly: GenomeAssembly;
}

/** A coordinate lifted onto the canonical build. Produced by the liftover step, which owns
 * the round-trip check and discards any lift that fails it.
 *
 * Modelling "unverified" as an absent value rather than a flagged one means no downstream
 * consumer has to remember to check a boolean in order to stay correct: the unsafe state
 * cannot be expressed, and a successful lift is simply a canonical-build coordinate. */
export interface LiftedCoordinate extends AssemblyTaggedCoordinate {
  /** The build the caller originally supplied. */
  originalAssembly: GenomeAssembly;
  /** The coordinate as originally supplied, retained for provenance. */
  original: { chrom: string; pos: number };
  /** Always true on a value that exists; a failed round-trip yields no value at all. */
  reverseVerified: true;
}

/**
 * Word the absence of a score for a source that cannot serve this build, so a skipped
 * source reads as "not assessed" rather than as a negative result.
 *
 * NOTE: currently exercised only by unit tests. The production gate composes
 * `sourceSupportsAssembly` directly because refusal reasons are not yet surfaced in the UI.
 * Wire this in — or delete it — when that surface lands, rather than leaving a public
 * helper unused.
 */
export function describeAssemblyRefusal(
  source: AssemblyAwareSource,
  assembly: GenomeAssembly
): string {
  const supported = supportedAssemblies(source).map(a => ASSEMBLY_LABELS[a]).join(" or ");
  return `${source} covers ${supported}; this coordinate is ${ASSEMBLY_LABELS[assembly]} and was not scored.`;
}
