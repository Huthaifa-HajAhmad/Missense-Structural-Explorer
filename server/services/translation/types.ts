/**
 * translation/types.ts — Shared contracts for genomic/cDNA coordinate resolution.
 *
 * WHY THIS SHAPE
 * --------------
 * The `/translate-variant` route historically consumed the Ensembl VEP response shape
 * (`transcript_consequences[]`). When a second provider was added to survive VEP outages,
 * the safest possible design was to map that provider INTO the same shape rather than
 * teach the route two formats. The route's transcript-selection, missense gating and
 * response assembly therefore remain byte-for-byte unchanged regardless of which
 * provider answered.
 *
 * NOTE: `ResolvedConsequence` is deliberately provider-neutral. It carries `provider`
 * for auditability but is otherwise identical in structure to a VEP consequence payload.
 */

import type { GenomeAssembly } from "../../../src/shared/variantNotation.ts";

/** Identifier of a coordinate-resolution provider. */
export type TranslationProvider = "ensembl-vep" | "variant-validator";

/** Human-facing provider labels used in responses and telemetry. */
export const TRANSLATION_PROVIDER_LABELS: Record<TranslationProvider, string> = {
  "ensembl-vep": "Ensembl VEP (rest.ensembl.org)",
  "variant-validator": "VariantValidator (rest.variantvalidator.org)",
};

/**
 * A single transcript consequence. Mirrors the subset of Ensembl VEP's
 * `transcript_consequences` entries that this pipeline actually consumes.
 */
export interface ResolvedTranscriptConsequence {
  transcript_id?: string;
  canonical?: number | boolean;
  mane_select?: unknown;
  mane_plus_clinical?: unknown;
  hgvsp?: string;
  /**
   * Transcript-level HGVS (VEP returns it with `hgvs=1`). It exists for many
   * non-protein-changing consequences (intronic, UTR) where `hgvsp` cannot, and is
   * the single most useful identifier to show a clinician when no HGVSp is possible.
   */
  hgvsc?: string;
  /**
   * Wild-type/mutant single-letter amino acids for this consequence (VEP `amino_acids`,
   * e.g. `"K/N"`). Used to prove that two consequences describe the SAME substitution when
   * reconciling protein numbering across isoforms.
   */
  amino_acids?: string;
  /**
   * UniProt isoform identifiers this consequence's protein numbering belongs to
   * (VEP `uniprot_isoform`, e.g. `["Q9Y305-4"]`).
   *
   * CRITICAL: `hgvsp` is numbered on the SELECTED TRANSCRIPT's protein product, while
   * `swissprot` names the CANONICAL accession. When a MANE Select transcript maps to a
   * non-canonical isoform these disagree — see `isoform-numbering.ts`. Never pair an
   * un-reconciled `hgvsp` with a canonical accession downstream.
   */
  uniprot_isoform?: string[];
  gene_symbol?: string;
  consequence_terms?: string[];
  swissprot?: string[];
}

/**
 * A transcript consequence that DOES describe a protein change.
 *
 * The missense pipeline can only proceed from a consequence carrying an `hgvsp`; encoding that
 * as a type (rather than re-checking `hgvsp` at every read site) keeps the guarantee intact
 * across reassignment — which is exactly where a plain optional field silently widened back to
 * `string | undefined` and defeated the route's earlier nil-check.
 */
export type ProteinAlteringConsequence = ResolvedTranscriptConsequence & { hgvsp: string };

/** Provider-neutral resolution result for one coordinate query. */
export interface ResolvedConsequence {
  provider: TranslationProvider;
  seq_region_name?: string;
  start?: number;
  allele_string?: string;
  transcript_consequences: ResolvedTranscriptConsequence[];
}

/** Why a resolution attempt failed, so the route can pick an honest HTTP status. */
export type ResolutionFailureKind =
  /** Every provider was unreachable / rate-limited / circuit-broken. */
  | "upstream_unavailable"
  /** Providers answered, but none mapped the coordinate to a transcript consequence. */
  | "not_found"
  /** Provider answered with a structurally unusable payload. */
  | "invalid_response";

/** One provider's attempt, retained for diagnostics and response metadata. */
export interface ProviderAttempt {
  provider: TranslationProvider;
  ok: boolean;
  durationMs: number;
  /** Populated when `ok === false`. */
  reason?: string;
  failureKind?: ResolutionFailureKind;
}

/** Successful resolution outcome, including which provider answered and what else was tried. */
export interface ResolutionOutcome {
  consequence: ResolvedConsequence;
  assembly: GenomeAssembly;
  /** Providers attempted before one succeeded (the successful provider is last). */
  attempts: ProviderAttempt[];
  /** True when the primary provider failed and a fallback answered. */
  usedFallback: boolean;
  /** True when the mapping was served from cache, so no provider was contacted. */
  cacheHit: boolean;
}

/**
 * Error raised when no provider could resolve a coordinate. Carries a machine-readable
 * `kind` so the HTTP layer can return 503 / 404 / 502 honestly instead of a blanket 500.
 */
export class CoordinateResolutionError extends Error {
  public readonly kind: ResolutionFailureKind;
  public readonly attempts: ProviderAttempt[];

  constructor(kind: ResolutionFailureKind, message: string, attempts: ProviderAttempt[] = []) {
    super(message);
    this.name = "CoordinateResolutionError";
    this.kind = kind;
    this.attempts = attempts;
  }
}

/**
 * Maps a resolution failure onto its HTTP status and error code.
 *
 * An upstream outage (503) is deliberately distinct from an internal error: the client can
 * retry a 503, whereas a 500 implies a bug. Kept as a pure function so the mapping is
 * unit-testable without touching the network.
 */
export function resolutionFailureToHttp(kind: ResolutionFailureKind): { status: number; code: string } {
  if (kind === "not_found") return { status: 404, code: "NOT_FOUND" };
  if (kind === "invalid_response") return { status: 502, code: "TRANSLATION_FAILED" };
  return { status: 503, code: "TRANSLATION_UNAVAILABLE" };
}
