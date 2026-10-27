import { CONSTRAINT_RELEASE } from "../../../src/shared/constraintSource.ts";
import type { CuratedInheritance } from "../../../src/shared/inheritanceBasis.ts";
import { generateAltVariants } from "../../routes/shared.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import type { PdbBestStructureMapping, ClinVarData, StringInteraction, GnomadVariantFrequency, GnomadGeneConstraint, UniprotFeaturesResult } from "../external.ts";
import type { PredictorData, ConservationData, PdbSource, AouLookup } from "../../../src/shared/contracts.ts";
import type { DisruptionPrediction } from "../stability/biophysics.ts";
import type { RuleBasedInsights } from "../prediction/acmg.ts";
import { payloadIdentityRecordOf } from "./core-identity.ts";
import { LOCUS_POLICY_VERSION } from "../../../src/shared/locusResolution.ts";
import { currentCacheScope } from "../infra/cache-scope.ts";

/**
 * The outcome of one external fetch.
 *
 * `unsupported-build` is distinct from `not_found` on purpose, and the distinction is clinical.
 * gnomAD r4 answers by numeric position and serves GRCh38 only, so the gate in
 * `core-data-fetcher.ts` refuses any other coordinate *before* querying. Recording that refusal as
 * `not_found` — which is what happened until this member existed — made "this source holds no record
 * of the variant" and "this source was never asked" the same value, and the ACMG classifier read the
 * second as the first: a confirmed absence, a zero frequency, and **PM2 awarded for a variant no
 * database had been queried about**.
 */
/**
 * `stand-in` is gnomADFrequency-only: the run returned a frequency from the local dbNSFP ingest
 * because the remote record did not answer (the 8 s grace elapsed, or the query faulted — the cause
 * is on the record itself as `GnomadFrequencyData.standIn`). It is NOT a fault: the classifier still
 * reads the data, exactly as `ok`, and the record is disclosed as the combined local ingest.
 */
export type ServiceFetchStatus = "ok" | "not_found" | "timeout" | "error" | "unsupported-build" | "stand-in";

export interface ServiceStatusMap {
  clinvar: ServiceFetchStatus;
  predictorData: ServiceFetchStatus;
  conservationData: ServiceFetchStatus;
  stringInteractions: ServiceFetchStatus;
  disruptionPredictor: ServiceFetchStatus;
  esm2: ServiceFetchStatus;
  gnomadConstraint: ServiceFetchStatus;
  gnomadFrequency: ServiceFetchStatus;
  uniprotFeatures: ServiceFetchStatus;
  pdbMapping: ServiceFetchStatus;
}

export interface CoreAnalysisData {
  clinvar: ClinVarData | null;
  conservationData: ConservationData | null;
  stringInteractions: StringInteraction[];
  disruptionPredictor: DisruptionPrediction | null;
  esm2: { llr: number | null; verdict: string } | null;
  predictorData: PredictorData | null;
  pdbMapping: PdbBestStructureMapping | null;
  gnomadConstraint: GnomadGeneConstraint | null;
  uniprotFeatures: UniprotFeaturesResult | null;
  gnomadFrequency: GnomadVariantFrequency | null;
  aouFrequency: ConservationData["aouFrequency"] | null;
  /** What the All of Us lookup consulted, so an empty row can name its absence. Optional: older records lack it. */
  aouLookup?: AouLookup | null;
  /** Curated GenCC inheritance for the frequency rules. Optional: older records lack it. */
  curatedInheritance?: CuratedInheritance | null;
  resolvedPdbId: string | null;
  resolvedPdbSource: PdbSource;
  ruleBasedInsights: RuleBasedInsights | null;
  serviceStatus: ServiceStatusMap;
  serviceTimings?: Record<string, number>;
  /**
   * When each source settled, on the fetch's own clock. Real for prefetched sources too, which
   * `serviceTimings` cannot be (it can only report the part of their latency observed here).
   */
  serviceTimingOffsets?: Record<string, number>;
}

/**
 * Computes mutated amino acid sequence if valid residue context is present.
 */
export function buildMutatedSequence(
  sequence?: string | null,
  pos?: number | null,
  wt1Letter?: string | null,
  mut1Letter?: string | null
): string | null {
  if (sequence && pos && pos >= 1 && pos <= sequence.length && wt1Letter && mut1Letter) {
    return sequence.substring(0, pos - 1) + mut1Letter + sequence.substring(pos);
  }
  return null;
}

