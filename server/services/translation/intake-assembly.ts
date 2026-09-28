/**
 * intake-assembly.ts — the genome-build decision taken when a coordinate enters the pipeline.
 *
 * THE POLICY (declared in `src/shared/assembly.ts`, implemented here)
 * ------------------------------------------------------------------
 * "Coordinates are LIFTED to the canonical build when the input build differs, and the lift is
 * REVERSE-VERIFIED before use. When a lift cannot be verified, the coordinate keeps its own build
 * and the evidence that needs the other one is reported as UNAVAILABLE — never coerced."
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Ensembl serves GRCh37 from a FROZEN archive (`grch37.rest.ensembl.org`, an Ensembl-75-era
 * release) and GRCh38 from the current site. Annotating on the archive therefore means: no MANE
 * Select, no `uniprot_isoform`, retired gene symbols, and the archive's own (older) canonical
 * transcript set. Measured on `Chr1(GRCh37):g.1256452C>A`: the archive numbers the variant
 * `p.Arg23Leu` on isoform `Q5TA45-5`, while the canonical sequence this platform models carries
 * `S` at position 23 and MANE numbers the same substitution `p.Arg17Leu`. Annotating on the
 * canonical build instead makes a GRCh37 and a GRCh38 spelling of one variant converge on the
 * SAME answer — which is what every consumer below this layer already assumes:
 * `ASSEMBLY_SUPPORT` pins eight sources (gnomAD r4, dbNSFP-local, Genos, dbnsfp.org, AlphaGenome,
 * PopEVE, GPN-Star, splice geometry) to GRCh38, and the predictor path already lifts.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 *   - It does not lift blind: only a verified lift is used (`liftover.ts` checks the forward map,
 *     an exact reverse round-trip AND the GRCh38 reference base). An unverifiable coordinate keeps
 *     its build and the decision says why.
 *   - It does not lift indels or cDNA: only a single substitution has alleles that survive a
 *     position-level lift, and the missense scope already excludes the rest. Anything else is
 *     reported as `not-applicable` rather than guessed at.
 *   - It does not spend the request's budget on the attempt: the lift is capped
 *     ({@link INTAKE_LIFT_BUDGET_MS}) and a lift that cannot finish degrades to "resolved on the
 *     submitted build", exactly like an outage.
 */

import type { GenomeAssembly } from "../../../src/shared/variantNotation.ts";
import { parseGenomicHgvsNotation, referenceSequenceOf } from "../../../src/shared/variantNotation.ts";
import {
  CANONICAL_ASSEMBLY,
  buildsForChromosomeAccession,
  canonicalContigOf,
} from "../../../src/shared/assembly.ts";
import type { CoordinateLiftRecord } from "../../../src/shared/contracts.ts";
import { attemptCoordinateLift, type LiftFailureCode } from "./liftover.ts";

/**
 * Wall-clock budget for the canonical-build lift, before the coordinate is resolved on its own
 * build.
 *
 * A lift is two provider round trips in sequence (the forward map, then the reverse round-trip and
 * the reference-base check together), and Ensembl's REST latency — not the number of checks — is
 * what this has to cover. Measured live for the reported coordinate, three samples: 3.7s, 9.4s and
 * 17.3s (individual calls ranged from 0.1s to 9.3s). 12s therefore covers the common case and
 * degrades honestly on a slow one, which is the right trade: a lift is cached for ~10 years once
 * obtained, so a degraded request costs an OLDER answer, never a wrong one — and the next request
 * for the same locus retries the lift (failures are deliberately not cached).
 *
 * It must also fit the caller's own allowance: the route caps the whole call at
 * `TRANSLATE_TOTAL_BUDGET_MS` (52s, inside the client's 60s) and hands the ladder what is left, so
 * a slow lift can never push the request past the client's deadline.
 */
export const INTAKE_LIFT_BUDGET_MS = 12_000;

/**
 * Ceiling for ONE call to the translate route, split between the canonical-build lift and the
 * provider ladder.
 *
 * The client's own deadline is 60s (`src/api/structureApi.ts`) and the ladder's internal budget is
 * 40s (`DEFAULT_RESOLUTION_BUDGET_MS`), because Ensembl VEP needs 20-34s under load. A lift in
 * front of the ladder is therefore budgeted, not free: the two constants are declared together here
 * and a test asserts that
 * `INTAKE_LIFT_BUDGET_MS + DEFAULT_RESOLUTION_BUDGET_MS <= TRANSLATE_TOTAL_BUDGET_MS`, because two
 * budgets that each look reasonable are exactly how their SUM comes to abort a request that was
 * about to succeed.
 */
export const TRANSLATE_TOTAL_BUDGET_MS = 52_000;

