import { REGIONAL_STATUSES, type ConstraintProvenance, type RegionalConstraintStatus } from "./constraintSource.ts";
import type { LiteratureSummaryReceipt } from "./literatureSummary";
import { z } from "zod";
import { FOLDX_PHASES, type FoldxPhase } from "./foldxPhase";
import type { PredictorConcordance } from "./thresholds/concordance";
import { CANONICAL_ASSEMBLY, statedAssemblyOf, type AssemblyTaggedCoordinate } from "./assembly";
import type { GenomeAssembly } from "./variantNotation";
import { ENGINE_STATE_IDS, type EngineState } from "./engineStatus";
import {
  DEEP_EVIDENCE_MODEL_IDS,
  DEEP_MODEL_EVIDENCE_VERSION,
  type DeepEvidenceModelId,
} from "./deepModelEvidence";
import { STRUCTURE_RESOLUTION_SOURCES, type StructureResolutionSource } from "./structureRefs";
import { locusResolutionSchema, locusFailureKindSchema, LOCUS_POLICY_VERSION, isFallbackLocus, isRetryableFallbackLocus, type LocusResolution } from "./locusResolution";
import { isIntrinsicallyAmbiguousProteinChange } from "./proteinAlleleIdentity";

/**
 * The FoldX phase vocabulary, as a schema.
 *
 * Derived from the constant so the wire contract and the renderer cannot drift: a phase the server
 * learns to report is accepted here the moment it is added to `FOLDX_PHASES`, instead of failing
 * validation and silently downgrading the client to the unvalidated raw payload.
 */
export const foldxPhaseSchema = z.enum(FOLDX_PHASES as unknown as [FoldxPhase, ...FoldxPhase[]]);

// ============================================================================
// Numeric Validation Primitives
// ============================================================================
export const finiteNumber = z.number().refine(Number.isFinite, { message: "Number must be finite" });
export const nullableFiniteNumber = z.number().nullable().refine(val => val === null || Number.isFinite(val), { message: "Number must be finite" });

// ============================================================================
// 1. ACMG & Clinical Types
// ============================================================================
export const acmgEvidenceCodeSchema = z.enum([
  "PVS1", "PS1", "PS2", "PS3", "PS4",
  "PM1", "PM2", "PM3", "PM4", "PM5", "PM6",
  "PP1", "PP2", "PP3", "PP4",
  "BA1", "BS1", "BS2", "BS3", "BS4",
  "BP1", "BP2", "BP3", "BP4", "BP5", "BP7"
]);

export type AcmgEvidenceCode = z.infer<typeof acmgEvidenceCodeSchema>;

export const acmgCriteriaItemSchema = z.object({
  code: z.string(),
  reason: z.string(),
  source: z.enum(["database_verified", "ai_suggested"]).optional()
});

export type ACMGCriteriaItem = z.infer<typeof acmgCriteriaItemSchema>;

export const clinicalSignificanceSchema = z.union([
  z.enum([
    "Pathogenic",
    "Likely Pathogenic",
    "Uncertain Significance",
    "Likely Benign",
    "Benign",
    "Pathogenic/Likely pathogenic",
    "Benign/Likely benign",
    "Conflicting interpretations of pathogenicity",
    "not found"
  ]),
  z.string()
]);

export type ClinicalSignificance = z.infer<typeof clinicalSignificanceSchema>;

export const clinVarDataSchema = z.object({
  classification: clinicalSignificanceSchema,
  lastEvaluated: z.string(),
  reviewStatus: z.string(),
  alleleFrequencies: z.array(z.object({
    source: z.string(),
    value: z.preprocess(
      (val) => {
        if (val === null || val === undefined) return null;
        const parsed = typeof val === "number" ? val : parseFloat(String(val));
        return isNaN(parsed) ? null : parsed;
      },
      nullableFiniteNumber
    )
  })),
  trait: z.string(),
  /** Raw condition identifiers retained for an explicit disease choice; no label-based matching. */
  conditions: z.array(z.object({
    label: z.string(), xrefs: z.array(z.object({ source: z.string(), id: z.string() }))
  })).optional(),
  uid: z.string().nullable(),
  hasOtherPathogenicVariantSameAA: z.boolean().optional()
});

export type ClinVarData = z.infer<typeof clinVarDataSchema>;

// ============================================================================
// 2. Structure Provenance & Energetics Contracts
// ============================================================================
export const structureProvenanceSchema = z.object({
  source: z.enum(["experimental", "alphafold", "homolog", "client-provided"]),
  pdbId: z.string().optional(),
  chainId: z.string().optional(),
  resolution: z.number().nullable().optional(),
  method: z.string().optional(),
  identity: z.number().optional(),
  foldxVersion: z.string().optional(),
  foldxRuns: z.number().optional(),
  seed: z.number().nullable().optional(),
  /**
   * @deprecated Older servers stamped "2023-Zenodo-6835877" and "VESM_150M_v1" on EVERY run, whether or
   * not RaSP returned a value or any VESM model ran. Kept optional so cached payloads parse; read
   * `energetics.raspSource` instead.
   */
  raspDatasetSnapshot: z.string().optional(),
  /** @deprecated See `raspDatasetSnapshot`. No Energetics engine uses VESM. */
  vesmModel: z.string().optional(),
  afdbVersion: z.string().optional(),
  modelSha: z.string().optional(),
  timestamp: z.string().optional()
});

export type StructureProvenance = z.infer<typeof structureProvenanceSchema>;

export const energeticsDataSchema = z.object({
  foldx: nullableFiniteNumber,
  foldxMean: nullableFiniteNumber.optional(),
  foldxSd: nullableFiniteNumber.optional(),
  vdw: nullableFiniteNumber.optional(),
  electrostatics: nullableFiniteNumber.optional(),
  stericClashWarning: z.boolean().optional(),
  localSidechainRmsd: nullableFiniteNumber.optional(),
  /** What `localSidechainRmsd` was measured against: FoldX's paired wild type, or the input template. */
  localSidechainRmsdReference: z.enum(["foldx-paired", "template"]).nullable().optional(),
  foldxRepairFailed: z.boolean().optional(),
  foldxBinaryMissing: z.boolean().optional(),
  /**
   * Repair was deliberately not attempted, and why.
   *
   * `foldxRepairFailed` already existed for "repair was attempted and failed"; these two describe
   * the other, quieter case — a template that was never minimised because of its size or because it
   * is an AlphaFold model whose pLDDT B-factors would be misread as temperature factors. A ΔΔG on
   * an un-repaired template is a weaker claim, so the reason is part of the payload rather than a
   * log line.
   */
  foldxRepairSkipped: z.boolean().optional(),
  foldxRepairSkippedReason: z.enum(["large-structure", "alphafold-plddt"]).optional(),
  /** The repaired template was reused from cache instead of recomputed — same coordinates, disclosed. */
  foldxRepairCached: z.boolean().optional(),
  foldxError: z.string().nullable().optional(),
  dynamut2: nullableFiniteNumber.optional(),
  ddmut: nullableFiniteNumber.optional(),
  rasp: nullableFiniteNumber.optional(),
  /** Lookup lifecycle; `done` with no score means the installed table returned no estimate. */
  raspStatus: z.enum(["pending", "done", "unavailable", "error"]).nullable().optional(),
  raspError: z.string().nullable().optional(),
  thermompnn: nullableFiniteNumber.optional(),
  consensusVerdict: z.string().nullable().optional(),
  raspReason: z.string().optional(),
  /** Which RaSP table served `rasp` (see `shared/raspIndex.ts`). */
  raspSource: z.enum(["experimental", "alphafold"]).optional(),
  /** What the installed RaSP index covers, so "not covered" can say how much is. */
  raspCoverage: z
    .object({
      proteins: z.number().int().nonnegative(),
      sources: z.object({ experimental: z.number().optional(), alphafold: z.number().optional() }),
    })
    .optional(),
  evidenceComplete: z.boolean().optional(),
  pendingTools: z.array(z.string()).optional(),
  rawDdGs: z.array(z.number()).nullable().optional(),
  stabilityoracle: nullableFiniteNumber.optional(),
  stabilityoracleStatus: z.enum(["pending", "done", "unavailable", "error"]).nullable().optional(),
  stabilityoracleError: z.string().nullable().optional(),
  /**
   * @deprecated No longer produced. They came from hand-typed curves (`thresholds/consensus.ts`) and
   * are kept only so payloads cached before their retirement still parse. Nothing may read them.
   */
  consensusProbability: nullableFiniteNumber.optional(),
  /** @deprecated See `consensusProbability`. */
  consensusConfMin: nullableFiniteNumber.optional(),
  /** @deprecated See `consensusProbability`. */
  consensusConfMax: nullableFiniteNumber.optional(),
  /** Engines whose ΔΔG the consensus counted. */
  consensusEnginesCounted: z.number().int().nonnegative().optional(),
  /** Counted engines at or past their own destabilizing mark. */
  consensusEnginesDestabilizing: z.number().int().nonnegative().optional(),
  /** Median canonical ΔΔG of the counted engines, kcal/mol. */
  consensusMedianDdg: nullableFiniteNumber.optional(),
  seed: nullableFiniteNumber.optional(),
  bFactorMetadata: z.object({
    source: z.string(),
    semantic: z.string(),
    inherited: z.boolean()
  }).nullable().optional(),
  structureProvenance: structureProvenanceSchema.nullable().optional()
}).passthrough();

export type EnergeticsData = z.infer<typeof energeticsDataSchema>;

// ============================================================================
// 3. Language Model Evaluations (ESM-C, ESM-2, SaProt)
// ============================================================================
export const esmcPreferenceSchema = z.object({
  aa: z.string(),
  prob: z.number()
});

export const esmcLocalShiftSchema = z.object({
  position: z.number(),
  residue: z.string(),
  shift: z.number()
});

export const esmcEvalResultSchema = z.object({
  wtProbability: z.number().optional(),
  mutProbability: z.number().optional(),
  llr: z.number().optional(),
  preferences: z.array(esmcPreferenceSchema).optional(),
  mutRank: z.number().optional(),
  positionalEntropy: z.number().optional(),
  embeddingShift: z.number().optional(),
  localEmbeddingShift: z.number().optional(),
  localShiftMap: z.array(esmcLocalShiftSchema).optional(),
  klDivergence: z.number().nullable().optional(),
  conformationState: z.string().nullable().optional(),
  provenance: z.string().optional(),
  /**
   * Fallback diagnostics. A card that silently serves another model's numbers has to be able to
   * say which engine failed and why, per tier; both are free text from the failing tier itself.
   */
  remoteEngineNote: z.string().nullable().optional(),
  fallbackReason: z.string().nullable().optional(),
  error: z.string().optional(),
  status: z.string().optional()
});

export const modelEvalErrorSchema = z.object({
  error: z.string(),
  status: z.string().optional()
});

// ============================================================================
// 3b. Deep-Model Evidence — the narrative request's trusted contract
// ============================================================================
/**
 * The deep-model observations a narrative synthesis may be GIVEN.
 *
 * WHY THIS SCHEMA IS STRICT
 * -------------------------
 * The narrative request is client-supplied, so every part of it that reaches the prompt is untrusted
 * input. This payload's whole purpose is to be interpolated into a clinical prompt, so it is validated
 * here rather than read ad hoc off `req.body`: the ids are a closed set (one row per model, in the
 * app's own order), the state vocabulary is `ENGINE_STATE_IDS` from `engineStatus.ts` rather than a
 * string the client invents, values must be finite and plausible, and every free-text field is
 * length-capped. A payload that does not describe one of THIS app's models is rejected, not
 * paraphrased — which is what keeps a synthesis from being handed, or from appearing to have been
 * handed, evidence the app never produced.
 *
 * It travels in the request beside the fast evidence, and it is part of the narrative evidence hash
 * (see `src/shared/deepModelEvidence.ts` and `narrativeEvidence.ts`), so a narrative written with these
 * observations can never be served for a run without them.
 */
export const deepModelEvidenceObservationSchema = z.object({
  id: z.enum(DEEP_EVIDENCE_MODEL_IDS as unknown as [DeepEvidenceModelId, ...DeepEvidenceModelId[]]),
  source: z.string().min(1).max(64),
  state: z.enum(ENGINE_STATE_IDS as unknown as [EngineState, ...EngineState[]]),
  value: z.number().nullable().refine(v => v === null || (Number.isFinite(v) && Math.abs(v) <= 1000), {
    message: "Deep-model value must be finite and within ±1000",
  }),
  unit: z.enum(["kcal/mol", "ΔLLR"]).nullable(),
  call: z.string().max(48).nullable(),
  provenance: z.string().max(160).nullable(),
  note: z.string().max(240).nullable(),
});

export const deepModelEvidenceSchema = z.object({
  /** The projection's version; a value the server has not learned is refused rather than guessed at. */
  version: z.literal(DEEP_MODEL_EVIDENCE_VERSION),
  observations: z.array(deepModelEvidenceObservationSchema).max(DEEP_EVIDENCE_MODEL_IDS.length),
});

export type DeepModelEvidencePayload = z.infer<typeof deepModelEvidenceSchema>;

export type ModelEvalError = z.infer<typeof modelEvalErrorSchema>;

export type EsmcPreference = z.infer<typeof esmcPreferenceSchema>;
export type EsmcLocalShift = z.infer<typeof esmcLocalShiftSchema>;
export type EsmcEvalResult = z.infer<typeof esmcEvalResultSchema>;

// ============================================================================
// 4. Translate Variant & Resolve Gene Contracts
// ============================================================================
export const translateVariantRequestSchema = z.object({
  variant: z.string()
});

/**
 * The numbering-remap record, declared ONCE.
 *
 * It was written out four times (two Zod schemas and two pipeline copies) and they disagreed: the
 * pipeline copies omitted `from.accession`, which is how that field came to be silently stripped from
 * the audit record. Every consumer now derives from this declaration.
 */
export const numberingRemapSchema = z.object({
  reason: z.string(),
  from: z.object({
    hgvsp: z.string().optional(),
    transcriptId: z.string().optional(),
    isoform: z.string().optional(),
    maneRefSeqId: z.string().optional(),
    /** Protein accession the ORIGINAL notation was numbered on, when it named one. */
    accession: z.string().optional(),
  }),
  to: z.object({
    hgvsp: z.string().optional(),
    transcriptId: z.string().optional(),
    isoform: z.string().optional(),
  }),
});
export type NumberingRemapRecord = z.infer<typeof numberingRemapSchema>;