/**
 * The cache layer a restored response came from. Named rather than left as a boolean, because a
 * response can later be restored from more than one place (the analysis row, an external-source
 * cache, a worker-side memo) and "cached" without a layer cannot say which.
 */
export const ANALYSIS_DB_CACHE_LAYER = "analysis-db";

/**
 * Marks a payload with WHERE its evidence came from — measured here, not inferred by a client.
 *
 * WHY THIS IS SERVER-SIDE. The client used to decide "this was cached" from how fast the request
 * answered (<40 ms), which is a guess about latency rather than a fact about provenance: a genuinely
 * fast fresh run (every provider answering out of its own cache) read as a restore, and a slow
 * restore read as fresh. The route that restored the row knows the answer for certain, so it says so.
 *
 * `cacheHit` is exactly "this response's core evidence was restored from the analysis DB instead of
 * fetched now" — false for anything a live core run produced, including a run shared with another
 * route. `cacheLayer` names the layer on a hit and is `null` otherwise (absent would be ambiguous
 * with "an older server that did not stamp").
 *
 * Returns a COPY: the stamp is wire provenance about one RESPONSE, and the payload it came from may
 * still be written back to the row (`healCachedAnalysisIfPossible` does exactly that), where
 * `cacheHit: true` would be a claim about the row rather than about the response.
 */
export function withCacheProvenance<T extends Record<string, any>>(payload: T, cacheHit: boolean): T {
  if (!payload || typeof payload !== "object") return payload;
  const cacheLayer = cacheHit ? ANALYSIS_DB_CACHE_LAYER : null;
  return {
    ...payload,
    metadata: { ...((payload.metadata as Record<string, unknown>) || {}), cacheHit, cacheLayer },
    cacheHit,
    cacheLayer
  };
}

/**
 * Assembles the standardized 22-field analysis response payload from core variant analysis data.
 */