export interface IntakeAssemblyDecision {
  /**
   * Build the coordinate must be ANNOTATED against. Equals the submitted build unless a lift was
   * verified.
   */
  resolveAssembly: GenomeAssembly;
  /**
   * Build the submitted coordinate is expressed in. Normally the inline `(GRCh…)` annotation, and
   * the RefSeq accession when the notation carries one that names a different build — the accession
   * names the reference sequence itself, so it wins, and the disagreement is disclosed.
   */
  submittedAssembly: GenomeAssembly;
  /** The notation to query: the lifted spelling on the canonical build when a lift was verified. */
  notation: string;
  /** Machine-readable build decision, returned as `coordinateLift`. */
  coordinateLift: CoordinateLiftRecord;
  /** Hyphen-form locus in `submittedAssembly`, when the notation carried one. */
  submittedCoordinates?: string;
  /** Hyphen-form locus in `resolveAssembly`; present only when a lift was verified. */
  liftedCoordinates?: string;
  /**
   * Human-facing build note (the route's `assemblyNote`). Written HERE rather than in the route
   * because it must state what actually happened — "resolved against the GRCh37 reference" was
   * true only while the archive was the thing being queried.
   */
  assemblyNote?: string;
}

/** `chr1:g.1256452C>A` — one spelling for the lifted coordinate, the form VEP accepts. */
function toHgvs(contig: string, pos: number, ref: string, alt: string): string {
  return `chr${contig}:g.${pos}${ref}>${alt}`;
}

/**
 * The lift refusal in words, per code.
 *
 * The codes exist so a caller can BRANCH; this exists so the sentence beside them names the actual
 * cause instead of listing every possibility. A reader told "no unique mapping" knows to check the
 * coordinate, while one told "the assembly map was unavailable" knows to try again — and an earlier
 * version said both at once, for every case.
 */
function describeLiftFailure(code: LiftFailureCode): string {
  switch (code) {
    case "no-mapping":
      return "the assembly map has no mapping for that position";
    case "ambiguous-mapping":
      // Covers three answers, not one: several mappings (a paralogous region), a strand flip, and a
      // range expansion. The sentence therefore describes what the map's answer IS NOT, rather than
      // claiming the position maps more than once — which was false for two of the three.
      return "the map's answer is not a single-base, same-strand, unique mapping for that position";
    case "contig-changed":
      return "the mapping lands on a different chromosome";
    case "round-trip-failed":
      return "mapping the result back does not reproduce the submitted position";
    case "reference-discontinuity":
      return "the canonical reference base at the mapped position is not the submitted allele";
    case "map-unavailable":
      return "the assembly map was unavailable";
    case "budget-exceeded":
      return "the assembly map was not consulted or did not answer within the verification budget";
    case "invalid-coordinate":
    default:
      return "the coordinate is not a single-base substitution the assembly map can address";
  }
}

/** `1-1256452-C-A` — the wire form the client and the predictor both parse. */
function toCoordinates(contig: string, pos: number, ref: string, alt: string): string {
  return `${contig}-${pos}-${ref}-${alt}`;
}

/**
 * Decides which build a submitted coordinate is annotated against, and returns the spelling to
 * query.
 *
 * Pure except for the lift itself, which is injectable (`deps.lift`) so the policy can be tested
 * without mocking HTTP — the decision table is the thing under test, not the transport.
 */