/**
 * The genome-build decision taken for a coordinate, declared ONCE.
 *
 * WHY IT IS ON THE WIRE
 * ---------------------
 * A user may enter an hg19/GRCh37 coordinate, and every single-build source in this application is
 * pinned to GRCh38 (`src/shared/assembly.ts`). The resolution therefore LIFTS the coordinate onto
 * the canonical build first — reverse-verified — and that decision is evidence a report, a UI and an
 * agent all have to be able to state: which build was submitted, which build answered, whether the
 * two are the same variant, and, when no lift was possible, WHY.
 *
 * The statuses are deliberately distinct, because they call for different words:
 *   - `lifted`         — a verified lift exists; `toCoordinates` is the canonical locus used.
 *   - `unavailable`    — a lift was attempted and could NOT be verified (ambiguous mapping,
 *                        reference discontinuity, upstream outage). The coordinate is resolved on
 *                        the build it was submitted in, and its annotation is therefore older.
 *   - `not-needed`     — the submitted build IS canonical; no lift is involved.
 *   - `not-applicable` — nothing liftable was submitted (cDNA, indels, protein notation).
 */
/**
 * The two builds this platform speaks, declared once.
 *
 * Shared so that every reader of a build — the lift record, a refusal's trail, a hint — validates
 * against the same enum instead of re-typing it, which is how a reader comes to accept a value no
 * writer can produce.
 */
export const genomeAssemblySchema = z.enum(["GRCh37", "GRCh38"]);

export const coordinateLiftSchema = z.object({
  status: z.enum(["lifted", "unavailable", "not-needed", "not-applicable"]),
  /** Build of the coordinate as submitted. */
  fromAssembly: z.enum(["GRCh37", "GRCh38"]),
  /** Build the annotation actually ran against. */
  toAssembly: z.enum(["GRCh37", "GRCh38"]),
  /** Hyphen form (`chrom-pos-ref-alt`) in `fromAssembly`, when the notation carried one. */
  fromCoordinates: z.string().optional(),
  /** Hyphen form in `toAssembly`; present only when `status === "lifted"`. */
  toCoordinates: z.string().optional(),
  /** Always true on a recorded lift — a failed round-trip produces no coordinates at all. */
  reverseVerified: z.boolean().optional(),
  /**
   * Whether the SUBMITTED build was actually stated (inline annotation, or a RefSeq accession that
   * names its own reference sequence) rather than defaulted to GRCh38.
   *
   * Present because the record is read as EVIDENCE: without it, a bare `chr1:g.…` reports
   * `fromAssembly: "GRCh38"` — a build nobody stated, presented as established. Absent on records
   * the analysis route derives from a caller-supplied pair, where "declared" cannot be known; a
   * consumer must then treat the build as caller-stated rather than established.
   */
  buildDeclared: z.boolean().optional(),
  /**
   * WHY no lift was used, as a code a caller can branch on — the prose `reason` beside it is for
   * human eyes.
   *
   * The distinction that matters is retryable versus definitive. `map-unavailable` and
   * `budget-exceeded` are worth another attempt (the assembly map was not reachable, or our own
   * deadline stopped it); `no-mapping`, `ambiguous-mapping` and `contig-changed` describe the
   * coordinate's position in the reference — `ambiguous-mapping` covers every non-unique answer the map
   * can give (several mappings, a strand flip, a range expansion), so it does NOT mean "mapped more
   * than once"; `reference-discontinuity` says the two assemblies disagree at that base, which no
   * number of retries will change; and `no-genomic-locus` / `unsupported-contig` say nothing was
   * liftable in the first place (`no-genomic-locus` is cDNA or protein notation — in scope for this
   * platform, and simply carrying no genomic position to lift).
   */
  reasonCode: z
    .enum([
      "no-mapping",
      "ambiguous-mapping",
      "contig-changed",
      "round-trip-failed",
      "reference-discontinuity",
      "map-unavailable",
      "budget-exceeded",
      "invalid-coordinate",
      "no-genomic-locus",
      "unsupported-contig",
    ])
    .optional(),
  /** Why no lift was used, in one line, when `status` is not `"lifted"`. */
  reason: z.string().optional(),
});
export type CoordinateLiftRecord = z.infer<typeof coordinateLiftSchema>;

/** The lift-failure codes that are worth another attempt, for callers that advise one. */
export const RETRYABLE_LIFT_REASONS: readonly CoordinateLiftRecord["reasonCode"][] = [
  "map-unavailable",
  "budget-exceeded",
];

/** True when a refused lift may succeed later (an outage or our own deadline, not a reference fact). */
export function isRetryableLiftRefusal(record: CoordinateLiftRecord | null | undefined): boolean {
  if (!record || record.status !== "unavailable") return false;
  return record.reasonCode !== undefined && RETRYABLE_LIFT_REASONS.includes(record.reasonCode);
}

/**
 * True when a stored analysis result was built against a NON-CANONICAL reference and is therefore
 * worth re-running rather than serving.
 *
 * WHY A CACHE GUARD NEEDS THIS. The client bundle cache is keyed on protein notation
 * (`NAE1_p.asp116gly`), deliberately build-free — the substitution is the same whichever build the
 * coordinates came from. Its embedded analysis result is NOT build-free, because the server assembles
 * it from coordinate-consuming sources. So a bundle written when a GRCh37 coordinate could not be
 * lifted is restored for every later spelling of the variant, showing a coordinate chip, a target
 * build and a population verdict from the older reference: observed in production as "PM2 withheld —
 * this coordinate's build is not one gnomAD r4 serves" for a variant that scores PM2 on a fresh run.
 *
 * The server already refuses to PERSIST this state (`vep-orchestrator`: `shouldCache` is false when
 * `gnomadVariantAssembly === "GRCh37"`); this is the matching rule for the client cache, which had
 * none — the asymmetry was the defect.
 *
 * RETRYABLE VERSUS DEFINITIVE, again: a lift refused for a reason another attempt could change (an
 * unanswered map, our own deadline, or a record written before `reasonCode` existed, where the cause
 * is unknown) is worth re-attempting. A reference discontinuity is a fact about the coordinate, so
 * serving its bundle is right and re-running would spend a ladder to hear the same answer.
 */
export function isBuildDegradedResult(
  result:
    | {
        coordinateLift?: CoordinateLiftRecord | null;
        metadata?: { gene?: string; variant?: string; populationPolicyVersion?: number } | null;
        aouFrequency?: unknown;
        conservationData?: { aouFrequency?: unknown } | null;
        gnomadFrequency?: { dataset?: string | null } | null;
        predictorData?: {
          gnomadVariantAssembly?: GenomeAssembly | null;
          gnomadVariantId?: string | null;
          caddPhred?: number | null;
          source?: string;
          locusResolution?: LocusResolution | null;
        } | null;
      }
    | null
    | undefined
): boolean {
  if (!result) return false;

  // PR #23 could accept a single database-listed allele after an ambiguous protein lookup.
  // Migrate every old fallback bundle once, including a seemingly canonical one. Healthy VEP
  // results keep their existing caches; current definitive input requirements remain cacheable.
  const trail = result.predictorData?.locusResolution;
  if (trail?.route === "fallback" && trail.policyVersion !== LOCUS_POLICY_VERSION) return true;
  if (!trail && /fallback/i.test(result.predictorData?.source ?? "")) return true;

  // Protein-only VEP successes written before this policy could themselves select an arbitrary
  // allele. Coordinate-route results retain the user's exact verified allele instead.
  if (trail?.route !== "vep-coordinate" &&
      isIntrinsicallyAmbiguousProteinChange(result.metadata?.variant ?? "", result.metadata?.gene) &&
      (result.predictorData?.gnomadVariantId || result.predictorData?.caddPhred != null)) return true;

  // Old local population rows were selected by protein notation even on otherwise healthy VEP
  // runs. Refresh those outer bundles once; retain healthy remote gnomAD/predictor caches.
  const hadUnboundPopulationProducer = result.aouFrequency != null ||
    result.conservationData?.aouFrequency != null || result.gnomadFrequency?.dataset === "gnomad_r4_local";
  if (hadUnboundPopulationProducer && result.metadata?.populationPolicyVersion !== LOCUS_POLICY_VERSION) return true;

  /**
   * A FALLBACK locus is degraded whatever the intake lift record says, and is checked first.
   *
   * A protein-notation run carries a `not-needed` lift record (the analysis route defaults the build
   * to GRCh38), and that record used to short-circuit to "settled" below — so a run whose GRCh38
   * lookup failed and fell back to an hg19 locus was cached as a finished analysis and restored on
   * every later Recents click, withholding population evidence the variant does have (NAE1
   * p.Asp116Gly). The intake record describes what the user SUBMITTED; this describes what the
   * predictor FOUND, and only the second decides whether the evidence is complete.
   */
  if (isFallbackLocus(result)) return isRetryableFallbackLocus(result);

  const lift = result.coordinateLift;
  if (lift?.status === "unavailable") {
    return lift.reasonCode === undefined || isRetryableLiftRefusal(lift);
  }
  // A lift record of any other status settles the build question: lifted (canonical), not-needed
  // (already canonical) or not-applicable (cDNA/protein — no genomic build involved).
  if (lift) return false;

  /**
   * No trail at all: a payload written before the lift record existed. The only build signal left is
   * the assembly the frequency source was queried with, and a non-canonical value is exactly the state
   * the predictor cache itself refuses to persist.
   */
  const queriedAssembly = result.predictorData?.gnomadVariantAssembly;
  return Boolean(queriedAssembly) && queriedAssembly !== CANONICAL_ASSEMBLY;
}

/**
 * The build decision as the ANALYSIS route can establish it — derived, never accepted from the
 * caller.
 *
 * WHY IT EXISTS
 * -------------
 * The translate route knows things the analysis route cannot: whether a lift was ATTEMPTED, whether
 * its round-trip passed, and why it failed. So the translate response carries the authoritative
 * record. The analysis route is a different request, fed by a client, and accepting a
 * `coordinateLift` object from it would turn a disclosure back into client-assertable decoration —
 * anyone could post `{status:"lifted", reverseVerified:true}` and a rail would print "verified".
 *
 * What the caller CAN supply are facts: the submitted coordinate with its build, and the canonical
 * locus the translation step handed it. This function writes the interpretation of those facts, and
 * the pair is bound downstream by the coordinate-first predictor query (contig/position/REF echo,
 * gene, and substitution — `vep-orchestrator`), so a fabricated canonical locus cannot survive it.
 * Statuses the analysis route cannot observe are therefore not invented: it reports `lifted` for a
 * complete pair, `not-needed` for a canonical submitted build, and `unavailable` for a non-canonical
 * one that arrived without a canonical pair.
 */
export function deriveCoordinateLift(params: {
  submittedAssembly?: GenomeAssembly | null;
  submittedCoordinates?: string | null;
  resolvedAssembly?: GenomeAssembly | null;
  liftedGenomicCoordinates?: string | null;
}): CoordinateLiftRecord | undefined {
  const submitted = params.submittedAssembly ?? null;
  if (!submitted) return undefined;

  const parsedLifted = params.liftedGenomicCoordinates
    ? parseGenomicCoordinateString(params.liftedGenomicCoordinates)
    : null;
  const toCoordinates = parsedLifted
    ? `${parsedLifted.chrom}-${parsedLifted.pos}-${parsedLifted.ref}-${parsedLifted.alt}`
    : undefined;
  const fromCoordinates = params.submittedCoordinates ?? undefined;

  if (parsedLifted && params.resolvedAssembly) {
    return {
      status: "lifted",
      fromAssembly: submitted,
      toAssembly: params.resolvedAssembly,
      ...(fromCoordinates ? { fromCoordinates } : {}),
      toCoordinates,
      reverseVerified: true,
    };
  }

  if (submitted !== CANONICAL_ASSEMBLY) {
    return {
      status: "unavailable",
      fromAssembly: submitted,
      toAssembly: submitted,
      ...(fromCoordinates ? { fromCoordinates } : {}),
      /**
       * NO `reasonCode`, deliberately. This route never attempted a lift, so it cannot know whether
       * one would have been refused for a retryable reason or for a fact about the reference — and a
       * code invented here would be the one field a caller branches on. Absent reads as "not
       * established", which is true and is the conservative answer for `isRetryableLiftRefusal`.
       */
      reason:
        `the coordinate was not verified on the ${CANONICAL_ASSEMBLY} reference, so it was ` +
        `annotated on the ${submitted} reference, whose annotation release predates MANE Select`,
    };
  }

  return {
    status: "not-needed",
    fromAssembly: submitted,
    toAssembly: submitted,
    ...(fromCoordinates ? { fromCoordinates } : {}),
  };
}

export const literatureSummaryReceiptSchema = z.object({
  citations: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().nullable(), tier: z.number() })),
  scopes: z.object({ gene: z.enum(["complete", "unavailable", "error"]), variant: z.enum(["complete", "unavailable", "error"]), curated: z.enum(["complete", "unavailable", "error"]) }),
  coverage: z.array(z.object({ scope: z.string(), query: z.string(), loaded: z.number(), matched: z.number().nullable(), state: z.enum(["complete", "error"]), truncated: z.boolean() }))
});

export const verifiedLiteratureAliasSchema = z.object({
  notation: z.string().max(200), gene: z.string(), proteinVariant: z.string(), uniprotId: z.string(),
  source: z.enum(["ensembl-vep", "variant-validator"])
});
export type VerifiedLiteratureAlias = z.infer<typeof verifiedLiteratureAliasSchema>;

