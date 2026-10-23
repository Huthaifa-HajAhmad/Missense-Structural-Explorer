import { fetchClinVarData, type ClinVarData } from "../external-api/clinvar.ts";
import { fetchPredictorData } from "../prediction/index.ts";
import { computeRuleBasedACMG } from "../prediction/acmg.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import {
  type ServiceFetchStatus,
  type ServiceStatusMap,
  type CoreAnalysisData,
  assembleCoreResponsePayload,
  persistVariantAnalysisPayload,
  buildAnalysisPayload,
  persistAnalysis,
  buildMutatedSequence,
  withCacheProvenance
} from "./payload-assembler.ts";
import { healCachedAnalysisIfPossible } from "./self-healer.ts";
import {
  fetchCoreVariantData,
  type CoreAnalysisPartial,
  type CoreFastTriage,
  type CorePrefetchOptions
} from "../external-api/core-data-fetcher.ts";
import { findRunningCoreFetch, runSharedCoreFetch } from "./core-singleflight.ts";
import { checkPayloadCompatibility, structuralIdentityRecordOf, type IdentityScope } from "./core-identity.ts";
import { fetchStructuralModelData, type StructuralAnalysisData } from "../structure/structural-model-fetcher.ts";
import { predictorCoordinateFromContext, isBuildDegradedResult, type PredictorData } from "../../../src/shared/contracts.ts";
import { STREAM_HEARTBEAT_MS } from "../../../src/shared/timeouts.ts";
import { isIntrinsicallyAmbiguousProteinChange } from "../../../src/shared/proteinAlleleIdentity.ts";
import { verifiedPopulationCoordinate } from "../prediction/predictors/allele-identity.ts";
import { CONFIG } from "../../config.ts";
import { credentialAvailable } from "../infra/credentials.ts";

export type { ServiceFetchStatus, ServiceStatusMap, CoreAnalysisData, StructuralAnalysisData };
export {
  healCachedAnalysisIfPossible,
  fetchCoreVariantData,
  fetchStructuralModelData,
  assembleCoreResponsePayload,
  persistVariantAnalysisPayload,
  buildAnalysisPayload,
  persistAnalysis,
  withCacheProvenance
};

/**
 * How long a recorded build refusal suppresses the AlphaGenome staleness check.
 *
 * A build refusal is TRANSIENT — the liftover may succeed on the next attempt (review M1).
 * Honoring it forever would pin a blanked payload to a row that has no expiry and no build
 * dimension; honoring it never would restore the every-view recompute thrash the predicate
 * exists to prevent. A bounded window threads both: no thrash while an outage persists, and
 * automatic recovery within one window after it ends.
 */
const REFUSAL_RETRY_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Removes server-internal routing metadata from a payload before it goes on the wire.
 *
 * `assembleCoreResponsePayload` carries `_internal.pdbMapping` for the STRUCTURAL route, which reads
 * it back from the persisted record, and `/analyze-variant` destructures it away before responding.
 * The stream route did not, so the final frame (and the cached-record frame) shipped internal
 * mapping fields — pdbId, chainId, unpStart, structStart, resolution, method, identity — to the
 * browser, where the client's `.passthrough()` schema then kept them in the result and in exports.
 * Nothing in `src/` reads them.
 *
 * Persistence still receives the unmodified payload: the structural route depends on it.
 */
function stripInternalFields<T extends Record<string, any>>(payload: T): Omit<T, "_internal"> {
  if (!payload || typeof payload !== "object") return payload;
  const { _internal, ...clientPayload } = payload;
  return clientPayload;
}