export function assembleCoreResponsePayload(
  coreData: CoreAnalysisData,
  context: ParsedVariantContext
): any {
  const {
    gene,
    variant,
    uniprotId,
    residueIndex,
    wildType,
    mutant,
    sequence,
    pos,
    wt1Letter,
    mut1Letter
  } = context;

  const mutatedSequence = buildMutatedSequence(sequence, pos, wt1Letter, mut1Letter);

  return {
    analysis: null,
    insights: null,
    ruleBasedInsights: coreData.ruleBasedInsights,
    disclaimer: "This analysis is automatically generated by an artificial intelligence model for research purposes only. It does not constitute a clinical diagnosis or validated medical recommendation.",
    clinvar: coreData.clinvar,
    predictorData: coreData.predictorData,
    conservationData: coreData.conservationData,
    transcriptId: coreData.predictorData?.transcriptId ?? null,
    isManeSelect: coreData.predictorData?.isManeSelect ?? false,
    isManePlusClinical: coreData.predictorData?.isManePlusClinical ?? false,
    isCanonical: coreData.predictorData?.isCanonical ?? false,
    maneRefSeqId: coreData.predictorData?.maneRefSeqId ?? null,
    transcriptWarning: coreData.predictorData?.transcriptWarning ?? null,
    /**
     * Numbering provenance travels with EVERY payload, not only the non-streaming route.
     *
     * The UI's analysis runs through the STREAM endpoint, so leaving these out of the assembled chunk
     * meant an unverifiable numbering was disclosed on the route the client does not use and silent on
     * the one it does — the disclosure existed and reached nobody.
     */
    ...(context.numberingVerified === undefined
      ? {}
      : {
          numberingVerified: context.numberingVerified,
          ...(context.numberingWarning
            ? { numberingUnverifiedReason: context.numberingWarning }
            : {}),
          ...(context.numberingDisambiguated ? { numberingDisambiguated: true } : {}),
        }),
    landscapeData: null,
    /**
     * Genome-build trail, carried like the numbering provenance above and for the same reason: it
     * only ever reached the UI on the route the client does not use. Without it a surface has to
     * infer a build — which is how a panel came to certify GRCh38 beside an HG19 header chip.
     * `assembly` is the build the caller's coordinate is expressed in; `resolvedAssembly` is the
     * build the annotation came from; they differ exactly when a lift was verified.
     */
    ...(context.assembly ? { assembly: context.assembly } : {}),
    ...(context.resolvedAssembly ? { resolvedAssembly: context.resolvedAssembly } : {}),
    ...(context.liftedGenomicCoordinates
      ? { liftedGenomicCoordinates: context.liftedGenomicCoordinates }
      : {}),
    ...(context.coordinateLift ? { coordinateLift: context.coordinateLift } : {}),
    stringInteractions: coreData.stringInteractions,
    disruptionPredictor: coreData.disruptionPredictor,
    gnomadConstraint: coreData.gnomadConstraint ?? null,
    uniprotFeatures: coreData.uniprotFeatures ?? null,
    gnomadFrequency: coreData.gnomadFrequency ?? null,
    aouFrequency: coreData.aouFrequency ?? null,
    aouLookup: coreData.aouLookup ?? null,
    curatedInheritance: coreData.curatedInheritance ?? null,
    esm2: coreData.esm2 ?? null,
    esm3Eval: null,
    esmcEval: null,
    esm2Eval: null,
    saprotEval: null,
    metadata: {
      gene,
      variant,
      uniprotId,
      residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
      wildType,
      mutant,
      pdbId: coreData.resolvedPdbId,
      pdbSource: coreData.resolvedPdbSource,
      /*
       * The wild-type sequence the pipeline analysed.
       *
       * The client's narrative re-synthesis sends this to the narrative route, which feeds it
       * to `computeRuleBasedACMG` — PVS1's C-terminal demotion and the PM4/BP3 repeat test both
       * key on it — and hashes it into the evidence cache key. No builder populated it, so the
       * report's own criteria were computed without a sequence while the pipeline's were
       * computed with one, and the two could disagree in front of a reader. `mutatedSequence`
       * is not a substitute: it differs at exactly the residue the narrative explains.
       */
      sequence: sequence ?? null,
      alternativeVariants: generateAltVariants(sequence),
      mutatedSequence,
      serviceStatus: coreData.serviceStatus,
      serviceTimings: coreData.serviceTimings,
      serviceTimingOffsets: coreData.serviceTimingOffsets,
      populationPolicyVersion: LOCUS_POLICY_VERSION
    },
    serviceStatus: coreData.serviceStatus,
    serviceTimings: coreData.serviceTimings,
    serviceTimingOffsets: coreData.serviceTimingOffsets,
    _internal: {
      pdbMapping: coreData.pdbMapping,
      /**
       * WHICH request produced this payload, recorded inside the payload rather than in a column.
       *
       * Rows live for 30 days, and a row written under one build, weighting, capability set or model
       * choice can be read back under another. `core-identity.ts` explains the guard; the reason it
       * lives HERE is that adding a `context_hash` column to a live table is a migration this change
       * deliberately does not make. The block is already the place for server-only routing metadata
       * (`pdbMapping`), and both wire routes already strip it — the stream through
       * `stripInternalFields`, `/analyze-variant` by destructuring it away.
       *
       * DIGESTS ONLY. No credential, no endpoint URL and no key-derived material: see the module
       * note in `core-identity.ts` for why a payload may state "this run had no BioHub token" but
       * must never carry anything a reader could test a token guess against.
       */
      coreIdentity: payloadIdentityRecordOf(context)
    }
  };
}

/** Shape of the persisted model-provenance block. Bumped when a declared field is renamed or re-scoped. */
export const MODEL_PROVENANCE_SCHEMA_VERSION = 2;

/**
 * The model provenance recorded beside a payload — DERIVED from the payload, never hard-coded.
 *
 * WHAT WAS WRONG
 * --------------
 * This was the literal `{ esm2: "esm2_t12_35M", version: "1.0.0" }` for every row, whatever had
 * actually produced the numbers. The core `esm2` field is not a 35M ESM-2 at all: it is the
 * VESM-150M triage evaluation (`runEsm2Eval` → sidecar `/predict/vesm`, with the local
 * `tools/esm2_eval.py` VESM_150M weights as the fallback), and the structural ESM-2 field is
 * `facebook/esm2_t33_650M_UR50D`. So every persisted row carried a provenance claim about a model
 * that had not run — a provenance record that is wrong is worse than an absent one, because it is
 * cited.
 *
 * HOW IT IS DERIVED NOW
 * ---------------------
 * Two rules, both refusing to invent anything:
 *
 *   • a model is declared only when the payload actually carries its output. An absent entry means
 *     "no numbers from this source", which is the honest reading of a null field — declaring a model
 *     that returned nothing would re-create the original defect in a subtler form;
 *   • where the producer already states its own provenance (`EsmcEvalResult.provenance`,
 *     `ESM3StructureEvalResult.provenance` — set from the sidecar's or JapanFold's own response), that
 *     string is recorded verbatim rather than replaced by a guess about which tier answered.
 *
 * The one fallback that is a DECLARATION rather than a measurement is the core VESM-150M entry: the
 * core result carries no provenance field, so the entry names the weights the transport implies
 * (`ntranoslab/vesm` on `facebook/esm2_t30_150M_UR50D`).
 */