export const translateVariantResponseSchema = z.object({
  literatureAliases: z.array(verifiedLiteratureAliasSchema).optional(),
  gene: z.string(),
  variant: z.string(),
  uniprotId: z.string(),
  /**
   * Present when the provider named the resolved gene with a RETIRED symbol that UniProt lists as a
   * synonym of this entry, so `gene` is the current HGNC symbol instead (Ensembl's GRCh37 archive
   * answers `CPSF3L` for `INTS11`). Records the swap rather than hiding it.
   */
  geneSymbolUpdated: z.object({ from: z.string(), to: z.string() }).optional(),
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  /**
   * ENSEMBL canonical (VEP's `canonical` flag), NOT "numbered on the canonical UniProt isoform".
   * A MANE Select transcript is routinely the Ensembl canonical one while being numbered on a
   * different UniProt isoform, so this flag must never be read as a statement about numbering —
   * `numberingBasis`/`numberingVerified` are the fields that answer that.
   */
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().optional(),
  /** UniProt isoform the returned `variant` is numbered on (normally the canonical isoform). */
  uniprotIsoform: z.string().optional(),
  /**
   * Protein accession the numbering follows when the provider named no UniProt isoform
   * (VariantValidator reports `NP_…`). Present so an `unverified` basis is still checkable.
   */
  numberingProteinId: z.string().optional(),
  /**
   * How the numbering basis was established: `canonical` (verified against the canonical
   * accession), `remapped` (renumbered onto it), or `unverified` (the provider stated no basis,
   * so residue numbers may not match the canonical sequence). `unsupported` is never returned
   * with 200 — it is a 422 `ISOFORM_NUMBERING_MISMATCH`.
   */
  numberingBasis: z.enum(["canonical", "remapped", "unverified"]).optional(),
  /** False only for `unverified`; mirrored as a boolean so callers can gate on it directly. */
  numberingVerified: z.boolean().optional(),
  numberingUnverifiedReason: z.string().optional(),
  /**
   * Present when the MANE-resolved notation was renumbered onto the canonical UniProt
   * isoform, because the upstream structural pipeline (AlphaFold DB / PDB) models only
   * canonical sequences. Records both notations so a report can state what changed.
   */
  numberingRemap: numberingRemapSchema.optional(),
  genomicCoordinates: z.string().nullable().optional(),
  /**
   * Genome build the SUBMITTED coordinate is expressed in — the caller's own spelling, from an
   * inline `(GRCh38)`/`(hg19)` annotation or a RefSeq chromosome accession.
   *
   * NOT the build the annotation ran against: that is `resolvedAssembly`. The two differ exactly
   * when a GRCh37 coordinate was verified onto the canonical build first.
   *
   * Nullable to match `TranscriptMetadata` and the analysis-result schema: the three layers must
   * permit the same shapes, or a `null` one layer allows is a hard client parse failure in another.
   */
  assembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  /**
   * Build the returned `variant`/`uniprotId` were ANNOTATED on. Equals `assembly` unless the
   * submitted coordinate was verified onto the canonical build first (see `coordinateLift`), in
   * which case it is `"GRCh38"` while `assembly` still states what the user typed.
   *
   * Read this — not `assembly` — when asking "which reference release numbered this?".
   */
  resolvedAssembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  /**
   * Canonical-build locus (`chrom-pos-ref-alt`) when a lift was verified. Present only alongside
   * `coordinateLift.status === "lifted"`, and equal in locus to `genomicCoordinates` after the
   * lift — `genomicCoordinates` stays the coordinate the CALLER submitted, with its build.
   */
  liftedGenomicCoordinates: z.string().nullable().optional(),
  /** How the build was decided for this coordinate. Absent for protein-only notation. */
  coordinateLift: coordinateLiftSchema.nullable().optional(),
  /** Canonical form of the submitted notation after normalization (annotation stripped). */
  notationNormalized: z.string().optional(),
  /**
   * Prose explanation of the build decision: an inline annotation was honoured (or overridden by a
   * RefSeq accession that states a different build), or the coordinate was verified onto the
   * canonical reference, or it could not be and was annotated on the older archive. API prose for
   * reports and clients; the machine-readable twin is `coordinateLift`.
   */
  assemblyNote: z.string().optional(),
  /**
   * Which resolution provider answered, whether a fallback was used, and what else was
   * attempted. Offline-verifiable provenance for a clinical audit trail.
   */
  provenance: z
    .object({
      provider: z.string(),
      providerLabel: z.string(),
      usedFallback: z.boolean(),
      cacheHit: z.boolean(),
      attempts: z.array(
        z.object({
          provider: z.string(),
          ok: z.boolean(),
          durationMs: z.number(),
          reason: z.string().optional(),
          failureKind: z.string().optional()
        })
      )
    })
    .optional()
});

export const resolveGeneRequestSchema = z.object({
  gene: z.string()
});

export const resolveGeneResponseSchema = z.object({
  gene: z.string(),
  uniprotId: z.string(),
  pdbUrl: z.string().nullable().optional()
});

export type TranslateVariantRequest = z.infer<typeof translateVariantRequestSchema>;
export type TranslateVariantResponse = z.infer<typeof translateVariantResponseSchema>;
export type ResolveGeneRequest = z.infer<typeof resolveGeneRequestSchema>;
export type ResolveGeneResponse = z.infer<typeof resolveGeneResponseSchema>;

// ============================================================================
// 5. Nearest Residues Contract
// ============================================================================
export const nearestResiduesRequestSchema = z.object({
  pdbText: z.string().optional(),
  pdbRef: z.string().optional(),
  uniprotId: z.string().optional(),
  targetIndex: z.number(),
  distanceThreshold: z.number().positive().optional(),
  targetChain: z.string().optional()
}).refine(data => Boolean(data.pdbText || data.pdbRef || data.uniprotId), {
  message: "Either pdbText, pdbRef, or uniprotId must be provided."
});

export const nearestResidueItemSchema = z.object({
  index: z.number(),
  name: z.string(),
  distance: z.number(),
  properties: z.string(),
  role: z.string(),
  classBadge: z.string()
});

/**
 * Which exact structure a pocket/nearest computation ran on.
 *
 * Optional everywhere, so a payload cached before the field existed still parses. When present it is
 * provenance, not decoration: `resolvedFrom: "structureRef"` means the coordinates came from the
 * exact bytes this server returned for that reference, whereas `"uniprot-resolver"` means the legacy
 * accession ladder chose the template — which can differ from the structure on screen.
 */
export const structureResolutionEchoSchema = z.object({
  resolvedFrom: z.enum(STRUCTURE_RESOLUTION_SOURCES as unknown as [StructureResolutionSource, ...StructureResolutionSource[]]),
  structureRef: z.string().optional(),
  source: z.string().optional(),
  pdbId: z.string().optional(),
  chainId: z.string().optional(),
  /** The caller's text won over a resolvable reference because the two disagreed. */
  refTextMismatch: z.boolean().optional()
});

export const nearestResiduesResponseSchema = z.object({
  residues: z.array(nearestResidueItemSchema),
  source: z.string(),
  structureResolution: structureResolutionEchoSchema.optional()
});

export type NearestResiduesRequest = z.infer<typeof nearestResiduesRequestSchema>;
export type NearestResiduesResponse = z.infer<typeof nearestResiduesResponseSchema>;

// ============================================================================
// 6. Pocket Finder / Pocket Detect Contract
// ============================================================================
export const pocketFinderRequestSchema = z.object({
  pdbText: z.string(),
  mutIndex: z.number(),
  targetChain: z.string().optional()
});

export const pocketResidueSchema = z.object({
  index: z.number(),
  chain: z.string(),
  name: z.string(),
  distance: z.number(),
  score: z.number(),
  role: z.string(),
  type: z.string()
});

export const pocketFinderResponseSchema = z.object({
  pocketResidues: z.array(pocketResidueSchema),
  pocketScore: z.number(),
  pocketVolume: z.number(),
  likelyCofactor: z.string(),
  status: z.enum(["success", "fallback", "none_detected", "unavailable"]).catch("unavailable"),
  pocketDistance: z.number().nullable().optional(),
  /**
   * Distance to P2Rank's own cavity centre (`center_x/y/z`), which the client
   * prefers over `pocketDistance` — the latter is measured to the centroid of the
   * pocket's residues and grows with pocket size. Absent for fpocket results and
   * for payloads cached before the field existed.
   */
  cavityCentreDistance: z.number().nullable().optional(),
  sasPoints: z.number().optional(),
  surfaceAtoms: z.number().optional(),
  /**
   * Where the ambiguous numbers came from. `pocketScore` may be a calibrated
   * probability or a rescaled raw score, and `pocketVolume` a measured volume or
   * nothing at all; the client refuses to print a unit or a probability label it
   * cannot vouch for. Absent means unverified, never assumed.
   */
  provenance: z
    .object({
      engine: z.enum(["p2rank", "fpocket"]).optional(),
      scoreSource: z.enum(["probability", "rescaled_raw_score", "unavailable"]).optional(),
      volumeSource: z.enum(["measured", "unavailable", "scaled_surface_points"]).optional(),
      /** P2Rank model profile; its probabilities are calibrated per profile. */
      profile: z.string().optional()
    })
    .optional(),
  /**
   * Which exact structure the pocket was detected on. The queued response carries it (the job result
   * is produced by the worker, which only sees the text); optional so older payloads still parse.
   */
  structureResolution: structureResolutionEchoSchema.optional()
});

export type PocketFinderRequest = z.infer<typeof pocketFinderRequestSchema>;
export type PocketFinderResponse = z.infer<typeof pocketFinderResponseSchema>;

// ============================================================================
// 7. Biophysical Analysis Contract
// ============================================================================
export const biophysicalAnalysisRequestSchema = z.object({
  gene: z.string(),
  uniprotId: z.string(),
  variant: z.string(),
  wtPdb: z.string().optional(),
  /**
   * The genomic coordinate the protein notation was translated FROM, plus the build it belongs
   * to. Forwarded by the client whenever the user entered a genomic/cDNA notation, so the
   * predictor can query VEP by COORDINATE instead of re-deriving it from protein HGVS (which
   * Ensembl rejects for codon-ambiguous substitutions — the root of the unmapping defect).
   * `assembly` must accompany it: a coordinate without its declared build is not trusted.
   */
  genomicCoordinates: z.string().max(64).optional(),
  assembly: z.enum(["GRCh37", "GRCh38"]).optional(),
  /**
   * The CANONICAL-build locus and build, when the translation step verified them.
   *
   * Forwarded alongside the submitted pair, never instead of it: `genomicCoordinates`/`assembly`
   * describe what the user entered (and are what a report cites), while these describe the locus
   * the annotation actually came from. Consumers must prefer these for coordinate-first queries —
   * they are already on the build every coordinate-consuming source is pinned to, so no second lift
   * is needed and the annotation basis provably equals the locus being scored.
   */
  liftedGenomicCoordinates: z.string().max(64).optional(),
  resolvedAssembly: z.enum(["GRCh37", "GRCh38"]).optional(),
  /**
   * The build decision the translation step took (verified lift, or why none was possible).
   * Carried through to the payload so a result and a report can state the trail — and, when a
   * coordinate could not be verified on the canonical build, name the reason instead of leaving a
   * reader to guess why the annotation came from an older release.
   */
  coordinateLift: coordinateLiftSchema.optional(),
  /** The reader's answer to an ambiguity refusal: these residue numbers ARE canonical. */
  numberingBasis: z.enum(["canonical"]).optional(),
  options: z.any().optional()
});

const runtimeTimingFields = {
  serviceTimings: z.record(z.string(), z.number().finite().nonnegative()).optional(),
  /** Offsets mark settlement; consumers derive start = offset - duration. */
  serviceTimingOffsets: z.record(z.string(), z.number().finite().nonnegative()).optional(),
  structuralTimings: z.record(z.string(), z.number().finite().nonnegative()).optional(),
  structuralTimingOffsets: z.record(z.string(), z.number().finite().nonnegative()).optional(),
  cacheHit: z.boolean().optional(),
  cacheLayer: z.string().nullable().optional()
};

export const biophysicalAnalysisResponseSchema = z.object({
  ...runtimeTimingFields,
  analysis: z.string().nullable().optional(),
  biochemicalShift: z.string().optional(),
  structuralImpact: z.string().optional(),
  /**
   * The genome-build trail, declared here because THIS is the schema the client actually parses
   * (`biophysicsApi.getBiophysicalAnalysis` / `streamBiophysicalAnalysis`). The same four fields
   * were declared on `analyzeVariantResponseSchema`, which nothing parses at runtime, so they
   * survived this parse only through `passthrough()` — typed `unknown`, which is how a field that
   * travels with every payload ends up unreachable from the API's own declared return type.
   */
  assembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  resolvedAssembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  liftedGenomicCoordinates: z.string().nullable().optional(),
  coordinateLift: coordinateLiftSchema.nullable().optional(),
  literatureAliases: z.array(verifiedLiteratureAliasSchema).optional(),
  insights: z.object({
    literature: literatureSummaryReceiptSchema.optional(),
    biochemicalShift: z.string().optional(),
    structuralImpact: z.string().optional(),
    plausibility: z.string().optional(),
    acmgCriteria: z.array(z.object({
      code: z.string(),
      reason: z.string()
    })).optional()
  }).nullable().optional(),
  ruleBasedInsights: z.object({
    plausibility: z.string().optional(),
    acmgVerdict: z.string().optional(),
    acmgCriteria: z.array(z.object({
      code: z.string(),
      reason: z.string()
    })).optional()
  }).nullable().optional(),
  metadata: z.object({
    ...runtimeTimingFields,
    gene: z.string().optional(),
    variant: z.string().optional(),
    uniprotId: z.string().optional(),
    residueIndex: z.number().nullable().optional(),
    wildType: z.string().optional(),
    mutant: z.string().optional(),
    /**
     * The rest of what the server's builders put in `metadata` and what the client reads:
     * the structure viewer and the report name `pdbId`/`pdbSource`, the inspector shows
     * `mutatedSequence`, the narrative re-synthesis sends `sequence`, and `pdbId` gates the
     * 3D view's source. They were absent here, and a zod object strips what it does not
     * declare — so the parse at the end of both `biophysicsApi` calls deleted every one of
     * them before the store saw the payload, while the TypeScript types said they were
     * present. Declared to match `VariantMetadata`, with `passthrough` so the next field the
     * server adds is not silently dropped the same way.
     */
    sequence: z.string().nullable().optional(),
    mutatedSequence: z.string().nullable().optional(),
    pdbId: z.string().nullable().optional(),
    pdbSource: z.string().nullable().optional()
  }).passthrough().optional()
}).passthrough().transform((data: any) => {
  const shift = data.insights?.biochemicalShift || data.biochemicalShift;
  const impact = data.insights?.structuralImpact || data.structuralImpact;
  return {
    ...data,
    insights: data.insights || (shift || impact ? {
      biochemicalShift: shift || "",
      structuralImpact: impact || "",
      plausibility: data.insights?.plausibility,
      acmgCriteria: data.insights?.acmgCriteria || []
    } : null)
  };
});

export type BiophysicalAnalysisRequest = z.infer<typeof biophysicalAnalysisRequestSchema>;
export type BiophysicalAnalysisResponse = z.infer<typeof biophysicalAnalysisResponseSchema>;

// ============================================================================
// 8. ESMFold Contract
// ============================================================================
export const esmFoldRequestSchema = z.object({
  sequence: z.string().optional(),
  uniprotId: z.string().optional(),
  variant: z.string().optional(),
  wtSeq: z.string().optional(),
  mutSeq: z.string().optional()
});