export function isStaleCachedPayload(payload: any, context?: ParsedVariantContext, recordUpdatedAt?: string | null): boolean {
  if (!payload) return true;
  // The persisted outer key is gene + protein + weighting, not nucleotide identity. A supplied
  // allele must escape a prior definitive ambiguity (or a different ALT at the same position).
  const requested = context ? predictorCoordinateFromContext(context) : null;
  if (requested) {
    const cached = verifiedPopulationCoordinate(payload.predictorData);
    const chrom = (value: string) => value.replace(/^chr/i, "").toUpperCase();
    if (!cached || cached.assembly !== requested.assembly || chrom(cached.chrom) !== chrom(requested.chrom) ||
        cached.pos !== requested.pos || cached.ref !== requested.ref || cached.alt !== requested.alt) return true;
  } else if (context?.variant && isIntrinsicallyAmbiguousProteinChange(context.variant, context.gene) &&
      (payload.predictorData?.gnomadVariantId || payload.predictorData?.caddPhred != null)) {
    // Conversely, a prior explicitly selected allele cannot disambiguate a new protein-only input.
    return true;
  }
  /**
   * A FALLBACK locus (the GRCh38 lookup failed on that run) is never a finished analysis.
   *
   * Serving it re-served the failure: every coordinate-keyed source refused its hg19 locus, and the
   * population evidence stayed withheld on every later view and every Recents click, though a fresh run
   * finds the GRCh38 locus (NAE1 p.Asp116Gly). The predictor cache already refuses to persist this state
   * (`vep-orchestrator.ts`, `shouldCache`) and the client bundle cache now declines it
   * (`isBuildDegradedResult`); this is the third cache in the same chain, held to the same rule. The
   * record itself is kept — the structural route reads `_internal` from it.
   */
  // The same policy as client restores: reject transient null-locus results and migrate old
  // fallback allele-identity policies, including apparently canonical database-inferred answers.
  if (isBuildDegradedResult({
    ...payload,
    metadata: { ...payload.metadata, gene: context?.gene ?? payload.metadata?.gene, variant: context?.variant ?? payload.metadata?.variant }
  })) return true;
  const cons = payload.conservationData;
  if (cons && cons.available === true) {
    if (cons.dann === null || cons.bayesdel === null || cons.clinpred === null || cons.eigenPhred === null) {
      return true;
    }
    // A live SpliceAI score carries the window it was computed under. A reader who has since chosen a
    // different window must not be served the old one under the new label: recompute. A score with no
    // stated window (a frozen table) cannot be compared, so it is left alone.
    const scoredWindow = cons.spliceai?.provenance?.source === "broad-lookup" ? cons.spliceai.provenance.distanceBp : null;
    if (context?.spliceaiDistance && typeof scoredWindow === "number" && scoredWindow !== context.spliceaiDistance) {
      return true;
    }
    // Invalidate stale cache if Hugging Face token is provided but cached payload lacks GPN-Star
    const hasGpnToken = credentialAvailable("huggingface", context?.hfToken);
    if (hasGpnToken) {
      const gpnMissing = cons.gpnStar === null && (cons.gpnStarStatus === "token_required" || cons.gpnStarStatus === "unavailable" || !cons.gpnStarStatus);
      if (gpnMissing) return true;
    }
    // Invalidate stale cache if Biohub token is provided but cached payload lacks ESM3
    const hasBiohubToken = credentialAvailable("biohub", context?.biohubToken);
    if (hasBiohubToken && payload.structuralModels) {
      const esm3Missing = payload.structuralModels.esm3?.score === null && (payload.structuralModels.esm3?.status === "token_required" || !payload.structuralModels.esm3?.status);
      if (esm3Missing) return true;
    }
    // Invalidate stale cache if AlphaGenome key or endpoint is configured but cached payload lacks live AlphaGenome AVI score
    const hasAlphaGenomeKey = Boolean(
      context?.alphagenomeApiKey ||
      context?.alphagenomeApiUrl ||
      process.env.ALPHAGENOME_API_KEY ||
      CONFIG.services.alphagenomeApiKey
    );
    if (hasAlphaGenomeKey) {
      const isAlreadyQueriedUnindexed = Boolean(cons.alphagenome?.message?.includes("not indexed"));
      // A source the build gate REFUSED cannot be satisfied by recomputing it right now — the
      // predicate used to demand a live AVI for every GRCh37-coordinate payload, discarding the
      // persisted analysis on every view forever (the AlphaGenome standby RCA's "aggravating
      // side effect"). The refusal is recorded, so honour it — but for a bounded window only:
      // unlike "not indexed" (a permanent Atlas property), a build refusal is transient, and
      // the lift may succeed on the next attempt (review M1).
      const refusalIsRecent = (() => {
        if (!recordUpdatedAt) return false;
        const t = new Date(recordUpdatedAt).getTime();
        return Number.isFinite(t) && Date.now() - t < REFUSAL_RETRY_WINDOW_MS;
      })();
      const isBuildRefused = refusalIsRecent &&
        Boolean(cons.assemblyRefusals?.some((r: { source: string }) => r.source === "alphagenome"));
      const alphaMissing = !isBuildRefused && !isAlreadyQueriedUnindexed &&
        (!cons.alphagenome || (cons.alphagenome.status !== "live" || cons.alphagenome.aviPhred === null));
      if (alphaMissing) return true;
    }
  }
  return false;
}