export async function decideIntakeAssembly(
  params: {
    /** Notation after normalization (inline annotation stripped, `chr` casing normalized). */
    notation: string;
    /** Build from the inline annotation, or the default when none was stated. */
    annotatedAssembly: GenomeAssembly;
    /** True when the caller actually wrote a `(GRCh…)` / `(hg19)` annotation. */
    annotationPresent: boolean;
    /** Absolute instant the lift must finish by. */
    deadlineAt?: number;
  },
  deps: { lift?: typeof attemptCoordinateLift } = {}
): Promise<IntakeAssemblyDecision> {
  const lift = deps.lift ?? attemptCoordinateLift;
  const { notation, annotatedAssembly, annotationPresent, deadlineAt } = params;

  const parsed = parseGenomicHgvsNotation(notation);

  // ── Which build is this coordinate really in? ───────────────────────────────
  // A RefSeq chromosome accession names the reference sequence, so it states the build; an inline
  // annotation is the caller's own statement and is used when the accession says nothing (MT is
  // the same accession in both builds, and an unknown accession is never guessed at).
  let submittedAssembly = annotatedAssembly;
  /**
   * Whether the SUBMITTED build was actually stated (an inline annotation, or a RefSeq accession
   * that names its own reference sequence) rather than defaulted to GRCh38.
   *
   * Reported as `coordinateLift.buildDeclared` because the record is read as evidence: without it,
   * a bare `chr1:g.…` reports `fromAssembly: "GRCh38"` — a build nobody stated, presented as
   * established. That is the "hg19 position wearing a GRCh38 label" hazard this module exists to
   * refuse, and the analysis route already distinguishes declared from defaulted for the same
   * reason (`variant-parser`'s forwarded-coordinate guard).
   */
  let buildDeclared = annotationPresent;
  /** Whether the build came from a RefSeq accession rather than the inline annotation. */
  let accessionStated = false;
  /** The reference-sequence token that stated it, for the disclosure sentence. */
  let statedAccession: string | null = null;

  /**
   * The accession rule is asked of the REFERENCE SEQUENCE, not of the `g.` family.
   *
   * A RefSeq chromosome accession names its own reference sequence, so it states the build whichever
   * coordinate type it prefixes: `NC_000001.10:c.1799T>A` is a GRCh37 sequence exactly as
   * `NC_000001.10:g.…` is. Reading it only from the genomic parser left that cDNA annotation on the
   * GRCh38 default AND bypassed the documented "the accession wins over a contradicting annotation"
   * rule, so `NC_000001.10(GRCh38):c.…` was queried on the GRCh38 host.
   */
  const referenceSequence = referenceSequenceOf(notation);
  if (referenceSequence) {
    const builds = buildsForChromosomeAccession(referenceSequence);
    if (builds.length === 1 && builds[0] !== annotatedAssembly) {
      submittedAssembly = builds[0];
      // The accession names the reference sequence, so the build IS stated — by the coordinate.
      buildDeclared = true;
      accessionStated = true;
      statedAccession = referenceSequence;
    }
  }

  /**
   * Which build the coordinate is in, and why we know — optionally claiming where it was RESOLVED.
   *
   * `resolutionClaim` is the build the annotation actually ran against, and the claim is only made
   * when it is TRUE. The sentence used to be composed from a template that always named the
   * SUBMITTED build ("resolved against the GRCh37 reference assembly") and the lift sentence was
   * then appended to it, so a verified lift returned a disclosure whose first clause asserted the
   * wrong reference release — the exact question this module exists to answer. Pass `null` while the
   * outcome is still unknown; the outcome's own sentence supplies the answer.
   */
  const statedBuildNote = (resolutionClaim: GenomeAssembly | null): string | undefined => {
    if (accessionStated) {
      return (
        `The RefSeq accession ${statedAccession} is a ${submittedAssembly} sequence` +
        (annotationPresent
          ? `, so the "(${annotatedAssembly})" annotation was not used`
          : ", which states the genome build") +
        (resolutionClaim ? `. Resolved against the ${resolutionClaim} reference.` : ".")
      );
    }
    if (!annotationPresent) return undefined;
    return resolutionClaim
      ? `Notation annotated "(${annotatedAssembly})" — resolved against the ${resolutionClaim} reference assembly.`
      : `Notation annotated "(${annotatedAssembly})" — the coordinate is expressed in ${submittedAssembly}.`;
  };

  let liftNote: string | undefined;
  const assemblyNote = (resolutionClaim: GenomeAssembly | null) =>
    [statedBuildNote(resolutionClaim), liftNote].filter(Boolean).join(" ") || undefined;

  const contig = parsed ? canonicalContigOf(parsed.chrom) : null;
  const submittedCoordinates =
    parsed && contig ? toCoordinates(contig, parsed.pos, parsed.ref, parsed.alt) : undefined;

  const base: Pick<CoordinateLiftRecord, "fromAssembly" | "toAssembly"> = {
    fromAssembly: submittedAssembly,
    toAssembly: submittedAssembly,
  };

  // ── Anything that is not a liftable substitution ────────────────────────────
  // cDNA carries no genomic alleles, and indels have no single position to lift. Reported as
  // `not-applicable` so a reader can tell "nothing to lift" from "the lift failed".
  if (!parsed || !contig) {
    return {
      resolveAssembly: submittedAssembly,
      submittedAssembly,
      notation,
      coordinateLift: {
        ...base,
        status: "not-applicable",
        buildDeclared,
        ...(submittedCoordinates ? { fromCoordinates: submittedCoordinates } : {}),
        /**
         * `not-applicable` still carries a code, because the two ways of being un-liftable are read
         * differently: a notation with no genomic locus at all (cDNA, protein) versus a real genomic
         * substitution on a contig the map cannot address. Folding them into one code would make an
         * unsupported contig look like a request that needed no lift.
         *
         * The first code is `no-genomic-locus`, NOT `not-a-substitution`: a cDNA missense IS a
         * substitution, and a code that reads "out of missense scope" would send a caller to the
         * wrong remedy for notation that is perfectly in scope — it simply has no genomic position
         * to lift.
         */
        reasonCode: parsed ? "unsupported-contig" : "no-genomic-locus",
        reason: parsed
          ? `contig "${parsed.chrom}" is not a chromosome the assembly map addresses, so no lift was attempted`
          : "the notation is not a genomic single-nucleotide substitution, so it cannot be lifted",
      },
      ...(assemblyNote(submittedAssembly) ? { assemblyNote: assemblyNote(submittedAssembly) } : {}),
    };
  }

  // ── Already canonical: nothing to do, and nothing to spend ──────────────────
  if (submittedAssembly === CANONICAL_ASSEMBLY) {
    return {
      resolveAssembly: CANONICAL_ASSEMBLY,
      submittedAssembly,
      notation,
      coordinateLift: {
        ...base,
        status: "not-needed",
        buildDeclared,
        fromCoordinates: submittedCoordinates,
      },
      ...(assemblyNote(submittedAssembly) ? { assemblyNote: assemblyNote(submittedAssembly) } : {}),
    };
  }

  // ── Verified lift onto the canonical build ─────────────────────────────────
  const attempt = await lift(
    {
      chrom: contig,
      pos: parsed.pos,
      ref: parsed.ref,
      alt: parsed.alt,
      assembly: submittedAssembly,
    },
    deadlineAt === undefined ? undefined : { deadlineAt }
  );

  if ("lifted" in attempt) {
    const lifted = attempt.lifted;
    const liftedCoordinates = toCoordinates(lifted.chrom, lifted.pos, lifted.ref, lifted.alt);
    /**
     * The note is derived from the OUTCOME, never composed from a template that mentions the
     * submitted build and then contradicts itself. An earlier version kept the "resolved against
     * the ${submitted} reference" sentence and appended the lift, so a verified lift produced
     * "annotated (GRCh37) — resolved against the GRCh37 reference assembly. The coordinate was
     * verified on the GRCh38 reference …" — a returned, documented disclosure asserting the wrong
     * release in its first clause.
     */
    liftNote =
      `The coordinate is stated in ${submittedAssembly} and was verified on the ` +
      `${CANONICAL_ASSEMBLY} reference ` +
      `(${toHgvs(contig, parsed.pos, parsed.ref, parsed.alt)} → ` +
      `${toHgvs(lifted.chrom, lifted.pos, lifted.ref, lifted.alt)}, reverse-verified); the ` +
      `annotation below comes from ${CANONICAL_ASSEMBLY}.`;
    return {
      resolveAssembly: CANONICAL_ASSEMBLY,
      submittedAssembly,
      notation: toHgvs(lifted.chrom, lifted.pos, lifted.ref, lifted.alt),
      coordinateLift: {
        status: "lifted",
        fromAssembly: submittedAssembly,
        toAssembly: CANONICAL_ASSEMBLY,
        fromCoordinates: submittedCoordinates,
        toCoordinates: liftedCoordinates,
        reverseVerified: true,
        buildDeclared,
      },
      submittedCoordinates,
      liftedCoordinates,
      assemblyNote: assemblyNote(null),
    };
  }

  const failureCode = "failure" in attempt ? attempt.failure : "map-unavailable";
  liftNote =
    `The coordinate could not be verified on the ${CANONICAL_ASSEMBLY} reference ` +
    `(${describeLiftFailure(failureCode)}), so it was annotated on the ${submittedAssembly} ` +
    `reference; the annotation therefore comes from a ${submittedAssembly}-era release, which ` +
    `predates MANE Select.`;
  return {
    resolveAssembly: submittedAssembly,
    submittedAssembly,
    notation,
    coordinateLift: {
      status: "unavailable",
      fromAssembly: submittedAssembly,
      toAssembly: submittedAssembly,
      fromCoordinates: submittedCoordinates,
      buildDeclared,
      /**
       * The machine-readable half: a caller can branch on retryable-versus-definitive without
       * parsing prose (`isRetryableLiftRefusal`). It is what makes "try again in a minute" sayable
       * for an unanswered map, and NOT sayable for a base where the two assemblies disagree.
       */
      reasonCode: failureCode,
      /**
       * Carries the WHOLE explanation, not just the mechanism: this string is the one a rail, an
       * agent or a report reads to answer "why is this annotation older?". It is deliberately
       * self-sufficient — the alternative (a terse code here plus the real sentence in
       * `assemblyNote`) left the reason reaching no consumer at all, because `assemblyNote` is prose
       * on the translate response that the analysis request never carries.
       *
       * PROVIDER-AGNOSTIC on purpose: this is composed BEFORE the ladder runs, so naming Ensembl (or
       * its archive) would be false whenever the build-aware VariantValidator fallback answered. The
       * release's AGE is the fact; which host served it is `provenance.provider`.
       */
      reason:
        `the coordinate could not be verified on the ${CANONICAL_ASSEMBLY} reference ` +
        `(${describeLiftFailure(failureCode)}), so it was annotated on the ` +
        `${submittedAssembly} reference, whose annotation release predates MANE Select`,
    },
    submittedCoordinates,
    assemblyNote: assemblyNote(null),
  };
}