export const esmFoldResponseSchema = z.object({
  pdb: z.string().optional(),
  wtPdb: z.string().optional(),
  mutPdb: z.string().optional(),
  chain: z.string().optional(),
  plddt: z.array(z.number()).optional(),
  status: z.enum(["success", "cached", "failed"]),
  /**
   * Which engine folded each structure (`server/services/structure/esmfold.ts`). Optional so an older
   * server still parses; the viewer then says the engine was not reported rather than guessing.
   */
  engines: z
    .object({
      wildType: z.string().nullable(),
      variant: z.string().nullable()
    })
    .optional()
});

export type EsmFoldRequest = z.infer<typeof esmFoldRequestSchema>;
export type EsmFoldResponse = z.infer<typeof esmFoldResponseSchema>;

// ============================================================================
// 9. Structural Align Contract
// ============================================================================
export const structuralAlignRequestSchema = z.object({
  pdb1: z.string(),
  pdb2: z.string(),
  targetIndex: z.number().optional(),
  alignmentScope: z.enum(["local", "global"]).optional()
});

export const structuralAlignResponseSchema = z.object({
  alignedPdb: z.string(),
  metrics: z.any()
});

export const structuralDiffResponseSchema = z.object({
  rmsd: z.number(),
  localRmsd: z.number().nullable().optional(),
  windowDisplacements: z.array(z.object({
    resSeq: z.number(),
    resName: z.string(),
    displacement: z.number()
  })),
  clashes: z.object({
    wtClashCount: z.number(),
    mutClashCount: z.number(),
    diff: z.number()
  })
});

export type StructuralAlignRequest = z.infer<typeof structuralAlignRequestSchema>;
export type StructuralAlignResponse = z.infer<typeof structuralAlignResponseSchema>;
export type StructuralDiffResponse = z.infer<typeof structuralDiffResponseSchema>;

// ============================================================================
// 10. Predictor & Conservation Canonical Domain Contracts
// ============================================================================
/**
 * What the All of Us lookup actually consulted, so an empty row can say which absence it is.
 *
 * Without it, "The local All of Us frequency table holds no entry" was printed for every empty row —
 * including when no local table is installed in the deployment and when the lookup never finished.
 *   - `localTable`: the local dbNSFP ingest (`server/services/prediction/local-population.ts`).
 *   - `remoteDbnsfp`: whether the dbNSFP record reached through the conservation lookup carried counts.
 */
export const aouLookupSchema = z.object({
  localTable: z.enum(["found", "absent", "not-installed", "failed", "timed-out"]),
  remoteDbnsfp: z.enum(["found", "not-reported"]),
});
export type AouLookup = z.infer<typeof aouLookupSchema>;

export const predictorDataSchema = z.object({
  available: z.boolean().optional(),
  amPathogenicity: z.number().nullable(),
  amClass: z.string().nullable(),
  caddPhred: z.number().nullable(),
  /**
   * Where the variant-level AlphaMissense / REVEL score was read from — the service tier and the
   * data release it carries, when known (e.g. "VEP AlphaMissense plugin", "local dbNSFP 5.0",
   * "myvariant.info dbNSFP (release not stated)"). Purely additive provenance: it never changes
   * the score itself. The Landscape tab's rank cross-check reads it to name a release gap when
   * its own table — also dbNSFP, via its own fetch path — disagrees with this score.
   */
  amProvenance: z.string().nullable().optional(),
  revelProvenance: z.string().nullable().optional(),
  gnomadVariantId: z.string().nullable().optional(),
  /**
   * Genome build that `gnomadVariantId`'s numeric coordinates belong to.
   *
   * REQUIRED TO BE EXPLICIT, and deliberately nullable. The id is produced two ways and they
   * disagree: the Ensembl VEP path queries the GRCh38 host, while the MyVariant.info fallback
   * parses `hit._id`, which is hg19 by default and carries no build marker. Several downstream
   * sources are single-build (GPN-Star, local dbNSFP, Genos, dbnsfp.org, gnomAD r4, AlphaGenome,
   * and one SpliceAI service per build), and a wrong-build coordinate does not merely miss —
   * when the other build's base at that numeric position coincides, it scores a DIFFERENT LOCUS
   * and the result is attributed to this variant.
   *
   * `null` therefore means "build unknown" and must never be treated as a default: an inferred
   * build is indistinguishable from a verified one, which is exactly how the wrong-locus case
   * slipped through. Consumers refuse a coordinate with an unknown or unsupported build.
   */
  gnomadVariantAssembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  /**
   * How the locus above was established on this run: which route answered, how the GRCh38 locus
   * was verified (or why it was not), and whether a re-run could change that. Optional — payloads
   * written before it existed are read through `isFallbackLocus` (src/shared/locusResolution.ts).
   */
  locusResolution: locusResolutionSchema.nullable().optional(),
  proteinName: z.string().nullable().optional(),
  transcriptId: z.string().optional(),
  /**
   * Ensembl transcript of the UniProt CANONICAL isoform — the sequence this platform models.
   * `transcriptId` is the selected (usually MANE) consequence's transcript, which for genes like
   * ACOT9 is a DIFFERENT isoform's model; splice-junction geometry must be resolved against the
   * canonical model so "Exon N of M" describes the same numbering the protein evidence does
   * (unmapping defect F-16).
   */
  canonicalEnsemblId: z.string().nullable().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().nullable().optional(),
  source: z.string().optional()
});

export const alphagenomeAviSchema = z.object({
  status: z.enum(["live", "unavailable", "pending"]).default("unavailable"),
  aviPhred: z.number().nullable().optional(),
  aviRaw: z.number().nullable().optional(),
  aviQuantile: z.number().nullable().optional(),
  topPercentile: z.number().nullable().optional(),
  topModality: z.string().nullable().optional(),
  topFeatureImportance: z.number().nullable().optional(),
  featureAttributions: z.record(z.string(), z.number()).nullable().optional(),
  /**
   * An app-defined banding of the AVI Phred rank, NOT a ClinGen-calibrated ACMG strength (none exists
   * for the AVI). The engine never counts it; the name is kept only because payloads persist it.
   */
  acmgStrength: z.enum([
    "PP3_Strong",
    "PP3_Moderate",
    "PP3_Supporting",
    "BP4_Supporting",
    "BP4_Moderate",
    "indeterminate"
  ]).default("indeterminate"),
  atlasUrl: z.string().optional(),
  message: z.string().nullable().optional()
}).nullable();

export type AlphaGenomeAviData = z.infer<typeof alphagenomeAviSchema>;

export const alphaGenomeRegionSaturationRequestSchema = z.object({
  chrom: z.string(),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  transcriptId: z.string().optional(),
  strand: z.enum(["+", "-"]).optional(),
  exonNumber: z.number().int().optional(),
  exonStart: z.number().int().optional(),
  exonEnd: z.number().int().optional()
}).refine((data) => data.start <= data.end, {
  message: "start must be less than or equal to end",
  path: ["end"]
}).refine((data) => (data.end - data.start) <= 5000, {
  message: "Genomic window size cannot exceed 5,000 bp",
  path: ["end"]
});
export type AlphaGenomeRegionSaturationRequest = z.infer<typeof alphaGenomeRegionSaturationRequestSchema>;

/** The range the Broad SpliceAI Lookup accepts for its reporting window (-D); its own limit is 10,000. */
export const SPLICEAI_DISTANCE_RANGE = { min: 50, max: 10_000 } as const;

/**
 * `POST /spliceai/score` — re-score ONE variant under a chosen reporting window. Shared by the route and
 * by the RNA splicing tab's inline window control, so what the client sends is checked against what the
 * server accepts by the same definition.
 */
export const spliceAiScoreRequestSchema = z.object({
  /** `chrom-pos-ref-alt`, the form `metadata.genomicCoordinates` carries. */
  coordinates: z.string().min(5).max(200),
  assembly: z.enum(["GRCh37", "GRCh38"]).default("GRCh38"),
  distance: z.number().int().min(SPLICEAI_DISTANCE_RANGE.min).max(SPLICEAI_DISTANCE_RANGE.max),
});
export type SpliceAiScoreRequest = z.input<typeof spliceAiScoreRequestSchema>;

export const alphaGenomeSaturationVariantSchema = z.object({
  alt: z.enum(["A", "C", "G", "T"]),
  phred: z.number().nullable(),
  raw: z.number().nullable().optional(),
  acmgStrength: z.enum([
    "PP3_Strong",
    "PP3_Moderate",
    "PP3_Supporting",
    "BP4_Supporting",
    "BP4_Moderate",
    "indeterminate"
  ]),
  topModality: z.string().nullable().optional()
});
export type AlphaGenomeSaturationVariant = z.infer<typeof alphaGenomeSaturationVariantSchema>;

export const alphaGenomeSaturationPositionSchema = z.object({
  pos: z.number().int().positive(),
  ref: z.enum(["A", "C", "G", "T"]),
  isExonic: z.boolean(),
  codonIndex: z.number().int().nullable().optional(),
  codonPosition: z.number().int().min(1).max(3).nullable().optional(),
  variants: z.record(z.string(), alphaGenomeSaturationVariantSchema),
  meanPhred: z.number().nullable(),
  maxPhred: z.number().nullable(),
  topModality: z.string().nullable().optional()
});
export type AlphaGenomeSaturationPosition = z.infer<typeof alphaGenomeSaturationPositionSchema>;

export const alphaGenomeRegionSaturationResponseSchema = z.object({
  status: z.enum(["live", "unavailable", "pending"]),
  chrom: z.string(),
  start: z.number(),
  end: z.number(),
  strand: z.enum(["+", "-"]).nullable().optional(),
  transcriptId: z.string().nullable().optional(),
  exonNumber: z.number().nullable().optional(),
  exonStart: z.number().nullable().optional(),
  exonEnd: z.number().nullable().optional(),
  positions: z.array(alphaGenomeSaturationPositionSchema),
  atlasLocusUrl: z.string().optional(),
  message: z.string().nullable().optional()
});
export type AlphaGenomeRegionSaturationResponse = z.infer<typeof alphaGenomeRegionSaturationResponseSchema>;

export interface AtlasUrls {
  variantUrl: string;
  trackPredictionsUrl: string;
  locusUrl: string;
  variantStr: string;
}

/**
 * Robustly parses genomic coordinate strings in hyphen, colon, or Ensembl notation:
 * e.g., "chr9:128225994:G>A", "9-128225994-G-A", "chr11:5225488:A-T".
 *
 * The output feeds URL path segments and cache keys downstream, so it is strictly shaped:
 * exactly four components (trailing junk like "X-100-C-A-extra" is a malformed input, not a
 * variant), and a bounded position — the largest human chromosome is ~250 Mb, and an
 * unbounded parseInt("9".repeat(21)) interpolates "1e+21" into a URL (review L-3/L-10).
 */
export function parseGenomicCoordinateString(rawId?: string | null): { chrom: string; pos: number; ref: string; alt: string } | null {
  if (!rawId || typeof rawId !== "string") return null;
  const parts = rawId.trim().replace(/[:>/_]/g, "-").split("-");
  if (parts.length === 4) {
    const chrom = parts[0];
    const pos = parseInt(parts[1], 10);
    const ref = parts[2].toUpperCase();
    const alt = parts[3].toUpperCase();
    const validChrom = /^(chr)?([1-9]|1\d|2[0-2]|X|Y|M|MT)$/i.test(chrom);
    const validBases = /^[ACGTN]+$/.test(ref) && /^[ACGTN]+$/.test(alt);
    if (validChrom && !isNaN(pos) && pos > 0 && pos <= 400_000_000 && validBases) {
      return { chrom, pos, ref, alt };
    }
  }
  return null;
}

/**
 * The coordinate a coordinate-first predictor query should use, paired with its build.
 *
 * WHY IT LIVES IN SHARED
 * ----------------------
 * Two server call sites built this by hand, and both read only the SUBMITTED pair — so a GRCh37
 * input reached the predictor tagged GRCh37 and was lifted a second time downstream (or refused by
 * every GRCh38-only source). The whole job here is PAIRING, and a coordinate paired with the wrong
 * build is the wrong-locus hazard `src/shared/assembly.ts` exists to prevent: a GRCh37 position
 * handed to a GRCh38 index either misses or, when the reference base coincides, scores a different
 * locus and returns plausible numbers attributed to this variant.
 *
 * The lifted pair wins when present because it is the one the translation step VERIFIED, and a
 * lifted coordinate is canonical by construction. Anything unparseable is ignored — never coerced.
 */
export function predictorCoordinateFromContext(context: {
  genomicCoordinates?: string | null;
  assembly?: GenomeAssembly | null;
  liftedGenomicCoordinates?: string | null;
  resolvedAssembly?: GenomeAssembly | null;
}): AssemblyTaggedCoordinate | null {
  /**
   * The lifted pair is used only when BOTH halves are present.
   *
   * This is the same rule the analysis intake applies (`variant-parser` drops an unpaired canonical
   * coordinate) and the one `doc/API.md` states — "a canonical coordinate sent without its build is
   * dropped, never assumed canonical". An earlier version defaulted the missing build to
   * `CANONICAL_ASSEMBLY`, which was *probably* right but put the safety in a doc sentence rather
   * than in the helper: a coordinate's build is never ours to infer. Falling through to the
   * submitted pair is not a loss — the predictor lifts that coordinate itself, exactly as it did
   * before lift-first existed.
   */
  const lifted = context.liftedGenomicCoordinates
    ? parseGenomicCoordinateString(context.liftedGenomicCoordinates)
    : null;
  if (lifted && context.resolvedAssembly) {
    return { ...lifted, assembly: context.resolvedAssembly };
  }

  const submitted = context.genomicCoordinates
    ? parseGenomicCoordinateString(context.genomicCoordinates)
    : null;
  return submitted ? { ...submitted, assembly: context.assembly ?? CANONICAL_ASSEMBLY } : null;
}

/**
 * Constructs validated deep-link URLs to the Google DeepMind AlphaGenome Atlas with RFC 3986 encoding.
 */
export function generateAtlasUrls(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  flankBp = 20000
): AtlasUrls {
  const normChrom = chrom.toLowerCase().startsWith("chr") ? chrom : `chr${chrom}`;
  const variantStr = `${normChrom}:${pos}:${ref.toUpperCase()}>${alt.toUpperCase()}`;
  const encodedVariant = variantStr.replace(/>/g, "%3E");

  const startCoord = Math.max(1, pos - flankBp);
  const endCoord = pos + flankBp;
  const intervalStr = `${normChrom}:${startCoord}-${endCoord}`;

  return {
    variantUrl: `https://deepmind.google.com/science/alphagenome/atlas/variant/${encodedVariant}`,
    trackPredictionsUrl: `https://deepmind.google.com/science/alphagenome/atlas/track-predictions?v=${encodedVariant}`,
    locusUrl: `https://deepmind.google.com/science/alphagenome/atlas/locus?interval=${intervalStr}`,
    variantStr
  };
}