/**
 * The single decision every route makes before trusting a persisted row.
 *
 * Two predicates, in this order:
 *
 *   1. the STALENESS predicate — a payload missing a source a configured provider can now answer
 *      (GPN-Star / ESM3 / AlphaGenome) is recomputed, which is what backfills a capability that was
 *      unavailable when the row was written;
 *   2. the CONTEXT-IDENTITY guard — a payload that states a DIFFERENT scientific identity (another
 *      build trail, weighting, numbering decision, sequence, or provider/endpoint set) is refused, and
 *      so is one that states NO identity at all: an unstamped row cannot be verified, so it is
 *      recomputed ONCE and the recompute stamps it. That is a one-time recompute, not a cache wipe —
 *      the reader gets freshly fetched evidence, not an empty card.
 *
 * See `core-identity.ts` for why the identity lives in the payload instead of a new column.
 */
function isUsableCachedPayload(
  payload: any,
  context: ParsedVariantContext,
  recordUpdatedAt?: string | null,
  scope: IdentityScope = "core"
): boolean {
  if (!payload) return false;
  if (isStaleCachedPayload(payload, context, recordUpdatedAt)) return false;

  const compatibility = checkPayloadCompatibility(payload, context, scope);
  if (!compatibility.compatible) {
    const message =
      `[Cache Context Guard] Recomputing ${context.gene} ${context.variant}: ${compatibility.reason}.`;
    /**
     * An unstamped row is an EXPECTED, self-healing refresh (every row written before this guard, one
     * per variant). A stated mismatch is an anomaly — two identity records that disagree — so it is
     * the one that deserves a warning.
     */
    if (compatibility.recorded) console.warn(message);
    else console.log(message);
    return false;
  }
  return true;
}

/**
 * Merges the structural models' outcomes into the payload's status map WITHOUT losing the core's.
 *
 * The two maps collided on `esm2`: the core run records its VESM-150M triage evaluation there
 * (`core-data-fetcher.ts` status rules), and the structural run recorded its ESM-2 650M outcome
 * under the same key. A plain spread therefore replaced a measured core outcome with a deep-model
 * one, so the same source read `timeout` on one surface and `ok` on another depending on which
 * route answered last. The structural producer now reports `esm2Eval`; this function additionally
 * refuses to let ANY `esm2` key in the structural map overwrite the core's, so a stale or
 * third-party producer cannot reintroduce the collision through the merge.
 */
export function mergeStructuralServiceStatus(
  coreStatus: Record<string, string> | null | undefined,
  structuralStatus: Record<string, string> | null | undefined
): Record<string, string> {
  const merged: Record<string, string> = { ...(coreStatus || {}) };
  for (const [key, value] of Object.entries(structuralStatus || {})) {
    if (key === "esm2") continue;
    merged[key] = value;
  }
  return merged;
}

/**
 * Orchestrates synchronous end-to-end execution of core variant analysis (/analyze-variant).
 *
 * Shares a running core fetch when one exists for the same scientific identity: this route and
 * `/analyze-variant/stream` are fired together by the client, they miss the same row at the same
 * instant, and there is no reason for the providers to be asked twice (see `core-singleflight.ts`).
 */