export function declaredModelProvenanceOf(
  payload: any,
  context: ParsedVariantContext
): Record<string, unknown> {
  const models: Record<string, string> = {};

  const declare = (key: string, producerProvenance: unknown, fallback: string): void => {
    const stated = typeof producerProvenance === "string" ? producerProvenance.trim() : "";
    models[key] = stated.length > 0 ? stated : fallback;
  };

  if (payload?.esm2) {
    models["core.esm2"] = "VESM-150M (ntranoslab/vesm fine-tune of facebook/esm2_t30_150M_UR50D)";
  }
  if (payload?.esm3Eval) {
    declare("structural.esm3Eval", payload.esm3Eval?.provenance, "ESM3 (EvolutionaryScale / BioHub)");
  }
  if (payload?.esmcEval) {
    declare("structural.esmcEval", payload.esmcEval?.provenance, "ESMC-6B (JapanFold) or VESM-150M (local sidecar)");
  }
  if (payload?.esm2Eval) {
    declare("structural.esm2Eval", payload.esm2Eval?.provenance, "facebook/esm2_t33_650M_UR50D");
  }
  if (payload?.saprotEval) {
    declare(
      "structural.saprotEval",
      payload.saprotEval?.provenance,
      context.saprotEngine === "saprot-35m"
        ? "westlake-repl/SaProt_35M_AF2"
        : "westlake-repl/SaProt_650M_AF2"
    );
  }

  return { schemaVersion: MODEL_PROVENANCE_SCHEMA_VERSION, constraintRelease: CONSTRAINT_RELEASE, models };
}

/**
 * Persists an analysis payload to SQLite database with standard model version tagging.
 *
 * RETURNS a promise, and it is the CALLER's decision what to do with it.
 *
 * The dispatch is asynchronous (a worker pool), so there was never a synchronous write to depend on;
 * what the old `void` signature hid was that the caller could not express the difference between
 * "this write must have landed before I answer" and "this write must never delay my answer". A
 * reader's readiness must not wait on a database round trip — the payload is already assembled and
 * the sources are down — so every caller in `analysis-orchestrator.ts` deliberately does NOT await
 * it, while a caller that needs the write ordered (a test, a backfill job) can.
 *
 * The returned promise NEVER REJECTS: a persistence failure is logged here and swallowed, because
 * the alternative — a rejection nothing awaited — is an unhandled rejection in a request that has
 * already answered the user. That is why the internal `catch` is retained rather than pushed out to
 * every call site.
 */
export function persistVariantAnalysisPayload(
  context: ParsedVariantContext,
  payload: any,
  acmgVerdict?: string | null
): Promise<void> {
  /**
   * Built (in part) from saved data served past its expiry because a provider was limiting requests
   * (WP-I2): correct to show, with the response saying so, but not to store as this variant's answer.
   * The stored row would come back later with no sign that it is out of date.
   */
  if ((currentCacheScope()?.stale.length ?? 0) > 0) {
    console.warn(`[Analysis DB] Not saving ${context.gene} ${context.variant}: it used saved data a provider could not refresh.`);
    return Promise.resolve();
  }
  const db = AnalysisDatabase.getInstance();
  return db.saveVariantAnalysisAsync({
    gene: context.gene,
    variant: context.variant,
    uniprotId: context.uniprotId,
    pos: context.pos,
    wildType: context.wildType,
    mutant: context.mutant,
    acmgWeighting: context.acmgWeighting,
    acmgVerdict: acmgVerdict ?? payload?.ruleBasedInsights?.acmgVerdict ?? null,
    payload,
    /**
     * The provenance of the models that ACTUALLY produced this payload's numbers — see
     * `declaredModelProvenanceOf`. Never a fixed string: the previous literal named a model
     * (`esm2_t12_35M`) that no field in this pipeline is produced by.
     */
    modelVersions: declaredModelProvenanceOf(payload, context)
  }).then(
    () => undefined,
    (err: any) => {
      console.warn("[Analysis DB Warning] Failed to persist analysis payload:", err?.message ?? err);
    }
  );
}

export const buildAnalysisPayload = assembleCoreResponsePayload;
export const persistAnalysis = persistVariantAnalysisPayload;