export const conservationDataSchema = z.object({
  available: z.boolean().optional(),
  revel: z.number().nullable(),
  /**
   * Where the variant-level REVEL score was read from (tier + release when known). Additive
   * provenance only; see `predictorDataSchema.revelProvenance`.
   */
  revelProvenance: z.string().nullable().optional(),
  gerp: z.number().nullable(),
  phylop: z.number().nullable(),
  consurf: z.number().nullable(),
  bayesdel: z.number().nullable().optional(),
  metarnn: z.number().nullable().optional(),
  metarnnPred: z.string().nullable().optional(),
  clinpred: z.number().nullable().optional(),
  clinpredPred: z.string().nullable().optional(),
  eigenPhred: z.number().nullable().optional(),
  eigenRaw: z.number().nullable().optional(),
  dann: z.number().nullable().optional(),
  esm1b: z.number().nullable().optional(),
  esm1bPred: z.string().nullable().optional(),
  popeve: z.number().nullable().optional(),
  gpnStar: z.number().nullable().optional(),
  gpnStarStatus: z.enum(["live", "token_required", "unavailable"]).optional(),
  gpnStarMessage: z.string().nullable().optional(),
  aouFrequency: z.object({
    aouAC: z.number().nullable(),
    aouAN: z.number().nullable(),
    aouHet: z.number().nullable(),
    aouHom: z.number().nullable(),
    aouAF: z.number().nullable().optional()
  }).nullable().optional(),
  spliceProximity: z.object({
    distance: z.number(),
    isNearSpliceSite: z.boolean(),
    /**
     * Nearest boundary is a genuine exon/intron junction (donor/acceptor), not a
     * transcript terminus. Optional so payloads predating the field still parse.
     */
    isCanonicalJunction: z.boolean().optional(),
    exonNumber: z.number().nullable().optional(),
    totalExons: z.number().nullable().optional(),
    exonId: z.string().nullable().optional(),
    exonStart: z.number().nullable().optional(),
    exonEnd: z.number().nullable().optional(),
    exonLength: z.number().nullable().optional(),
    /**
     * The transcript's exons within reach of the splice map (±2.5 kb of the variant), numbered in
     * transcript order, 1-based inclusive genomic coordinates. Absent on payloads from before the
     * map drew neighbouring exons; the map then draws only the nearest exon from `exonLength`.
     */
    nearbyExons: z.array(z.object({ number: z.number(), start: z.number(), end: z.number() })).optional(),
    intronNumber: z.number().nullable().optional(),
    junctionType: z.enum(["donor", "acceptor", "terminal"]).nullable().optional(),
    adjacentIntronNumber: z.number().nullable().optional(),
    regionType: z.enum(["exonic", "intronic"]).nullable().optional(),
    strand: z.enum(["+", "-"]).nullable().optional(),
    transcriptId: z.string().nullable().optional(),
    genomicPos: z.number().nullable().optional(),
    nearestJunctionCoord: z.number().nullable().optional(),
    mutationPosition: z.number().nullable().optional(),
    closestBoundary: z.enum(["start", "end", "unknown"]).optional(),
    closestSpliceType: z.enum(["acceptor", "donor", "unknown"]).optional()
  }).nullable().optional(),
  spliceai: z.object({
    ds_ag: z.number().nullable(),
    ds_al: z.number().nullable(),
    ds_dg: z.number().nullable(),
    ds_dl: z.number().nullable(),
    max_ds: z.number().nullable(),
    /**
     * Where splicing changes relative to the variant (negative = upstream). A large |dp|
     * alongside a small delta score is the signature of a variant far from any junction,
     * which the delta score alone cannot convey. Absent for payloads scored before the
     * Broad Lookup API became the source.
     */
    dp: z.object({
      ds_ag: z.number().nullable(),
      ds_al: z.number().nullable(),
      ds_dg: z.number().nullable(),
      ds_dl: z.number().nullable()
    }).optional(),
    /**
     * Provenance for the score, so a reader can tell a live model computation from a
     * frozen precomputed table. Illumina's precomputed columns were generated against
     * GENCODE v24 with a 50 bp reporting window; the Broad Lookup API computes against a
     * current annotation. Those differences move scores, so the source must be visible.
     */
    provenance: z.object({
      /** "broad-lookup" (live) or "precomputed-dbnsfp" (frozen table). */
      source: z.enum(["broad-lookup", "precomputed-dbnsfp", "genos"]),
      /** Reporting window the score was produced under (SpliceAI -D). */
      distanceBp: z.number().nullable().optional(),
      /** 1 = masked (recommended for interpretation), 0 = raw. */
      masked: z.number().nullable().optional(),
      /** True when the model ran for this request rather than a table answering. */
      computedLive: z.boolean().optional(),
      annotationSet: z.string().nullable().optional(),
      /** The transcript the model's own annotation names, when the service answered for one. */
      transcriptId: z.string().nullable().optional()
    }).optional()
  }).nullable().optional(),
  /**
   * Why the live SpliceAI request produced no score, when one was made. Absent on a payload
   * that carries a score, and on payloads from before this field existed (the tab then says
   * the reason was not recorded rather than inferring one). `coordinate-rejected` is the
   * service refusing the variant itself — most often a REF that does not match the genome.
   */
  spliceaiFailure: z.object({
    kind: z.enum(["rate-limited", "coordinate-rejected", "upstream-error", "timeout", "network", "unreadable", "no-transcript"]),
    httpStatus: z.number().nullable(),
    detail: z.string().nullable()
  }).nullable().optional(),
  dbscsnv: z.object({
    ada_score: z.number().nullable(),
    rf_score: z.number().nullable()
  }).nullable().optional(),
  alphagenome: alphagenomeAviSchema.optional(),
  /**
   * Per-source build refusals that produced this payload (unmapping defect F-13).
   *
   * When the assembly gate declines a source ("alphagenome covers GRCh38; this coordinate is
   * GRCh37 and was not scored"), the ABSENCE used to reach the client with no reason attached,
   * and each surface filled the vacuum with its own guess — "Awaiting API key", "Outside
   * Consensus Zone", "Transcript coordinates mapped". The reason now travels on the payload so
   * the panes can state what actually happened. Carried as a reason list rather than as
   * fabricated status objects: "never asked" must stay distinguishable from "asked and
   * unavailable" (see splicingEvidence's hasAlphaGenome contract).
   */
  assemblyRefusals: z.array(z.object({
    source: z.string(),
    reason: z.string(),
    /**
     * True when the refusal is a consequence of a FALLBACK locus (the GRCh38 lookup failed on this
     * run) rather than of a build the user chose. Surfaces read it as retryable, not "Not covered".
     */
    retryable: z.boolean().optional(),
    /** Same locus failure vocabulary across coordinate-keyed evidence sources. */
    failureKind: locusFailureKindSchema.optional(),
    /** The remedy is an original nucleotide allele, not another provider request. */
    inputRequired: z.boolean().optional()
  })).nullable().optional(),
  source: z.string().optional()
});

export type PredictorData = z.infer<typeof predictorDataSchema>;
export type ConservationData = z.infer<typeof conservationDataSchema>;

// ============================================================================
// 11. Generate Mutant & Full Pipeline Analysis Response Schemas
// ============================================================================
/** `JobRunsOn` (`jobPlacement.ts`) on the wire. */
export const jobRunsOnSchema = z.object({
  where: z.enum(["server", "your_computer", "teammate_computer"]),
  computerName: z.string().nullable(),
  started: z.boolean(),
  expectedMs: z.object({ p50: z.number().finite(), p90: z.number().finite() }).nullable(),
  basis: z.enum(["measured", "prior"]).nullable(),
  samples: z.number().finite().nullable(),
  reasons: z.array(z.string()),
});

export const generateMutantResponseSchema = z.object({
  pdb: z.string().nullable().optional(),
  /**
   * FoldX BuildModel's paired wild type (`WT_wt_1_0.pdb`): the repaired template with its side
   * chains repacked in the same run. The variant's own reference; absent on older cached results.
   */
  wtReferencePdb: z.string().nullable().optional(),
  ddG: nullableFiniteNumber,
  status: z.string(),
  error: z.string().nullable().optional(),
  foldedResidueIndex: nullableFiniteNumber.optional(),
  foldxJobId: z.string().nullable().optional(),
  /**
   * Progress for a queued/running job, so the client can render the stage the WORKER is in rather
   * than inferring one from elapsed time. Absent on an immediate (cached) result.
   *
   * The enum is built from {@link FOLDX_PHASES} rather than restated: a hardcoded copy meant that
   * adding a phase to the vocabulary made a newer server's response fail this schema, and the
   * client's `safeParse` fallback then used the UNVALIDATED raw payload for the whole contract.
   */
  phase: foldxPhaseSchema.nullable().optional(),
  startedAt: nullableFiniteNumber.optional(),
  /**
   * Execution time the SERVER measured, in ms, or null while the job is queued.
   *
   * A duration rather than a start timestamp so the client never subtracts its own clock from the
   * compute host's (production computes on a remote instance, where the skew between them would be
   * added to every displayed age).
   */
  elapsedMs: nullableFiniteNumber.optional(),
  queuedAhead: nullableFiniteNumber.optional(),
  /** Estimated wait before the job starts, in ms; null when the server has no estimate for what is ahead. */
  queuedEtaMs: nullableFiniteNumber.optional(),
  /** Where the job runs and why (live routing); null when it is simply the server's. `jobPlacement.ts`. */
  runsOn: jobRunsOnSchema.nullable().optional(),
  energetics: energeticsDataSchema.optional(),
  dynamut2JobId: z.string().nullable().optional(),
  dynamut2Status: z.string().nullable().optional(),
  ddmutJobId: z.string().nullable().optional(),
  ddmutStatus: z.string().nullable().optional(),
  thermompnnJobId: z.string().nullable().optional(),
  thermompnnStatus: z.string().nullable().optional(),
  thermompnnError: z.string().nullable().optional(),
  /** Values from independent engines that finish while the FoldX job is still running. */
  engineUpdates: energeticsDataSchema.partial().extend({
    foldxStatus: z.enum(["success", "failed", "unavailable"]).optional(),
  }).optional(),
  provenance: structureProvenanceSchema.passthrough().optional()
}).passthrough();

export type GenerateMutantResponse = z.infer<typeof generateMutantResponseSchema>;

/**
 * One residue of the Landscape tab, read on ONE transcript (see
 * server/services/prediction/landscape-aggregate.ts). Counts are distinct missense substitutions
 * (alternative amino acids reachable by one SNV), so never
 * above 9; `gerp` / `phylop` are means over the codon's distinct nucleotides.
 */
export const landscapeResidueSchema = z.object({
  residx: z.number(),
  aaref: z.string().nullable().optional(),
  refMismatch: z.boolean().optional(),
  revelMean: z.number().nullable().optional(),
  revelMin: z.number().nullable().optional(),
  revelMax: z.number().nullable().optional(),
  revelCount: z.number().optional(),
  amMean: z.number().nullable().optional(),
  amMin: z.number().nullable().optional(),
  amMax: z.number().nullable().optional(),
  amCount: z.number().optional(),
  gerp: z.number().nullable(),
  phylop: z.number().nullable(),
  nucleotideCount: z.number().optional(),
  substitutions: z.array(z.object({ alt: z.string(), am: z.number().nullable(), revel: z.number().nullable() })).optional()
});

/** Where the landscape rows came from, on which transcript, and what went wrong reading them. */
export const landscapeMetaSchema = z.object({
  source: z.enum(["dbnsfp-local", "myvariant", "none"]),
  sourceVersion: z.string().nullable(),
  transcript: z.string().nullable(),
  transcriptBasis: z.enum(["mane", "ensembl-canonical", "sequence-match", "most-covered", "unknown"]),
  window: z.object({ start: z.number(), end: z.number() }).nullable(),
  referenceSequence: z.string().nullable(),
  qualityFlags: z.array(z.string()),
  cached: z.boolean(),
  retrievedAt: z.string()
});

export type LandscapeMeta = z.infer<typeof landscapeMetaSchema>;

/** Gene-wide context for the Landscape overview (server/services/prediction/landscape-context.ts). */
export const landscapeContextSchema = z.object({
  clinvar: z.array(z.object({
    pos: z.number(),
    cls: z.enum(["plp", "blb", "other"]),
    significance: z.string(),
    stars: z.number().nullable(),
    hgvsp: z.string()
  })).nullable(),
  gnomad: z.array(z.object({ pos: z.number(), variants: z.number(), maxAc: z.number() })).nullable(),
  regions: z.array(z.object({ start: z.number(), end: z.number(), oe: z.number().nullable(), pValue: z.number().nullable() })).nullable(),
  /**
   * Why `regions` holds what it holds, so the lane never calls a withheld map "not loaded":
   *   available        — protein-mapped intervals are present;
   *   none             — the source answered; this transcript has no constrained interval;
   *   withheld-mapping — intervals exist but no verified transcript→protein mapping is available;
   *   unavailable      — the constraint source did not answer.
   */
  regionsStatus: z.enum(["available", "none", "withheld-mapping", "unavailable"]),
  transcript: z.string().nullable(),
  regionsBasis: z.string(),
  errors: z.array(z.string())
});
export type LandscapeContext = z.infer<typeof landscapeContextSchema>;

export const landscapeOverviewResponseSchema = z.object({
  positions: z.array(landscapeResidueSchema),
  meta: landscapeMetaSchema,
  context: landscapeContextSchema.optional().nullable()
});
export type LandscapeOverview = z.infer<typeof landscapeOverviewResponseSchema>;

export const landscapeContextResponseSchema = z.object({
  context: landscapeContextSchema
});
export type LandscapeContextResponse = z.infer<typeof landscapeContextResponseSchema>;