export async function runCoreAnalysis(context: ParsedVariantContext): Promise<any> {
  const { gene, variant, acmgWeighting } = context;

  // Check persistent SQLite database
  const db = AnalysisDatabase.getInstance();
  const cachedRecord = await db.getVariantAnalysisAsync(gene, variant, acmgWeighting);
  if (cachedRecord && isUsableCachedPayload(cachedRecord.payload, context, cachedRecord.updatedAt)) {
    /**
     * A RESTORE, and the response says so — measured here rather than inferred by the client from how
     * fast this answered. `withCacheProvenance` copies: the row must not record a wire provenance.
     */
    return withCacheProvenance(healCachedAnalysisIfPossible(cachedRecord.payload, context), true);
  }

  const coreData = await runSharedCoreFetch(context, { timeoutMs: CONFIG.timeouts.coreAnalysisMs });
  const responsePayload = assembleCoreResponsePayload(coreData, context);
  /**
   * Deliberately NOT awaited: the reader's payload is assembled and every source is down, so the
   * response must not wait on a database round trip. The helper's returned promise is handled here —
   * it never rejects (a write failure is logged inside it) — rather than left floating by accident.
   */
  void persistVariantAnalysisPayload(context, responsePayload, coreData.ruleBasedInsights?.acmgVerdict || null);

  /** The row keeps no wire provenance (above); the RESPONSE states that this evidence is fresh. */
  return withCacheProvenance(responsePayload, false);
}

/**
 * Progressive streaming orchestration for /analyze-variant/stream endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CHUNK CONTRACT (read before changing what is written)
 * ─────────────────────────────────────────────────────────────────────────────
 * Three kinds of frame travel on this NDJSON stream, and a client must be able to tell them apart:
 *
 *   `{ chunkIndex, isFinal: false, data }`  progress. `data` carries only what has settled; the
 *                                           status map is the full running map, so nothing that is
 *                                           still `pending` can be mistaken for a measured absence.
 *   `{ chunkIndex, isFinal: true,  data }`  the authoritative full payload. Consumers must treat
 *                                           this one as the result; earlier frames are previews.
 *   `{ type: "heartbeat" }`                 liveness ONLY — no data. Written every
 *                                           `STREAM_HEARTBEAT_MS` even while nothing has settled.
 *
 * The heartbeat is what keeps the contract honest about CLOCKS: the client used to abort the body
 * after 30 s of silence while this function was entitled to 45 s between data chunks, so a healthy
 * run was reported as a stalled stream. Silence now means a dead transport, which is the only thing
 * the client's bound can usefully detect.
 */
export async function streamCoreAnalysis(
  context: ParsedVariantContext,
  onChunk: (chunk: { chunkIndex: number; isFinal?: boolean; data?: any; type?: "heartbeat" }) => void,
  signal?: AbortSignal
): Promise<any> {
  if (signal?.aborted) return null;

  /**
   * Armed BEFORE the first await.
   *
   * Chunk 1 cannot be written until ClinVar AND the predictors have answered (that pair is the
   * fast triage's own barrier), so the first silence of a run is at its very start — precisely when
   * the client's idle bound would otherwise fire on a healthy request.
   *
   * The body is guarded: it is the one write on this stream that runs outside any awaited call and
   * any `try`, so a throw here (a torn socket) would surface as a timer-context uncaught exception
   * rather than as a stream error. On a throw the interval retires rather than repeating.
   */
  const heartbeats = setInterval(() => {
    try {
      if (signal?.aborted) return;
      onChunk({ chunkIndex: 0, isFinal: false, type: "heartbeat" });
    } catch (err: any) {
      console.warn("[Stream Heartbeat] Writer threw; retiring the heartbeat:", err?.message ?? err);
      clearInterval(heartbeats);
    }
  }, STREAM_HEARTBEAT_MS);

  try {
    return await runStream(context, onChunk, signal);
  } finally {
    clearInterval(heartbeats);
  }
}