export const analyzeVariantResponseSchema = z.object({
  analysis: z.string().nullable().optional(),
  isFallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  fallbackMessage: z.string().optional(),
  fallbackRetryable: z.boolean().optional(),
  providerDetail: z.string().optional(),
  attemptedModels: z.array(z.string()).optional(),
  insights: z.object({
    biochemicalShift: z.string(),
    structuralImpact: z.string(),
    pathogenicity: z.string().optional(),
    plausibility: z.string().optional(),
    acmgCriteria: z.preprocess(
      (val) => val ?? [],
      z.array(acmgCriteriaItemSchema)
    ),
    acmgVerdict: z.string().optional(),
    /**
     * Inference provenance carried beside the prose.
     *
     * Declared so the schema matches what the route returns and `AnalyzeVariantResponse` — which is
     * inferred from this schema — does not disagree with the server about the payload's shape. That
     * drift is the reason the `metadata` block below carries its own note; here it is the smaller
     * half of the story.
     *
     * It is NOT the half that was losing the values. This route's response is validated at runtime by
     * `src/api/clinicalApi.ts` with `insights: z.any()`, so zod was never stripping these fields on
     * this path — the client reducer in `src/services/pipeline/narrativeService.ts` was, by naming
     * every field it kept. Recorded here because the first version of this comment blamed zod, and a
     * comment that names the wrong cause is worse than none: the next reader would have hardened the
     * schema and left the reducer alone.
     */
    model: z.string().optional(),
    source: z.enum(["ai_inference", "rule_based"]).optional(),
    literature: literatureSummaryReceiptSchema.optional(),
    partialEvidence: z.object({
      available: z.array(z.string()),
      unavailable: z.array(z.string())
    }).optional()
  }).nullable().optional(),
  ruleBasedInsights: z.object({
    plausibility: z.string(),
    acmgVerdict: z.string(),
    acmgCriteria: z.array(acmgCriteriaItemSchema),
    partialEvidence: z.object({
      available: z.array(z.string()),
      unavailable: z.array(z.string())
    }).optional()
  }).nullable().optional(),
  clinvar: clinVarDataSchema.nullable().optional(),
  metadata: z.object({
    gene: z.string(),
    variant: z.string(),
    uniprotId: z.string(),
    residueIndex: nullableFiniteNumber,
    wildType: z.string(),
    mutant: z.string(),
    pdbId: z.string().nullable().optional(),
    pdbSource: z.string().nullable().optional(),
    sequence: z.string().nullable().optional(),
    ...runtimeTimingFields,
    serviceStatus: z.record(z.string(), z.string()).optional(),
    /** Version of exact-allele population binding; legacy local observations are refreshed once. */
    populationPolicyVersion: z.number().int().positive().optional()
  }).passthrough(),
  predictorData: predictorDataSchema.nullable().optional(),
  conservationData: conservationDataSchema.nullable().optional(),
  landscapeData: z.array(landscapeResidueSchema).nullable().optional(),
  landscapeMeta: landscapeMetaSchema.nullable().optional(),
  stringInteractions: z.array(z.object({
    partner: z.string(),
    score: finiteNumber
  })).nullable().optional(),
  disruptionPredictor: z.object({
    level: z.enum(["high", "low", "unknown"]),
    reason: z.string(),
    plddt: z.number().nullable(),
    bFactor: z.number().nullable().optional(),
    bFactorKind: z.enum(["plddt", "temperature-factor", "unknown"]).optional(),
    burialStatus: z.enum(["core", "surface", "boundary"]).optional(),
    neighborCount: z.number().optional(),
    rsa: z.number().nullable().optional(),
    sasa: z.number().nullable().optional(),
    /** Why accessibility was not measured, when the SASA step failed. */
    sasaUnavailableReason: z.string().optional()
  }).optional(),
  uniprotFeatures: z.object({
    features: z.array(z.object({
      type: z.string(),
      description: z.string(),
      start: z.number(),
      end: z.number(),
      interproId: z.string().optional(),
      evidence: z.array(z.object({ code: z.string(), source: z.string().optional(), id: z.string().optional() })).optional(),
      change: z.object({ from: z.string(), to: z.array(z.string()) }).optional()
    })),
    geneName: z.string().optional(),
    subunitComment: z.string().nullable().optional(),
    isMultimer: z.boolean().optional(),
    sequenceLength: z.number().optional(),
    interactionPartners: z.array(z.object({
      accession: z.string(),
      gene: z.string().nullable(),
      experiments: z.number().nullable()
    })).optional(),
    reviewed: z.boolean().optional(),
    entryVersion: z.number().nullable().optional(),
    lastAnnotationUpdate: z.string().nullable().optional(),
    secondaryStructure: z.array(z.object({
      kind: z.enum(["helix", "strand", "turn"]),
      start: z.number(),
      end: z.number(),
      pdb: z.string().optional()
    })).optional(),
    domainMatches: z.array(z.object({
      database: z.string(),
      accession: z.string(),
      interpro: z.object({ id: z.string(), name: z.string() }).nullable(),
      locations: z.array(z.object({ start: z.number(), end: z.number() }))
    })).optional(),
    domainMatchesStatus: z.enum(["ok", "error", "unsupported"]).optional(),
    uniparcId: z.string().nullable().optional()
  }).nullable().optional(),
  gnomadConstraint: z.object({
    provenance: z.object({ release: z.string(), assembly: z.literal("GRCh38"), geneId: z.string(), transcriptId: z.string(), transcriptVersion: z.string(), selection: z.enum(["matched", "mane-select", "canonical", "sole-transcript"]), sourceUrl: z.string(), sourceSha256: z.string() }).optional(),
    qualityFlags: z.array(z.string()).optional(),
    rawMetrics: z.object({ missense_z: z.number().nullable(), oe_mis: z.number().nullable(), pli: z.number().nullable(), loeuf: z.number().nullable() }).optional(),
    expectedCounts: z.object({ syn: z.number().nullable(), mis: z.number().nullable(), lof: z.number().nullable() }).optional(),
    loeufPercentile: z.number().nullable().optional(),
    regionalRelease: z.string().optional(), regionalSourceUrl: z.string().optional(), regionalSourceSha256: z.string().optional(),
    regionalStatus: z.enum(REGIONAL_STATUSES).optional(),
    missense_z: z.number().nullable(),
    oe_mis: z.number().nullable(),
    pli: z.number().nullable(),
    loeuf: z.number().nullable().optional(),
    isPP2Constrained: z.boolean(),
    hasRegionalData: z.boolean().optional(),
    regionalConstraint: z.object({
      isConstrained: z.boolean(),
      oeRatio: z.number().nullable(),
      pValue: z.number().nullable(),
      regionText: z.string().nullable()
    }).nullable().optional()
  }).nullable().optional(),
  transcriptId: z.string().nullable().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().nullable().optional(),
  transcriptWarning: z.string().nullable().optional(),
  /**
   * Numbering basis of `metadata.variant`, carried into the analysis result so a report can
   * state which isoform's residue numbers a prediction refers to (and that a remap happened).
   */
  uniprotIsoform: z.string().nullable().optional(),
  numberingBasis: z.enum(["canonical", "remapped", "unverified"]).nullable().optional(),
  /**
   * False when the residue matched the canonical sequence but another isoform numbering could not be
   * ruled out (the isoform model was unreachable). Disclosed rather than silent, and cited by the
   * exported report — the prose twin of `numberingUnverifiedReason` lives in `transcriptWarning`.
   */
  numberingVerified: z.boolean().nullable().optional(),
  numberingUnverifiedReason: z.string().nullable().optional(),
  numberingRemap: numberingRemapSchema.nullable().optional(),
  /**
   * Genome-build trail for the analysed variant, carried into the result so no surface has to
   * guess or hardcode a build: `assembly` is what the caller's coordinate was expressed in,
   * `resolvedAssembly` is the build the annotation came from, and `coordinateLift` states whether
   * the two are the same variant (verified lift) or why no lift was possible.
   */
  assembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  resolvedAssembly: z.enum(["GRCh37", "GRCh38"]).nullable().optional(),
  /** Hyphen form of the locus in `resolvedAssembly`, when a lift was verified. */
  liftedGenomicCoordinates: z.string().nullable().optional(),
  coordinateLift: coordinateLiftSchema.nullable().optional(),
  gnomadFrequency: z.object({
    maxAF: z.number().nullable(),
    groupMaxAF: z.number().nullable().optional(),
    genomeAF: z.number().nullable(),
    exomeAF: z.number().nullable(),
    genomeAC: z.number().nullable().optional(),
    exomeAC: z.number().nullable().optional(),
    genomeAN: z.number().nullable().optional(),
    exomeAN: z.number().nullable().optional(),
    nHomozygous: z.number().nullable(),
    dataset: z.string()
  }).nullable().optional(),
  aouFrequency: z.object({
    aouAC: z.number().nullable().optional(),
    aouAN: z.number().nullable().optional(),
    aouHet: z.number().nullable().optional(),
    aouHom: z.number().nullable().optional()
  }).nullable().optional(),
  aouLookup: aouLookupSchema.nullable().optional(),
  esm2: z.object({
    llr: z.number().nullable(),
    verdict: z.string().nullable().optional()
  }).nullable().optional(),
  esm3Eval: z.union([
    z.object({
      uniprotId: z.string().optional(),
      position: z.number().optional(),
      wtResidue: z.string().optional(),
      mutResidue: z.string().optional(),
      pdbText: z.string().nullable().optional(),
      perturbationScores: z.array(z.number()).optional(),
      maxDriftResidue: z.number().optional(),
      structuralChangeLevel: z.enum(["none", "minor", "moderate", "major"]).optional(),
      microenvironments: z.array(z.string()).optional(),
      putativeStructuralChanges: z.array(z.string()).optional(),
      confidence: z.object({
        level: z.enum(["high", "moderate", "low"]),
        plddt: z.number().nullable().optional(),
        sequenceCoverage: z.number().nullable().optional()
      }).optional(),
      provenance: z.string().optional(),
      remoteEngineNote: z.string().nullable().optional(),
      status: z.string().optional()
    }).passthrough(),
    z.object({
      error: z.string(),
      status: z.string().optional(),
      remoteEngineNote: z.string().nullable().optional()
    }).passthrough()
  ]).nullable().optional(),
  esmcEval: esmcEvalResultSchema.nullable().optional(),
  esm2Eval: esmcEvalResultSchema.nullable().optional(),
  saprotEval: esmcEvalResultSchema.nullable().optional(),
  ...runtimeTimingFields,
  serviceStatus: z.record(z.string(), z.string()).optional()
}).passthrough();

export type AnalyzeVariantResponse = z.infer<typeof analyzeVariantResponseSchema>;

// ============================================================================
// 17. Shared Wire & Payload Models
// ============================================================================

export interface NearestResidue {
  name: string;
  distance: string;
  properties: string;
  role: string;
  classBadge: string;
  source?: "curated" | "computed";
}

export interface PdbHomolog {
  pdbId: string;
  /** Author chain for the matched RCSB polymer entity; absent if entity-to-chain mapping is unknown. */
  chainId?: string;
  /** RCSB search relevance score — not identity. */
  score: number;
  /** Sequence identity (%) from the alignment; null when RCSB returned no match context. */
  identity: number | null;
  /** Aligned length as % of the query; null when not reported. */
  coverage: number | null;
  title: string;
  organism: string;
  method: string;
  resolution: number | null;
  isHuman: boolean;
  unpStart?: number;
  structStart?: number;
  querySeqFrom?: number;
  querySeqTo?: number;
  coversPosition?: boolean;
}

/**
 * Where the coordinates in an analysis came from.
 *
 * Single source for the strings the producers (`core-data-fetcher`, `payload-assembler`, the
 * pipeline state factory) and the reader that names the structure in the UI
 * (`ResidueEnvironmentPanel`) each used to carry their own copy of. With a copy on both sides,
 * renaming one silently degraded the other to a generic sentence; both refer here now.
 *
 * The wire format stays a free-form string — a payload from an older or newer server must not
 * fail to parse — so readers narrow with `isPdbSource` and say nothing about a source they do
 * not recognise, rather than guessing.
 */
export const PDB_SOURCE_RCSB = "RCSB PDB";
export const PDB_SOURCE_ALPHAFOLD = "AlphaFold";
export const PDB_SOURCES = [PDB_SOURCE_RCSB, PDB_SOURCE_ALPHAFOLD] as const;
export type PdbSource = (typeof PDB_SOURCES)[number];

export function isPdbSource(value: unknown): value is PdbSource {
  return typeof value === "string" && (PDB_SOURCES as readonly string[]).includes(value);
}

export type AnalysisPipelineStage = "core" | "coordinates" | "landscape" | "structural" | "multimer" | "ppi" | "narrative" | "literature";
export type AnalysisStageOutcome = "running" | "complete" | "degraded" | "error" | "skipped";
export type AnalysisPipelineStages = Partial<Record<AnalysisPipelineStage, AnalysisStageOutcome>>;

export interface VariantMetadata {
  gene: string;
  variant: string;
  uniprotId: string;
  residueIndex: number | null;
  wildType: string;
  mutant: string;
  acmgWeighting?: string;
  pipelineRunId?: string;
  pipelineContext?: Record<string, unknown>;
  pipelineStages?: AnalysisPipelineStages;
  narrativeMode?: "automatic" | "on-demand" | "off";
  serviceTimings?: Record<string, number>;
  /** Settlement offsets, not start offsets. */
  serviceTimingOffsets?: Record<string, number>;
  structuralTimings?: Record<string, number>;
  structuralTimingOffsets?: Record<string, number>;
  cacheHit?: boolean;
  cacheLayer?: string | null;
  pdbId?: string | null;
  pdbSource?: string | null;
  /**
   * The canonical sequence the pipeline analysed.
   *
   * Declared here because this interface did not carry it while the client's re-synthesis
   * already sent it, which forced every caller that needed it to reach through `as any`. It is
   * populated by both payload builders and parsed by `biophysicalAnalysisResponseSchema` — the
   * schema the client actually parses the analysis with.
   */
  sequence?: string | null;
  alternativeVariants?: any;
  mutatedSequence?: string | null;
  analysisVersion?: {
    thresholds: string;
    geminiModel: string;
    foldxVersion: string;
    timestamp: string;
  } | null;
  serviceStatus?: Record<string, string>;
}

/**
 * One way a genuinely ambiguous protein notation can be read, as returned in the
 * `AMBIGUOUS_PROTEIN_NUMBERING` error's `details.candidates`.
 *
 * This is what turns a refusal into a decision: each candidate is already expressed in CANONICAL
 * numbering, which is the notation the whole pipeline downstream expects, so choosing one is just a
 * re-submit — no client-side translation and no second source of truth.
 */
export const numberingChoiceSchema = z.object({
  /** Canonical-numbered substitution to submit if the user means this reading. */
  variant: z.string(),
  /** Protein whose numbering this reading follows (`Q9Y305` canonical, `Q9Y305-4` an isoform). */
  basisId: z.string(),
  basisKind: z.enum(["canonical", "isoform"]),
  canonicalPosition: z.number(),
  /** Human label for a chooser, e.g. "Canonical numbering (Q9Y305)". */
  label: z.string().optional(),
});
export type NumberingChoice = z.infer<typeof numberingChoiceSchema>;