async function runStream(
  context: ParsedVariantContext,
  onChunk: (chunk: { chunkIndex: number; isFinal?: boolean; data?: any; type?: "heartbeat" }) => void,
  signal?: AbortSignal
): Promise<any> {

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

  const db = AnalysisDatabase.getInstance();
  const cachedRecord = await db.getVariantAnalysisAsync(gene, variant, context.acmgWeighting);
  if (cachedRecord && isUsableCachedPayload(cachedRecord.payload, context, cachedRecord.updatedAt)) {
    const healed = healCachedAnalysisIfPossible(cachedRecord.payload, context);
    /** A RESTORE from the analysis row, stated on the frame rather than guessed by the client. */
    const restored = withCacheProvenance(healed, true);
    onChunk({
      chunkIndex: 1,
      isFinal: true,
      data: stripInternalFields(restored)
    });
    return restored;
  }

  // Every source can open the stream. Identity accompanies the first real evidence;
  // no empty result is published and no slow source holds back a faster one.
  let previewIndex = 0;
  const identity = {
    gene, variant, uniprotId,
    residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
    wildType, mutant, sequence: sequence ?? null,
    mutatedSequence: buildMutatedSequence(sequence, pos, wt1Letter, mut1Letter)
  };
  const writeCorePartial = (partial: CoreAnalysisPartial) => {
    if (signal?.aborted) return;
    onChunk({
      chunkIndex: ++previewIndex,
      isFinal: false,
      data: withCacheProvenance({
        ...partial.data,
        metadata: { ...identity, ...(partial.data.metadata as object), serviceStatus: partial.serviceStatus },
        serviceStatus: partial.serviceStatus
      }, false)
    });
  };

  /**
   * Fast triage: fetch ClinVar + Predictors immediately with fine-grained status tracking.
   *
   * `triageStartedAt` is a REAL clock reading taken as these two promises are created, and it is
   * handed to the core fetch so the per-source timings it reports for a prefetched source cover that
   * source's whole latency rather than only the tail the core fetch happened to observe. Nothing is
   * estimated or reconstructed from strings, here or there.
   */
  /**
   * IS ANOTHER ROUTE ALREADY RUNNING THIS CORE FETCH?
   *
   * Asked BEFORE the triage is started, because that run already holds the two fast answers (its own
   * ClinVar and predictor queries), and re-asking the providers for a frame this route can build from
   * them is exactly the duplicate the fan-out produces in practice: the structural request opens the
   * run, the stream arrives a few milliseconds later. Adopting them also means chunk 1 and the final
   * payload cannot disagree about ClinVar — they are the same answer.
   */
  const runningCore = findRunningCoreFetch(context);
  const adoptedTriage: CoreFastTriage | null = runningCore?.fastTriage ?? null;

  const triageStartedAt = performance.now();

  const fastClinvarPromise: Promise<{ data: ClinVarData | null; status: ServiceFetchStatus }> = adoptedTriage
    ? adoptedTriage.clinvar
    : (async () => {
        try {
          const data = await fetchClinVarData(gene, variant, context.originalNotation);
          const status: ServiceFetchStatus = data
            ? (data.classification === "Not found in ClinVar" ? "not_found" : "ok")
            : "not_found";
          return { data, status };
        } catch (err: any) {
          const isTimeout = err?.name === "TimeoutError" || err?.message?.toLowerCase().includes("timeout");
          return { data: null, status: (isTimeout ? "timeout" : "error") as ServiceFetchStatus };
        }
      })();

  const fastPredictorPromise: Promise<{ data: PredictorData | null; status: ServiceFetchStatus }> = adoptedTriage
    ? adoptedTriage.predictorData
    : (async () => {
        try {
          // Pairing lives in one shared helper: a coordinate beside the wrong build is the
          // wrong-locus hazard, and the canonical pair the translation step verified is preferred
          // (so a GRCh37 input is not lifted a second time here).
          const inputCoordinate = predictorCoordinateFromContext(context);
          const data = await fetchPredictorData(gene, variant, uniprotId, inputCoordinate);
          return { data, status: (data ? "ok" : "not_found") as ServiceFetchStatus };
        } catch (err: any) {
          const isTimeout = err?.name === "TimeoutError" || err?.message?.toLowerCase().includes("timeout");
          return { data: null, status: (isTimeout ? "timeout" : "error") as ServiceFetchStatus };
        }
      })();

  /**
   * The triage's own verdict on the two prefetched sources, exposed as GETTERS.
   *
   * The core fetch is started before `Promise.all` below, so it cannot be handed the statuses as
   * values yet. It does not need to be: its status rules read these fields when the corresponding
   * promise settles, and the getters resolve then. The ordering is guaranteed by data dependency
   * rather than by timing luck — each triage promise assigns its status BEFORE it resolves, and the
   * promise the core fetch consumes is derived from that resolution, so the status is always in
   * place before any rule can read it.
   */
  let clinvarTriageStatus: ServiceFetchStatus | undefined;
  let predictorTriageStatus: ServiceFetchStatus | undefined;
  // Both triage promises resolve rather than reject (their bodies catch the provider error and return
  // an outcome, and an adopted one already carries the run's own verdict), but the chains are closed
  // explicitly so a future edit cannot turn one into an unhandled rejection on a request that is
  // already answering.
  fastClinvarPromise.then(outcome => { clinvarTriageStatus = outcome.status; }).catch(() => {});
  fastPredictorPromise.then(outcome => { predictorTriageStatus = outcome.status; }).catch(() => {});

  const prefetched: CorePrefetchOptions = {
    clinvarPromise: fastClinvarPromise.then(r => r.data),
    predictorPromise: fastPredictorPromise.then(r => r.data),
    get clinvarStatus() { return clinvarTriageStatus; },
    get predictorStatus() { return predictorTriageStatus; },
    /**
     * Only when THIS route started the source. An adopted promise's origin was observed by the run
     * that created it, not here, so reporting `triageStartedAt` for it would be an invented start
     * time; absent, the duration is measured from when this route attached, which is what it saw.
     */
    ...(adoptedTriage ? {} : { clinvarStartedAt: triageStartedAt, predictorStartedAt: triageStartedAt })
  };

  const fullCorePromise = runSharedCoreFetch(context, {
    timeoutMs: CONFIG.timeouts.coreAnalysisMs,
    prefetched,
    onPartial: writeCorePartial
  });

  // The shared core budget bounds the stream even if an upstream triage promise
  // never settles. Handle core rejection immediately through this race as well.
  const triage = await Promise.race([
    Promise.all([fastClinvarPromise, fastPredictorPromise]),
    fullCorePromise.then(() => null)
  ]);
  if (signal?.aborted) return null;

  if (triage && previewIndex === 0) {
    const [clinvarOutcome, predictorOutcome] = triage;
    const clinvarRes = clinvarOutcome.data;
    const predictorRes = predictorOutcome.data;

    const chunk1ServiceStatus: ServiceStatusMap = {
      clinvar: clinvarOutcome.status,
      predictorData: predictorOutcome.status,
      conservationData: "pending" as any,
      gnomadFrequency: "pending" as any,
      gnomadConstraint: "pending" as any,
      uniprotFeatures: "pending" as any,
      stringInteractions: "pending" as any,
      disruptionPredictor: "pending" as any,
      esm2: "pending" as any,
      pdbMapping: "pending" as any
    };

    const mutatedSequence = buildMutatedSequence(sequence, pos, wt1Letter, mut1Letter);

    const preliminaryVerdict = computeRuleBasedACMG({
      gene,
      variant,
      residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
      clinvar: clinvarRes,
      predictorData: predictorRes,
      acmgWeighting: context.acmgWeighting,
      sequence,
      serviceStatus: chunk1ServiceStatus
    });

    const chunk1Data = {
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
        wildType,
        mutant,
        // Same reason as the assembled payload: the report's re-synthesis asks the narrative
        // route for this sequence, and a chunk that omits it leaves that request incomplete.
        sequence: sequence ?? null,
        mutatedSequence,
        // The FULL running map, not just the two settled keys. Chunk 1 is the first frame a client
        // paints, so a map that omits the other eight sources leaves a consumer unable to tell
        // "still working" from "measured, and empty" for the entire run.
        serviceStatus: chunk1ServiceStatus
      },
      clinvar: clinvarRes,
      predictorData: predictorRes,
      serviceStatus: chunk1ServiceStatus,
      ruleBasedInsights: preliminaryVerdict
    };

    /**
     * Chunk 1 is FRESH evidence (a cache restore emits a single final frame instead, above), and it
     * says so on the first frame the client paints — so a surface never has to guess provenance from
     * how fast the frame arrived.
     */
    onChunk({ chunkIndex: ++previewIndex, isFinal: false, data: withCacheProvenance(chunk1Data, false) });
  }

  // Per-source snapshots have already been delivered in settlement order.
  const fullCoreData = await fullCorePromise;
  if (signal?.aborted) return null;

  const fullPayload = assembleCoreResponsePayload(fullCoreData, context);
  /** The authoritative frame states its own provenance: this evidence was fetched now, not restored. */
  const finalPayload = withCacheProvenance(fullPayload, false);

  onChunk({
    // After every preview that was emitted before it, whatever number that reached.
    chunkIndex: previewIndex + 1,
    isFinal: true,
    data: stripInternalFields(finalPayload)
  });

  /**
   * Deliberately NOT awaited: the final frame has already been written, and a reader must not be
   * held by a database round trip. The promise is handled by the helper (it never rejects).
   *
   * The ROW is persisted from `fullPayload`, not from `finalPayload`: `cacheHit: false` is a fact
   * about this response, and a row that replayed it later would be stating a provenance it no longer
   * has.
   */
  void persistVariantAnalysisPayload(context, fullPayload, fullCoreData.ruleBasedInsights?.acmgVerdict || null);

  return finalPayload;
}