/**
 * The alternative-build spelling offered when a provider reports a reference-allele mismatch
 * (`COORDINATE_REFERENCE_MISMATCH`).
 *
 * WHY IT IS A NOTATION, NOT JUST A BUILD. `notation` is the SAME coordinate written with an explicit
 * `(GRCh37)`/`(GRCh38)` annotation — the server composes it, so the client never splices a build into
 * a coordinate grammar of its own. Submitting it is therefore a complete request that states its
 * build, which is the whole point: the refusal's usual cause is a coordinate read against the wrong
 * reference, and the remedy is to state the right one rather than to assume it.
 *
 * `assembly` is carried beside it so a caller can label the choice without parsing the notation.
 *
 * VALIDATED, NOT TRUSTED. The notation must actually STATE `assembly` — otherwise the button would
 * promise "this states the build" over a string that states nothing (or, worse, states the other
 * build), and clicking it would re-send a request the server has already refused. The length is capped
 * for the same reason every other server-supplied string is: a body is not allowed to make the UI
 * render an unbounded label.
 */
export const buildHintSchema = z
  .object({
    assembly: z.enum(["GRCh37", "GRCh38"]),
    /** The submitted coordinate, annotated with `assembly`, ready to submit. */
    notation: z.string().min(1).max(200),
    /**
     * The build the coordinate was actually READ against when the alleles failed to match.
     *
     * Carried so the refusal can say what happened ("no reference base matched on GRCh38") rather than
     * only what to try — the two halves are what make the prompt a statement instead of a guess.
     */
    triedAssembly: z.enum(["GRCh37", "GRCh38"]).optional(),
    /** Why this alternative is offered, in one line. */
    reason: z.string().optional(),
  })
  .refine((hint) => statedAssemblyOf(hint.notation)?.build === hint.assembly, {
    message: "buildHint.notation must state the build it offers",
    path: ["notation"],
  });
export type BuildHint = z.infer<typeof buildHintSchema>;

/**
 * Refusal codes that cross the client/server boundary, written ONCE.
 *
 * A code is a string on both sides of an HTTP response, and the client branches on it to decide
 * whether a refusal becomes a question the reader can answer. A typo on either side does not fail to
 * compile — it silently disables the prompt, and the reader is left with a message and nothing to
 * click. Both ends import these.
 */
export const REFUSAL_CODES = {
  /** The notation's residue numbers are equally consistent with two numberings. */
  ambiguousProteinNumbering: "AMBIGUOUS_PROTEIN_NUMBERING",
  /** The coordinate's REF allele matches no reference base on the build it was read against. */
  coordinateReferenceMismatch: "COORDINATE_REFERENCE_MISMATCH",
  /** The coordinate translated to a non-missense consequence (intronic, synonymous, nonsense, frameshift, etc.) */
  nonMissenseVariant: "NON_MISSENSE_VARIANT",
} as const;

export const nonMissenseRefusalSchema = z.object({
  gene: z.string().optional(),
  hgvsc: z.string().optional(),
  hgvsp: z.string().optional(),
  consequence: z.array(z.string()).optional(),
  isCoding: z.boolean().optional(),
  hasCodon: z.boolean().optional(),
  reason: z.string().optional(),
});

export type NonMissenseRefusal = z.infer<typeof nonMissenseRefusalSchema>;

export interface TranscriptMetadata {
  literatureAliases?: VerifiedLiteratureAlias[];
  transcriptId?: string | null;
  isManeSelect?: boolean;
  isManePlusClinical?: boolean;
  isCanonical?: boolean;
  maneRefSeqId?: string | null;
  transcriptWarning?: string | null;
  /**
   * Numbering provenance of the variant these predictions refer to.
   *
   * Declared on the INTERFACE, not only on the Zod schema: `pipelineStateFactory` spread these
   * fields into every analysis result, but a type that did not name them meant no consumer could
   * read them without a cast — which is how a structured remap record came to be "carried" into
   * reports that never actually cited it.
   */
  uniprotIsoform?: string | null;
  numberingBasis?: "canonical" | "remapped" | "unverified" | null;
  numberingVerified?: boolean | null;
  /** Machine-readable reason the numbering is unverified; the prose twin is `transcriptWarning`. */
  numberingUnverifiedReason?: string | null;
  /**
   * True when the reader answered the ambiguity prompt, so the numbering was CHOSEN rather than
   * derived. A report must be able to tell the two apart: the residue numbers rest on a human
   * decision, not on a provider's metadata.
   */
  numberingDisambiguated?: boolean | null;
  numberingRemap?: NumberingRemapRecord | null;
  /**
   * Genome-build trail of the analysed variant.
   *
   * Declared on the INTERFACE for the same reason as the numbering fields above: the payload
   * carries them (both builders spread them) and a type that does not name them forces every
   * consumer to widen with a cast — which is how a field that "travels with every payload" ends up
   * reaching nobody. `assembly` is the build the caller's coordinate was expressed in,
   * `resolvedAssembly` is the build the annotation came from (they differ exactly when a lift was
   * verified), and `coordinateLift` states the decision plus, when no lift was possible, why.
   */
  assembly?: GenomeAssembly | null;
  resolvedAssembly?: GenomeAssembly | null;
  /** Hyphen form of the verified canonical locus, present only when a lift was verified. */
  liftedGenomicCoordinates?: string | null;
  coordinateLift?: CoordinateLiftRecord | null;
  /**
   * Set when the provider named the resolved gene with a RETIRED symbol that UniProt lists as a
   * synonym of this entry, so `gene` is the current HGNC symbol instead.
   *
   * Declared here, beside the build trail, because it is the same kind of provenance: the substance
   * (`gene`) is already correct, but a report that must state WHICH symbol the provider used would
   * otherwise have to re-derive it — and the translate response is the only place that knows.
   */
  geneSymbolUpdated?: { from: string; to: string } | null;
}

/**
 * The genome-build trail as a nameable unit — ONE definition for the server payload, the client
 * pipeline and every surface that renders it.
 *
 * Extracted rather than re-declared per layer: a second interface with the same shape ("client
 * provenance") drifts the moment a field is added, and the drift is silent because every field is
 * optional — a surface then renders the build it was written against instead of the one the payload
 * states, which is exactly the hardcoded-`GRCh38` defect this trail exists to remove.
 */
export type AssemblyProvenance = Pick<
  TranscriptMetadata,
  "assembly" | "resolvedAssembly" | "liftedGenomicCoordinates" | "coordinateLift"
>;

export type AcmgVerdict = "Pathogenic" | "Likely Pathogenic" | "VUS" | "Likely Benign" | "Benign";

export interface ClinicalInsight {
  literature?: LiteratureSummaryReceipt;
  biochemicalShift: string;
  structuralImpact: string;
  acmgCriteria: ACMGCriteriaItem[];
  pathogenicity?: string;
  plausibility?: string;
  acmgVerdict?: AcmgVerdict;
  partialEvidence?: { available: string[]; unavailable: string[] };
  /**
   * The model that produced this narrative.
   *
   * Set by `performGeminiAnalysis` from the attempt that actually returned text, NOT from the head
   * of the configured ladder — the ladder is a fallback chain, so naming its first entry would
   * credit a model that may have 503'd. Absent on a rule-based fallback, where no model answered.
   * Surfaces that report inference provenance read this; "Not recorded" is the honest fallback.
   */
  model?: string;
  /**
   * Who authored the prose. Set by the route (`handleNarrativeResponse`), never by the model.
   *
   * `rule_based` marks a degraded run whose narrative was assembled from the rule engine and the
   * retrieved database evidence. Without this the payload could not distinguish the two, and a
   * fallback was labelled `ai_inference` alongside a model name it never reached.
   */
  source?: "ai_inference" | "rule_based";
}

export interface RuleBasedInsights {
  plausibility: string;
  acmgVerdict: AcmgVerdict;
  acmgCriteria: ACMGCriteriaItem[];
  partialEvidence?: { available: string[]; unavailable: string[] };
}

export interface LandscapeResidueItem {
  residx: number;
  aaref?: string | null;
  refMismatch?: boolean;
  revelMean?: number | null;
  revelMin?: number | null;
  revelMax?: number | null;
  revelCount?: number;
  amMean?: number | null;
  amMin?: number | null;
  amMax?: number | null;
  amCount?: number;
  gerp: number | null;
  phylop: number | null;
  nucleotideCount?: number;
  substitutions?: Array<{ alt: string; am: number | null; revel: number | null }>;
  residue?: string;
}

export interface StringInteractionItem {
  partner: string;
  score: number;
}

export interface Esm3EvalResult {
  uniprotId: string;
  position: number;
  wtResidue: string;
  mutResidue: string;
  pdbText: string | null;
  perturbationScores: number[];
  maxDriftResidue: number;
  structuralChangeLevel: "none" | "minor" | "moderate" | "major";
  microenvironments: string[];
  putativeStructuralChanges: string[];
  confidence: {
    level: "high" | "moderate" | "low";
    plddt?: number | null;
    sequenceCoverage?: number | null;
  };
  /** Present when the local fallback served this result; says why the remote ESM3 tier did not. */
  remoteEngineNote?: string | null;
}

export interface Esm2ScoreData {
  llr: number | null;
  verdict: string | null;
}

export interface BiophysicalModelingData {
  dynamut2?: number | null;
  dynamut2Status?: string | null;
  dynamut2JobId?: string | null;
  ddmut?: number | null;
  ddmutStatus?: string | null;
  ddmutJobId?: string | null;
  rasp?: number | null;
  thermompnn?: number | null;
  thermompnnStatus?: string | null;
  thermompnnJobId?: string | null;
  foldingEnergetics?: EnergeticsData | null;
  biophysicalEnergetics?: any;
}

export interface LanguageModelEvaluations {
  esm3Eval?: Esm3EvalResult | { error: string } | null;
  esmcEval?: EsmcEvalResult | null;
  esm2Eval?: EsmcEvalResult | null;
  saprotEval?: (EsmcEvalResult & { conformationState?: string | null; klDivergence?: number | null; hfError?: string | null }) | null;
  esm2?: Esm2ScoreData | null;
}

/** A UniProt feature that maps a contact with another protein ("Interaction with UBA3"). */
export interface PpiInteractionSite {
  /** UniProt feature type: "Region", "Site", "Binding site" or "Motif". */
  type: string;
  start: number;
  end: number;
  /** The feature note, verbatim. */
  description: string;
  /** Gene-like tokens after "Interaction with", when the note names any. */
  partners: string[];
  containsVariant: boolean;
}

/**
 * How IntAct records one binary interaction: the detection methods and the studies behind it.
 * UniProt's "experiments" count is assay runs, often several assay versions in ONE paper (HuRI ran
 * three yeast two-hybrid versions), so it is never shown as independent replication.
 */
export interface IntactEvidence {
  /** Detection method names as IntAct gives them ("validated two hybrid", "anti tag coimmunoprecipitation"). */
  methods: string[];
  /** Distinct PubMed ids. */
  pubmed: string[];
  /** Every method is a two-hybrid variant: a binary screen, no co-purification or structure. */
  twoHybridOnly: boolean;
  /** The partner's organism as IntAct names it ("mouse"), when it is not human. */
  organism?: string | null;
}

/** A binary interaction UniProt curates from IntAct. */
export interface PpiCuratedInteraction {
  accession: string;
  gene: string | null;
  experiments: number | null;
  /** From IntAct itself; null when IntAct was not read or lists nothing for the pair. */
  evidence?: IntactEvidence | null;
  /** UniProt's flag: the partner is from another species (mouse Hspa5 for human SOD1). */
  organismDiffer?: boolean;
}

/**
 * Interface residues seen in solved structures for one partner (PDBe-KB), with the support for each.
 *
 * `pdbEntries` are the structures that contain this pair; `support[i]` is in how many of them
 * `residues[i]` is at the interface. A residue at the interface in one of eight structures is a
 * conformation- or crystal-dependent contact, not the same evidence as one seen in all eight; the
 * screen states the fraction and never collapses it to "at the interface".
 */
export interface ObservedInterface {
  accession: string;
  name: string;
  /** Interface residues on THIS protein, UniProt numbering, sorted. */
  residues: number[];
  /** Entries in which each residue is at the interface; same order as `residues`. */
  support: number[];
  /** Structures that contain this pair (lower-case PDB ids). */
  pdbEntries: string[];
  homomeric: boolean;
  /**
   * Not a biological partner: a construct tag (MBP, T4 lysozyme), a tool antibody or nanobody, or a
   * chain with no UniProt record. Never counted.
   */
  artefact: string | null;
  /**
   * "fibril": the pair as seen only in amyloid fibril structures, where every chain stacks on the next;
   * "crystal": the pair as seen only in entries whose biological assembly is a monomer, so the contact
   * is crystal packing; "native": every other structure. Absent on payloads written before the split
   * (re-read, not shown).
   */
  context?: "native" | "fibril" | "crystal";
  /** The partner's UniProt gene name, when read. */
  gene?: string | null;
  /** The partner's organism when it is not human (UniProt common name); null for human. */
  organism?: string | null;
  variantAtInterface: boolean;
  /** Entries in which the variant residue itself is at this interface. */
  variantEntries: string[];
}

export type PpiLookupStatus = "ok" | "failed" | "skipped";

/**
 * Partners and mapped sites for one variant (`POST /api/v1/ppi/binding-affinity`).
 *
 * Every section carries its own lookup outcome: an empty list is an answer only when its lookup is
 * "ok". The binding energy change is NOT here: it needs a wild-type complex and is requested on its
 * own (`PpiBindingShift`).
 */
export interface PpiBindingData {
  status: "success" | "unavailable" | "failed";
  gene: string;
  variant: string;
  uniprotId?: string;
  /** Variant residue number, UniProt numbering; null when the variant could not be parsed. */
  position?: number | null;
  /** STRING's functional network: the query's strongest partners by combined score (legacy field). */
  stringPartners: Array<{ partner: string; score: number }>;
  /**
   * STRING partners at or above `minScore`: the physical sub-network (evidence that the proteins
   * bind) and the functional network (any association). `limit` is how many rows were asked for:
   * when a list is that long, a partner missing from it is "not among the top N", not "no association".
   */
  string?: {
    physical: Array<{ partner: string; score: number }> | null;
    functional: Array<{ partner: string; score: number }> | null;
    limit: number;
    minScore: number;
  };
  /** STRING release that answered, when STRING reported one. */
  stringVersion?: string | null;
  /** UniProt SUBUNIT text, verbatim. */
  subunitComment?: string | null;
  curatedInteractions?: PpiCuratedInteraction[];
  interactionSites?: PpiInteractionSite[];
  /** Written by the earlier service; solved interfaces are now read from `MultimerData.experimental`. */
  observedInterfaces?: unknown[];
  sequenceLength?: number | null;
  /**
   * Outcome of each independent upstream lookup, so a consumer can tell an empty answer from no
   * answer at all. Absent (a payload cached before the field existed) means unknown.
   */
  lookups?: {
    stringPartners?: "ok" | "failed";
    stringPhysical?: "ok" | "failed";
    intact?: PpiLookupStatus;
    uniprot?: PpiLookupStatus;
    pdbe?: "ok" | "none" | "failed" | "skipped";
    /** Payloads written before the UniProt sites rewrite. */
    interfaceResidues?: PpiLookupStatus;
  };
  /** Written by the earlier service, which read no Region/Site features: never rendered as an answer. */
  interfaceResidues?: Array<{ pos: number; description: string; isVariantPosition: boolean }>;
  /** Written by the earlier service, which scored the variant model as the wild type: never rendered. */
  bindingShift?: unknown;
  error?: string;
}

/**
 * Predicted change in binding energy (`POST /api/v1/ppi/binding-shift`).
 *
 * DDMut-PPI scores a substitution against a WILD-TYPE complex, and was trained on experimental
 * wild types. The wild type is therefore a SOLVED complex in which the variant residue is at the
 * interface, best resolution first; only when none exists are the chains modelled, all wild type,
 * with Boltz-2. The variant complex is never used: it already carries the substitution.
 *
 * Sign: DDMut-PPI's own convention (Zhou et al., NAR 2024): ΔΔG ≤ 0 is reduced binding affinity.
 */
export interface PpiBindingShift {
  status: "ok" | "running" | "failed" | "not-applicable";
  gene: string;
  variant: string;
  ddgBind: number | null;
  unit: "kcal/mol";
  signConvention: "negative-weakens";
  predictor: string;
  /** The wild-type complex the value was computed on. */
  wildType: {
    source: "experimental" | "boltz-2-model";
    provenance: string;
    /** Model only. */
    ipTm: number | null;
    chains: Array<{ id: string; accession: string; gene: string | null }>;
    /** Experimental only: the entry, its method and resolution, and the variant's residue there. */
    pdbId?: string | null;
    method?: string | null;
    resolution?: number | null;
    /** Chain carrying the variant, author naming. */
    chain?: string | null;
    /** The variant residue's author number in that entry (may differ from UniProt numbering). */
    authorResidue?: number | null;
  } | null;
  mutation: string | null;
  reason?: string;
}

/**
 * Quaternary assembly for one variant (`POST /api/v1/structure/multimer`).
 *
 * `status` separates the four answers a curator must not confuse: a model was built ("success"),
 * the curated record states a monomer ("monomeric"), this app does not model what the record states
 * ("not-modelled", with `notModelledReason`), and the provider failed ("failed", with `error`).
 * "No SUBUNIT record" is "not-modelled"/"unstated" — never "monomeric".
 */
export type MultimerStatus = "success" | "monomeric" | "not-modelled" | "failed" | "not-requested" | "running";

/**
 * Why a complex prediction returned no model. Kept apart because they mean different things to a
 * reader: a timeout or a network fault is worth trying again; a rejection is a property of the input.
 */
export interface MultimerModelFailure {
  kind: "timeout" | "http" | "rejected" | "network" | "no-model" | "job-failed";
  httpStatus?: number | null;
  detail?: string | null;
}

export type MultimerNotModelledReason =
  | "unstated"
  | "interactions-only"
  | "complex"
  | "heteromer-partner"
  | "heteromer-stoichiometry"
  | "too-many-chains"
  | "reference-mismatch"
  | "no-sequence";

export interface MultimerAssemblyPartner {
  gene: string;
  accession: string | null;
  /** Where the accession came from: UniProt's curated INTERACTION list, or a reviewed human gene search. */
  resolvedBy: "interaction" | "swissprot" | null;
}

export interface MultimerAssemblyRecord {
  kind: "monomer" | "homomer" | "heteromer" | "complex" | "interactions-only" | "unstated";
  label: string;
  copies: number | null;
  homoAssumed: boolean;
  sentence: string | null;
  alsoStated: string[];
  partners: MultimerAssemblyPartner[];
  /** UniProt's evidence qualifier on the deciding sentence ("Probable", "By similarity"), verbatim. */
  qualifier?: string | null;
  /** Every assembly statement in the record, in order, each with its own qualifier. */
  statements?: SubunitStatementRecord[];
}

export interface SubunitStatementRecord {
  kind: "monomer" | "homomer" | "heteromer" | "complex";
  label: string;
  qualifier: string | null;
  sentence: string;
  partnerGenes: string[];
  /** A partner named as a family, not a gene ("other K-Cl cotransporters"); never resolved by guessing. */
  family: string | null;
}

export interface MultimerChain {
  id: string;
  accession: string;
  gene: string | null;
  length: number;
  carriesVariant: boolean;
}

export type MultimerExperimentalPartner = ObservedInterface;

export interface MultimerExperimentalInterfaces {
  status: "ok" | "none" | "error";
  reason?: string;
  partners: MultimerExperimentalPartner[];
  /** "failed": RCSB was not read, so amyloid fibril entries could not be told apart from native ones. */
  entryKinds?: "ok" | "failed";
  /** True when the biological-assembly check answered, so crystal-packing entries were told apart. */
  crystalChecked?: boolean;
}

export interface MultimerData {
  status: MultimerStatus;
  gene: string;
  uniprotId: string;
  /** Display word for the stated assembly ("Homodimer", "Heterodimer", "Monomer", "Not stated"). */
  oligomericState: string;
  /** Chains actually submitted to the model (1 when nothing was modelled). */
  chainCount: number;
  chainIds: string[];
  complexPdb: string | null;
  ipTm: number | null;
  pTm: number | null;
  /** As the provider returned them: `resA` on chain A (the variant's chain), `resB` on a partner. */
  interfaceContacts: Array<{ resA: number; resB: number; distance: number }>;
  provenance: string;
  subunitComment?: string | null;
  error?: string;
  assembly?: MultimerAssemblyRecord;
  chains?: MultimerChain[];
  notModelledReason?: MultimerNotModelledReason;
  /** The variant's residue number on chain A; null when it could not be parsed. */
  variantPosition?: number | null;
  /** True when the variant residue itself makes a contact in the model; null with no model. */
  variantAtInterface?: boolean | null;
  experimental?: MultimerExperimentalInterfaces;
  /** Why the model is missing, when it was requested and did not come back. */
  failure?: MultimerModelFailure | null;
  /** Provider job still running (status "running"): ask again and the server resumes it. */
  jobId?: string | null;
}

export type UniprotFeatureType = 
  | "DOMAIN" | "REGION" | "ACTIVE_SITE" | "BINDING" | "MUTAGEN" | "DISULFID" | "METAL" | "SITE" 
  | (string & {});

/**
 * One evidence tag UniProt attaches to a feature: an ECO code, and where the claim comes from
 * (`PubMed` + id, `UniProtKB` + the accession it was transferred from, `PDB` + entry…). Kept because
 * the level of a site's evidence decides whether it may raise PM1: an "active site by similarity" is
 * a transfer from another protein, not an observation in this one.
 */
export interface UniprotFeatureEvidence {
  code: string;
  source?: string;
  id?: string;
}

export interface UniprotFeatureItem {
  type: UniprotFeatureType;
  description: string;
  start: number;
  end: number;
  interproId?: string;
  /** UniProt's evidence tags; absent on payloads cached before they were read, empty when none is cited. */
  evidence?: UniprotFeatureEvidence[];
  /** Natural variant / mutagenesis residue change (`L` -> `F`). */
  change?: { from: string; to: string[] };
}

/** A secondary-structure element UniProt derives from a PDB entry (Helix / Beta strand / Turn). */
export interface SecondaryStructureElement {
  kind: "helix" | "strand" | "turn";
  start: number;
  end: number;
  pdb?: string;
}

/**
 * A member-database signature match (Pfam, Gene3D, CDD, PANTHER…) on this entry's sequence, with its
 * InterPro entry when it has one. Read from UniParc's sequence features, which carry real residue
 * ranges — UniProtKB's own InterPro cross-references carry only names.
 */
export interface DomainMatch {
  database: string;
  accession: string;
  interpro: { id: string; name: string } | null;
  /**
   * InterPro entry type (`domain`, `family`, `homologous_superfamily`, `conserved_site`, `binding_site`,
   * `active_site`, `ptm`, `repeat`). Unset when InterPro did not answer or the match has no entry.
   * It, not the database name, decides whether a match is drawn as a domain or as a site motif.
   */
  entryType?: string;
  locations: Array<{ start: number; end: number }>;
}

export interface UniprotFeaturesData {
  features: UniprotFeatureItem[];
  /**
   * UniProt's single mature `Chain` (initiator Met removed, signal peptide cleaved), when the entry has exactly one.
   * Residues are numbered on the canonical sequence everywhere; this is only what turns residue 5 into the
   * processed protein's residue 4 for a reader who knows the variant from older literature (SOD1 "A4V").
   * Absent on payloads cached before it was read.
   */
  processedChain?: { start: number; end: number } | null;
  geneName?: string;
  subunitComment?: string | null;
  isMultimer?: boolean;
  sequenceLength?: number;
  interactionPartners?: Array<{ accession: string; gene: string | null; experiments: number | null }>;
  /** Swiss-Prot (reviewed) or TrEMBL; absent on payloads cached before it was read. */
  reviewed?: boolean;
  entryVersion?: number | null;
  lastAnnotationUpdate?: string | null;
  secondaryStructure?: SecondaryStructureElement[];
  /** InterPro member-database matches from UniParc; `domainMatchesStatus` says whether they were read. */
  domainMatches?: DomainMatch[];
  domainMatchesStatus?: "ok" | "error" | "unsupported";
  /** `error`: InterPro entry types were not read, so matches are routed by database convention. */
  entryTypesStatus?: "ok" | "error";
  uniparcId?: string | null;
}

export interface DisruptionPredictorResult {
  level: "high" | "low" | "unknown";
  reason: string;
  /** AlphaFold pLDDT at the site; null when the structure was experimental (see `bFactorKind`). */
  plddt: number | null;
  /** The site Cα's raw B column, and what it holds: pLDDT or a crystallographic temperature factor. */
  bFactor?: number | null;
  bFactorKind?: "plddt" | "temperature-factor" | "unknown";
  burialStatus?: "core" | "surface" | "boundary";
  neighborCount?: number;
  rsa?: number | null;
  sasa?: number | null;
  /** Why accessibility was not measured, when the SASA step failed. */
  sasaUnavailableReason?: string;
}

export interface GnomadConstraintData {
  provenance?: ConstraintProvenance;
  qualityFlags?: string[];
  /** Retained for traceability when QC withholds the usable values; never used by the engine. */
  rawMetrics?: { missense_z: number | null; oe_mis: number | null; pli: number | null; loeuf: number | null };
  expectedCounts?: { syn: number | null; mis: number | null; lof: number | null };
  loeufPercentile?: number | null;
  regionalRelease?: string;
  regionalSourceUrl?: string;
  regionalSourceSha256?: string;
  regionalStatus?: RegionalConstraintStatus;
  missense_z: number | null;
  oe_mis: number | null;
  pli: number | null;
  loeuf?: number | null;
  isPP2Constrained: boolean;
  hasRegionalData?: boolean;
  regionalConstraint?: {
    isConstrained: boolean;
    oeRatio: number | null;
    pValue: number | null;
    regionText: string | null;
  } | null;
}

export interface GnomadFrequencyData {
  maxAF: number | null;
  groupMaxAF: number | null;
  genomeAF: number | null;
  exomeAF: number | null;
  genomeAC: number | null;
  exomeAC: number | null;
  genomeAN: number | null;
  exomeAN: number | null;
  nHomozygous: number | null;
  dataset: string;
  groupMaxAFIsFallback?: boolean;
}

export interface AouFrequencyData {
  aouAC: number | null;
  aouAN: number | null;
  aouHet: number | null;
  aouHom: number | null;
}

export interface AnalysisResult extends BiophysicalModelingData, TranscriptMetadata, LanguageModelEvaluations {
  /**
   * Present when the run was REFUSED because the notation's numbering is genuinely ambiguous.
   *
   * Each entry is already canonical-numbered, so the UI can offer the readings and re-submit the
   * chosen one — a decision instead of a dead end. Carried on the result (not only in the error
   * string) because the choice has to survive to the component that renders it.
   */
  numberingChoices?: NumberingChoice[] | null;
  /** The ambiguous notation as written, echoed so the prompt can quote it. */
  numberingNotation?: string | null;
  /**
   * Present when the run was REFUSED because the coordinate's REF allele matches no reference base
   * on the build it was read against (`COORDINATE_REFERENCE_MISMATCH`).
   *
   * Carries the same coordinate annotated with the OTHER build, ready to submit, so the refusal is a
   * one-click next step instead of a dead end — the usual cause is a genome-build mismatch, and the
   * remedy is to state the build rather than to retype the coordinate.
   */
  buildHint?: BuildHint | null;
  /** Present when the run was REFUSED because the coordinate translated to a non-missense consequence */
  nonMissenseRefusal?: NonMissenseRefusal | null;
  analysis?: string | null;
  isFallback?: boolean;
  /** Stable degradation code — see src/shared/narrativeFallback.ts. */
  fallbackReason?: string;
  /** Safe one-line explanation of the degradation, suitable for clinical UI. */
  fallbackMessage?: string;
  /** Whether re-running the same request may succeed. */
  fallbackRetryable?: boolean;
  /** Sanitized provider diagnostics — surfaced in the Developer Console only. */
  providerDetail?: string;
  /** Models the request attempted, in order. */
  attemptedModels?: string[];
  insights?: ClinicalInsight | null;
  ruleBasedInsights?: RuleBasedInsights | null;
  clinvar?: ClinVarData | null;
  predictorData?: PredictorData | null;
  conservationData?: ConservationData | null;
  landscapeData?: LandscapeResidueItem[] | null;
  landscapeMeta?: LandscapeMeta | null;
  stringInteractions?: StringInteractionItem[] | null;
  multimerData?: MultimerData | null;
  ppiBindingData?: PpiBindingData | null;
  ppiBindingShift?: PpiBindingShift | null;
  isDemoData?: boolean;
  metadata?: VariantMetadata;
  disruptionPredictor?: DisruptionPredictorResult;
  uniprotFeatures?: UniprotFeaturesData | null;
  gnomadConstraint?: GnomadConstraintData | null;
  gnomadFrequency?: GnomadFrequencyData | null;
  aouFrequency?: AouFrequencyData | null;
  aouLookup?: AouLookup | null;
  serviceStatus?: Record<string, string>;
  inSilicoConcordance?: PredictorConcordance | null;
}