/**
 * High-level orchestration for /analyze-variant/structural endpoint.
 */
export async function runStructuralAnalysis(
  context: ParsedVariantContext,
  biohubToken: string | null,
  hfToken: string | null
) {
  const {
    gene,
    variant,
    acmgWeighting,
    sequence
  } = context;

  // Check persistent SQLite database for existing core data
  const db = AnalysisDatabase.getInstance();
  const cached = await db.getVariantAnalysisAsync(gene, variant, acmgWeighting);

  /**
   * CACHE GATES for the structural route, which used to trust any row it found.
   *
   * Two things were reused from it unconditionally: the assembled core payload as this run's core
   * evidence, and `_internal.pdbMapping` as the structure the deep models would read. A row can be
   * stale (a source a configured provider can now answer), or belong to a DIFFERENT context (another
   * build trail, weighting, capability or model set) — and a mapping from another context can sit
   * outside this residue's position, which is the one error a structure-reading model cannot detect
   * for itself. Both gates are applied before either value is handed on.
   */
  const cachedPayload = cached?.payload ?? null;
  const cachedCoreUsable = isUsableCachedPayload(cachedPayload, context, cached?.updatedAt, "core");
  const cachedPdbMapping = cachedCoreUsable ? (cachedPayload?._internal?.pdbMapping ?? null) : null;

  // Run deep models concurrently with core data fetching (or reuse a VALIDATED existing payload).
  //
  // A cache miss here shares a running core fetch rather than repeating it: the UI opens the stream
  // for the same variant moments before (or after) this request, and both would otherwise miss the
  // same row and ask all eleven providers twice. See `core-singleflight.ts`.
  const [structuralData, coreData] = await Promise.all([
    fetchStructuralModelData(context, biohubToken, hfToken, CONFIG.timeouts.structuralModelsMs, {
      /**
       * A validated mapping saves the PDBe round trip. An unusable one is left OUT of the object
       * entirely rather than sent as `null`: the fetcher reads an explicit `null` as "this mapping
       * is the answer, and there is none", which skipped the structure lookup altogether and
       * silently demoted the run to AlphaFold.
       */
      pdbMapping: cachedPdbMapping ?? undefined
    }),
    cachedCoreUsable ? Promise.resolve(cachedPayload) : runSharedCoreFetch(context, { timeoutMs: CONFIG.timeouts.coreAnalysisMs })
  ]);

  const ruleBasedInsights = computeRuleBasedACMG({
    gene,
    variant,
    residueIndex: context.residueIndex ? parseInt(context.residueIndex, 10) : null,
    clinvar: coreData.clinvar,
    predictorData: coreData.predictorData,
    conservationData: coreData.conservationData,
    gnomadConstraint: coreData.gnomadConstraint,
    gnomadFrequency: coreData.gnomadFrequency,
    acmgWeighting,
    esm2: coreData.esm2,
    uniprotFeatures: coreData.uniprotFeatures,
    sequence,
    esmcEval: structuralData.esmcEval,
    esm2Eval: structuralData.esm2Eval,
    saprotEval: structuralData.saprotEval,
    serviceStatus: coreData.serviceStatus
  });

  const basePayload = cachedCoreUsable && cachedPayload ? cachedPayload : assembleCoreResponsePayload(coreData, context);

  /**
   * The merge keeps the CORE's `esm2` (its VESM-150M outcome) and records the structural ESM-2 650M
   * outcome under `esm2Eval`. The old spread put both under `esm2`, so a finished deep model replaced
   * a measured core source and the Evidence Lineage could list one source twice, disagreeing with
   * itself. See `mergeStructuralServiceStatus`.
   */
  const mergedServiceStatus = mergeStructuralServiceStatus(
    basePayload.serviceStatus || coreData.serviceStatus || {},
    structuralData.serviceStatus || {}
  );

  /**
   * The structural models' OWN spans, under structural names.
   *
   * `updatedPayload` spreads `basePayload`, which carries the CORE `serviceTimings` /
   * `serviceTimingOffsets`; these are written beside them, never over them — a payload that mixed the
   * two would have a waterfall of one run labelled with another's sources.
   */
  const structuralTimings = structuralData.structuralTimings || {};
  const structuralTimingOffsets = structuralData.structuralTimingOffsets || {};

  const updatedPayload = {
    ...basePayload,
    esm3Eval: structuralData.esm3Eval,
    esmcEval: structuralData.esmcEval,
    esm2Eval: structuralData.esm2Eval,
    saprotEval: structuralData.saprotEval,
    serviceStatus: mergedServiceStatus,
    ruleBasedInsights,
    structuralTimings,
    structuralTimingOffsets,
    metadata: {
      ...((basePayload?.metadata as Record<string, unknown>) || {}),
      structuralTimings,
      structuralTimingOffsets
    },
    _internal: {
      ...(basePayload?._internal || {}),
      /**
       * WHICH structural run produced the four deep-model fields above — recorded, in the payload,
       * under the same non-migrating guard the core block uses. A later structural read of this row
       * can therefore refuse to present a checkpoint's numbers as another checkpoint's (the
       * capability digest in this record includes the SaProt model choice, which the core record
       * deliberately does not).
       */
      structuralIdentity: structuralIdentityRecordOf(context)
    }
  };

  /** Deliberately NOT awaited — the response is the reader's, and it must not wait on the write. */
  void persistVariantAnalysisPayload(context, updatedPayload, ruleBasedInsights?.acmgVerdict || null);

  return {
    esm3Eval: structuralData.esm3Eval,
    esmcEval: structuralData.esmcEval,
    esm2Eval: structuralData.esm2Eval,
    saprotEval: structuralData.saprotEval,
    serviceStatus: mergedServiceStatus,
    ruleBasedInsights,
    /** Readable straight off the response: a span per model, including the ones that failed. */
    structuralTimings,
    structuralTimingOffsets
  };
}
