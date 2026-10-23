import { fetchClinVarData, type ClinVarData } from "./clinvar.ts";
import {
  fetchAlphafoldPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  type PdbBestStructureMapping
} from "../structure/structure-fetcher.ts";
import {
  fetchPredictorData,
  fetchConservationData,
  fetchConservationDataProgressive
} from "../prediction/index.ts";
import { expireConservationSnapshot } from "../prediction/predictors/conservation-orchestrator.ts";
import { fetchStringInteractions, type StringInteraction } from "./string.ts";
import {
  fetchGnomadGeneConstraint,
  fetchGnomadVariantFrequency,
  type GnomadVariantFrequency,
  type GnomadGeneConstraint
} from "./gnomad.ts";
import { fetchLocalPopulationFrequencies } from "../prediction/landscape.ts";
import { fetchUniprotFeatures, type UniprotFeaturesResult } from "./uniprot.ts";
import type { PredictorData, ConservationData, AouLookup } from "../../../src/shared/contracts.ts";
import {
  predictorCoordinateFromContext,
  PDB_SOURCE_ALPHAFOLD,
  PDB_SOURCE_RCSB,
  type PdbSource
} from "../../../src/shared/contracts.ts";
import {
  CANONICAL_ASSEMBLY,
  type AssemblyTaggedCoordinate,
} from "../../../src/shared/assembly.ts";
import { isLocalDbnsfpAvailable } from "../prediction/dbnsfp_local.ts";
import { queryGenosWebservice } from "./genos_web.ts";
import { predictStructuralDisruption, runEsm2Eval, type DisruptionPrediction } from "../stability/biophysics.ts";
import { computeRuleBasedACMG, type RuleBasedInsights } from "../prediction/acmg.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter } from "../infra/http-client.ts";
import { healCachedAnalysisIfPossible } from "../orchestration/self-healer.ts";
import type { ServiceFetchStatus, ServiceStatusMap, CoreAnalysisData } from "../orchestration/payload-assembler.ts";
import {
  BUDGET_EXPIRED,
  createTimeoutScope,
  type TimeoutScope
} from "../orchestration/timeout-scope.ts";
import { CONFIG } from "../../config.ts";
import { verifiedPopulationCoordinate } from "../prediction/predictors/allele-identity.ts";
import { makeLocusRunner, speculativeCoordinateLocus, speculativeLocusMode } from "../prediction/predictors/speculative-locus.ts";

function hasPopulationObservation(value: any): boolean {
  return Boolean(value && [value.maxAF, value.groupMaxAF, value.genomeAF, value.exomeAF,
    value.genomeAC, value.exomeAC, value.genomeAN, value.exomeAN, value.nHomozygous].some(v => v != null));
}

export type { ServiceFetchStatus, ServiceStatusMap, CoreAnalysisData };

/**
 * One progressive emission from the core fetch: whatever has settled so far.
 *
 * `data` holds only the fields that are ready. `serviceStatus` is the FULL running status map —
 * every key present, unsettled ones as `"pending"` — because a map that simply omits a source is
 * indistinguishable downstream from one that has been measured and found empty. That distinction is
 * clinical: `frequencyEvidence` renders "still running" for `pending` and "extremely rare / PM2
 * ceiling" for `not_found`, so an absent key let a gnomAD query still in flight be read as a
 * confirmed absence.
 */
export interface CoreAnalysisPartial {
  data: Record<string, unknown>;
  serviceStatus: RunningServiceStatus;
  serviceTimings: Record<string, number>;
  /**
   * WHEN each settled source settled, on this run's clock — as opposed to `serviceTimings`, which is
   * how long it took.
   *
   * SETTLEMENT, not start. A consumer that needs a span's origin derives it as
   * `serviceTimingOffsets[key] - serviceTimings[key]`, clamped at 0 — the subtraction is exact
   * whenever the duration is complete, and clamps to 0 for a source that was already in flight when
   * this run's clock began (which is the honest reading of "it started before this clock did", not a
   * negative time). Nothing here is an estimated start.
   *
   * The distinction is not cosmetic. A source can be prefetched by the caller (the stream's fast
   * triage starts ClinVar and the predictors before this function is called), and a duration measured
   * from "when this function attached" is then only the TAIL of that source's real latency, reported
   * as though it were the whole of it. The offset is measured from the run's own start to the settle
   * instant, so it is a true position on the timeline whatever started the promise — which is what a
   * waterfall needs and what a duration cannot be reconstructed into once the tail is all that was
   * observed.
   */
  serviceTimingOffsets: Record<string, number>;
}

/**
 * The caller's fast triage as the SHARED RUN sees it: data beside the verdict this pipeline would
 * itself assign to that data.
 *
 * Handed out synchronously by {@link fetchCoreVariantData} (through its `onFastTriage` listener) so a
 * route that joins an ALREADY-RUNNING core fetch can build its own first frame from the same two
 * answers instead of asking the providers again. Two consequences, both wanted:
 *
 *   • no duplicate ClinVar / predictor query when the structural request started the run first, which
 *     is the order the client's fan-out actually produces today;
 *   • the joining route's first frame and the run's final payload cannot disagree about ClinVar,
 *     because they are the SAME answer rather than two answers taken half a second apart — a real
 *     hazard when a classifier is read off both surfaces.
 */
export interface CoreFastTriage {
  clinvar: Promise<{ data: ClinVarData | null; status: ServiceFetchStatus }>;
  predictorData: Promise<{ data: PredictorData | null; status: ServiceFetchStatus }>;
}

export type CoreFastTriageListener = (triage: CoreFastTriage) => void;

/**
 * The status map of a RUN in progress: the ten sources of {@link ServiceStatusMap}, with anything
 * not yet settled marked `"pending"`.
 *
 * Deliberately a distinct type rather than `ServiceStatusMap`: `pending` is a statement about the
 * request, not about the variant, and only the final payload may claim the latter.
 */
export type RunningServiceStatus = Record<keyof ServiceStatusMap, ServiceFetchStatus | "pending">;

/** Every source the running map must account for. Order is the payload's own. */
const SERVICE_STATUS_KEYS: readonly (keyof ServiceStatusMap)[] = [
  "clinvar",
  "predictorData",
  "conservationData",
  "stringInteractions",
  "disruptionPredictor",
  "esm2",
  "gnomadConstraint",
  "gnomadFrequency",
  "uniprotFeatures",
  "pdbMapping"
];

export type CoreAnalysisPartialListener = (partial: CoreAnalysisPartial) => void;

/**
 * Work the caller has already started, handed down instead of repeated.
 *
 * Exported (rather than an inline parameter type) so the singleflight layer and the tests can name
 * the same shape this function accepts.
 */
export interface CorePrefetchOptions {
  clinvarPromise?: Promise<ClinVarData | null>;
  predictorPromise?: Promise<PredictorData | null>;
  /**
   * The triage's OWN verdict on the two prefetched sources.
   *
   * Load-bearing, and the reason it is forwarded rather than re-derived: `streamCoreAnalysis`
   * catches the provider error and resolves `{data: null, status: "timeout" | "error"}`, so the
   * failure never reaches this function's own `catch` blocks. Re-deriving the status from a null
   * value therefore reported an OUTAGE as `not_found` — "ClinVar holds no submission for this
   * variant" for a query that was never answered — while the non-streaming route reported `error`
   * for the same event. Two routes, two answers, both about a clinical absence.
   */
  clinvarStatus?: ServiceFetchStatus;
  predictorStatus?: ServiceFetchStatus;
  /**
   * `performance.now()` at which the prefetched promise's own request STARTED.
   *
   * Only meaningful beside the matching promise, and only so that `serviceTimings` reports that
   * source's REAL latency instead of the tail this function happened to observe. Absent, the clock
   * starts when this function attaches to the promise.
   */
  clinvarStartedAt?: number;
  predictorStartedAt?: number;
}

/**
 * Executes parallel fetching of external databases and quick predictor pipelines with timeout racing.
 *
 * @param onPartial Called once per source, the moment that source settles. Optional: the
 *   non-streaming `/analyze-variant` route has no use for it.
 * @param onFastTriage Called ONCE, synchronously, with the ClinVar and predictor outcomes of this run
 *   as raced promises. The singleflight layer uses it to let a route that joins this run build its
 *   own first frame from the same two answers instead of asking the providers again — see
 *   {@link CoreFastTriage}.
 */
export async function fetchCoreVariantData(
  context: ParsedVariantContext,
  coreTimeoutMs: number = CONFIG.timeouts.coreAnalysisMs,
  prefetched?: CorePrefetchOptions,
  onPartial?: CoreAnalysisPartialListener,
  onFastTriage?: CoreFastTriageListener
): Promise<CoreAnalysisData> {
  /**
   * One scope for the whole run, disposed in a `finally`.
   *
   * Every race below arms a timer, and each is cleared the moment its source settles; the disposal
   * is what covers the path where this function throws instead of returning — a request that dies
   * mid-flight must not leave eleven timers armed behind it, one per source, for the length of the
   * budget.
   */
  const budgets = createTimeoutScope();
  try {
    return await runCoreFetch(context, coreTimeoutMs, prefetched, onPartial, onFastTriage, budgets);
  } finally {
    budgets.dispose();
  }
}

async function runCoreFetch(
  context: ParsedVariantContext,
  coreTimeoutMs: number,
  prefetched: CorePrefetchOptions | undefined,
  onPartial: CoreAnalysisPartialListener | undefined,
  onFastTriage: CoreFastTriageListener | undefined,
  budgets: TimeoutScope
): Promise<CoreAnalysisData> {
  const {
    gene,
    variant,
    uniprotId,
    originalNotation,
    acmgWeighting,
    // Build the caller's notation was expressed in; forwarded so build-pinned sources can
    // be skipped rather than handed another build's coordinates.
    assembly = CANONICAL_ASSEMBLY,
    // The coordinate the protein notation was translated from, when the caller declared its
    // build. Tagged and handed to the predictor so it can query VEP by POSITION — the protein-
    // HGVS route is rejected by Ensembl for codon-ambiguous substitutions and isoform-remapped
    // genes, and every such rejection used to land the variant on the GRCh37 fallback path
    // (unmapping defect F-1).
    genomicCoordinates,
    liftedGenomicCoordinates,
    resolvedAssembly,
    sequence,
    pos,
    wt1Letter,
    mut1Letter,
    biohubToken,
    hfToken,
    gpnApiUrl,
    alphagenomeApiKey,
    alphagenomeApiUrl,
    spliceaiDistance
  } = context;

  /**
   * The coordinate the predictor may query by, PAIRED with its build.
   *
   * The pairing is the whole job — a coordinate beside the wrong build is the wrong-locus hazard —
   * so it lives in one shared helper instead of being rebuilt here and in the analysis
   * orchestrator. It prefers the canonical pair the translation step verified, which is why a
   * GRCh37 input no longer reaches the predictor tagged GRCh37 (and is no longer lifted twice).
   */
  const inputCoordinate: AssemblyTaggedCoordinate | null = predictorCoordinateFromContext(context);

  const overallStart = performance.now();
  const startedAt = new Date().toISOString();
  let loopBlockedMs = 0;
  let lastTick = performance.now();
  const lagTimer = setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - lastTick - 20);
    if (lag > loopBlockedMs) loopBlockedMs = Math.round(lag);
    lastTick = now;
  }, 20);
  lagTimer.unref?.();
  const serviceTimings: Record<string, number> = {};
  /** When each source SETTLED on this run's clock. See {@link CoreAnalysisPartial}. */
  const serviceTimingOffsets: Record<string, number> = {};

  const recordTiming = (key: string, startedAt: number): void => {
    const now = performance.now();
    serviceTimings[key] = Math.round(now - startedAt);
    serviceTimingOffsets[key] = Math.round(now - overallStart);
  };

  /**
   * Times one source — its REAL latency, not the tail this function happened to observe.
   *
   * `startedAt` is supplied when the caller prefetched the promise (the stream's fast triage does),
   * so a source that had already been running for 120 ms before this function was reached reports
   * 120 ms + whatever remained, rather than only the remainder. The offset is recorded either way,
   * because a duration alone cannot place a source on a timeline.
   */
  const timeTask = <T>(key: string, task: Promise<T>, startedAt?: number): Promise<T> => {
    const t0 = startedAt ?? performance.now();
    return task.then(
      value => {
        recordTiming(key, t0);
        return value;
      },
      err => {
        recordTiming(key, t0);
        throw err;
      }
    );
  };

  /**
   * The budget sentinel, aliased to the shared one so every `=== TIMEOUT_FLAG` comparison in this
   * file and in `statusRules` keeps working while the timer that produced it is disposable.
   */
  const TIMEOUT_FLAG = BUDGET_EXPIRED;
  /** Budget for a source on the core critical path. */
  const CORE_BUDGET_MS = coreTimeoutMs;
  /** Budget for the ESM-2 triage, which is allowed to answer later than the cheap sources. */
  /** Scaled for long proteins (>500 residues), whose CPU forward pass needs more time. */
  const DEEP_MODEL_BUDGET_MS = sequence.length > 500 ? 25000 : 15000;

  let clinvarHasError = false;
  const clinvarPromise = timeTask("clinvar", (prefetched?.clinvarPromise || fetchClinVarData(gene, variant, originalNotation)).catch(err => {
    console.warn("[ClinVar Parallel Run Warning] Failed to fetch ClinVar data:", err);
    clinvarHasError = true;
    return null;
  }), prefetched?.clinvarStartedAt);

  let predictorHasError = false;
  const predictorPromise = timeTask("predictorData", (prefetched?.predictorPromise || fetchPredictorData(gene, variant, uniprotId, inputCoordinate)).catch(err => {
    console.warn("[Predictor Parallel Run Warning] Failed to fetch predictor data:", err);
    predictorHasError = true;
    return null;
  }), prefetched?.predictorStartedAt);

  let pdbHasError = false;
  const pdbMappingPromise = timeTask("pdbMapping", fetchBestPdbStructure(uniprotId, pos).catch(err => {
    console.warn("[PDB Selection Error] Failed to query best PDB structure:", err);
    pdbHasError = true;
    return null;
  }));

  let stringHasError = false;
  const stringPromise = timeTask("stringInteractions", fetchStringInteractions(gene).catch(err => {
    console.warn("[STRING Parallel Run Warning] Failed to fetch STRING network:", err);
    stringHasError = true;
    return [];
  }));

  let esm2HasError = false;
  const esm2Promise = timeTask("esm2", runEsm2Eval(sequence, pos, wt1Letter, mut1Letter).catch(err => {
    console.warn("[ESM2 Parallel Run Warning] Failed to run ESM2 evaluation:", err);
    esm2HasError = true;
    return null;
  }));

  const genosPromise = timeTask("genosWeb", queryGenosWebservice(gene, variant).catch(err => {
    console.warn("[Genos Web Query Warning] Failed to run Genos web query:", err);
    return null;
  }));

  /**
   * The locus-dependent sources start on the local store's MANE locus instead of waiting for Ensembl
   * VEP, and are re-run on VEP's answer whenever the locus inputs differ (speculative-locus.ts). Each
   * one reports its status flags through its RESULT, so a discarded run can never leave a flag behind.
   */
  const localTableInstalled = isLocalDbnsfpAvailable() && pos !== null;
  const speculationApplied = speculativeLocusMode() === "on";
  const locusRunner = makeLocusRunner(
    localTableInstalled ? speculativeCoordinateLocus(gene, variant, uniprotId, inputCoordinate).catch(() => null) : Promise.resolve(null),
    predictorPromise,
    speculationApplied
  );

  let gnomadConstraintHasError = false;
  const gnomadConstraintPromise = timeTask("gnomadConstraint", locusRunner.run(locus => locus.then(pred => fetchGnomadGeneConstraint(gene, pos, { transcriptId: pred?.transcriptId, coordinate: verifiedPopulationCoordinate(pred) }))).catch(err => {
    console.warn("[Gnomad Constraint Warning] Failed to fetch gnomad gene constraint:", err);
    gnomadConstraintHasError = true;
    return null;
  }));

  let uniprotFeaturesHasError = false;
  const uniprotFeaturesPromise = timeTask("uniprotFeatures", fetchUniprotFeatures(uniprotId).catch(err => {
    console.warn("[UniProt Features Warning] Failed to fetch uniprot features:", err);
    uniprotFeaturesHasError = true;
    return null;
  }));

  /**
   * What the local All of Us lookup established, recorded as it happens so the payload can say WHICH
   * absence an empty row is (`aouLookup`). The lookup itself still resolves to null on every failure,
   * exactly as before — only the reason is new.
   */
  let localTableFailed = false;
  let localPopulationWithheld = false;
  const localFreqsPromise = timeTask("localFreqs", locusRunner.run(locus => locus.then(async pred => {
    const coordinate = verifiedPopulationCoordinate(pred);
    if (!coordinate) return { withheld: true, value: null };
    return { withheld: false, value: localTableInstalled ? await fetchLocalPopulationFrequencies(gene, pos!, variant, coordinate) : null };
  })).then(r => {
    if (r.withheld) localPopulationWithheld = true;
    return r.value;
  }).catch((err: any) => {
    console.warn("[Local dbNSFP Freq Warning] Error querying local frequencies:", err);
    localTableFailed = true;
    return null;
  }));

  let gnomadFreqHasError = false;
  /**
   * Set when the build gate below declines the coordinate.
   *
   * Tracked separately from "the query returned nothing" because the two are opposite facts about
   * the variant, and reporting the refusal as `not_found` made the ACMG classifier award PM2 for a
   * variant gnomAD was never asked about (see `ServiceFetchStatus`).
   */
  let gnomadFreqBuildRefused = false;
  const gnomadFrequencyPromise = timeTask("gnomadFrequency", localFreqsPromise.then((localFreqs: any) => {
    if (hasPopulationObservation(localFreqs?.gnomad)) return localFreqs.gnomad;
    return locusRunner.run(locus => locus.then(async pred => {
      /**
       * Build gate on the coordinate before querying gnomAD.
       *
       * The endpoint is gnomAD r4, which is GRCh38-only, and it answers by numeric position: an
       * id from another build whose alleles coincide resolves to a DIFFERENT locus and returns
       * that locus's population frequency. These frequencies drive PM2 / BA1 / BS1 / PS4, which
       * makes a wrong-locus value the highest-impact wrong number this pipeline can produce.
       *
       * A build that is unknown or unsupported therefore yields no frequency, and records WHY as
       * `unsupported-build` rather than as an absence. The build is also passed into the cache key so
       * a cross-build entry can never be served.
       */
      const coordinate = verifiedPopulationCoordinate(pred);
      if (!coordinate) return { refused: true, value: null };
      return { refused: false, value: await fetchGnomadVariantFrequency(pred!.gnomadVariantId!, { assembly: coordinate.assembly }) };
    })).then(r => {
      if (r.refused) gnomadFreqBuildRefused = true;
      return r.value;
    });
  }).catch(err => {
    console.warn("[Gnomad Frequency Warning] Error querying variant frequency:", err);
    gnomadFreqHasError = true;
    return null;
  }));

  let conservationHasError = false;
  /**
   * This producer queries conservation/Genos by protein notation and carries no exact-allele
   * provenance for AoU. A canonical predictor ID alone cannot bind those counts to its ALT.
   * Only the separately queried, exact-coordinate local frequency result is trusted below.
   */
  const withoutUnboundAou = (conservation: ConservationData | null): ConservationData | null =>
    conservation?.aouFrequency ? { ...conservation, aouFrequency: null } : conservation;

  /**
   * The composite's latest streamed snapshot, so a fast SpliceAI or AlphaGenome answer reaches the
   * reader before dbNSFP, ConSurf or GPN-Star finish, and so a composite whose budget expires keeps
   * the models that DID answer instead of discarding all of them.
   */
  let conservationLatestSnapshot: ConservationData | null = null;
  let conservationSettled = false;
  let conservationAttempts = 0;
  const onConservationSnapshot = (attempt: number, snapshot: ConservationData) => {
    const accept = () => {
      // A re-run on the confirmed locus supersedes the speculative one entirely.
      if (conservationSettled || attempt !== conservationAttempts) return;
      conservationLatestSnapshot = withoutUnboundAou(snapshot);
      publish({ conservationData: conservationLatestSnapshot }, {});
    };
    /**
     * A speculative-locus run's snapshots wait for the speculation to be confirmed. A discarded
     * locus's SpliceAI or AlphaGenome score describes a different allele: it must never be shown,
     * not even briefly before the re-run replaces it.
     */
    if (speculationApplied && attempt === 1) {
      locusRunner.decided().then(outcome => { if (outcome !== "discarded") accept(); }).catch(() => {});
    } else {
      accept();
    }
  };
  const conservationPromise = timeTask("conservationData", locusRunner.run(locus => {
    const attempt = ++conservationAttempts;
    return fetchConservationDataProgressive({
      gene,
      variant,
      pos,
      uniprotId,
      assembly,
      pdbMappingPromise,
      predictorPromise: locus,
      genosPromise,
      biohubToken,
      hfToken,
      gpnApiUrl,
      alphagenomeApiKey,
      alphagenomeApiUrl,
      spliceaiDistance,
      sequence,
      onPartial: snapshot => onConservationSnapshot(attempt, snapshot)
    });
  }).then(withoutUnboundAou).catch(err => {
    console.warn("[Conservation Parallel Run Warning] Failed to fetch conservation:", err);
    conservationHasError = true;
    return null;
  }));

  let disruptionHasError = false;
  let disruptionNotAssessed = false;
  const disruptionPromise = timeTask("disruptionPredictor", pdbMappingPromise.then(async (pdbMap) => {
    try {
      let wtPdbText: string | null = null;
      let chainId: string | undefined;
      let structureSource: "alphafold" | "experimental" = "alphafold";
      if (pdbMap && pdbMap.pdbId) {
        structureSource = "experimental";
        wtPdbText = await fetchPdbFromRcsb(
          pdbMap.pdbId,
          pdbMap.chainId,
          pdbMap.unpStart,
          pdbMap.structStart,
          { uniprotId, sequence, pos, expectedWt1: wt1Letter }
        );
        chainId = pdbMap.chainId;
      } else {
        wtPdbText = await fetchAlphafoldPdb(uniprotId);
        chainId = "A";
      }
      if (wtPdbText) {
        return predictStructuralDisruption(wtPdbText, wt1Letter, pos, mut1Letter, chainId, structureSource);
      }
    } catch (err) {
      console.warn("[Triage Parallel Run Warning] Failed to predict structural disruption:", err);
      disruptionHasError = true;
    }
    // Not assessed is not "low": no structure was read, so no disruption call can be made.
    disruptionNotAssessed = true;
    return {
      level: "unknown" as const,
      reason: disruptionHasError
        ? "Structural disruption was not assessed: the structure step failed."
        : "Structural disruption was not assessed: no structure could be resolved for this position.",
      plddt: null,
    };
  }));

  /**
   * Races through the disposable scope, not through a shared `Promise.race([task, timer])` pair.
   *
   * The budget's timer is cleared the instant its own source settles, and a source that settles
   * AFTER its budget has already answered is absorbed rather than left to reject into the timer's
   * context — see `timeout-scope.ts`. Both properties are per source here, which is what makes the
   * timings above (and the statuses below) real per source rather than an artefact of whichever
   * promise happened to be armed first.
   */
  const fastClinvarPromise = budgets.race(clinvarPromise, CORE_BUDGET_MS);
  const fastPredictorPromise = budgets.race(predictorPromise, CORE_BUDGET_MS);
  const fastStringPromise = budgets.race(stringPromise, CORE_BUDGET_MS);
  const fastDisruptionPromise = budgets.race(disruptionPromise, CORE_BUDGET_MS);
  const fastEsm2TriagePromise = budgets.race(esm2Promise, DEEP_MODEL_BUDGET_MS);
  const fastConservationPromise = budgets.race(conservationPromise, CORE_BUDGET_MS);
  const fastGnomadFrequencyPromise = budgets.race(gnomadFrequencyPromise, CORE_BUDGET_MS);
  const fastGnomadConstraintPromise = budgets.race(gnomadConstraintPromise, CORE_BUDGET_MS);
  const fastUniprotFeaturesPromise = budgets.race(uniprotFeaturesPromise, CORE_BUDGET_MS);
  const fastLocalFreqsPromise = budgets.race(localFreqsPromise, CORE_BUDGET_MS);
  const fastPdbMappingPromise = budgets.race(pdbMappingPromise, CORE_BUDGET_MS);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * PROGRESSIVE EMISSION — one chunk per settled source, not one chunk per stage
   * ─────────────────────────────────────────────────────────────────────────────
   * Previously this function returned only when ALL eleven sources had settled, so the streaming
   * route could not write anything between "ClinVar + predictors" and "everything". The stream the
   * reader actually waited on was therefore gated by the SLOWEST source (STRONG-cased against a
   * 45 s race), while the client gave up after 30 s of silence — a healthy run reported as a
   * stalled stream. Measured: 0 chunks in 31 s of a run the server considered alive.
   *
   * The status for each source is derived HERE, once, by the same function the final assembly uses
   * below, so a partial cannot describe a source differently from the payload that supersedes it.
   */
  const statusRules = {
    /**
     * A forwarded triage verdict OUTRANKS the local error flags.
     *
     * The triage catches the provider's own failure and resolves `{data:null,status}`, so on the
     * stream path `clinvarHasError` is unreachable and a null value would be derived as `not_found`
     * — an outage reported as a measured absence, which `clinvarPresence` then narrates as "ClinVar
     * holds no submission for this variant". The triage already knows the difference; it says so.
     *
     * Absent (the non-streaming route), the derivation is unchanged and the local flags apply.
     */
    clinvar: (raw: unknown): ServiceFetchStatus =>
      prefetched?.clinvarStatus ??
      (raw === TIMEOUT_FLAG ? "timeout"
        : clinvarHasError ? "error"
        : !raw || (raw as ClinVarData).classification === "Not found in ClinVar" ? "not_found"
        : "ok"),
    predictorData: (raw: unknown): ServiceFetchStatus =>
      prefetched?.predictorStatus ??
      (raw === TIMEOUT_FLAG ? "timeout"
        : predictorHasError ? "error"
        : !raw || (!(raw as PredictorData).amPathogenicity && !(raw as PredictorData).caddPhred) ? "not_found"
        : "ok"),
    conservationData: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout"
        : conservationHasError ? "error"
        : !raw || ((raw as ConservationData).revel === null && (raw as ConservationData).gerp === null && (raw as ConservationData).phylop === null) ? "not_found"
        : "ok",
    stringInteractions: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout"
        : stringHasError ? "error"
        : !raw || (raw as StringInteraction[]).length === 0 ? "not_found"
        : "ok",
    disruptionPredictor: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout" : disruptionHasError ? "error" : disruptionNotAssessed ? "not_found" : "ok",
    esm2: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout" : esm2HasError ? "error" : raw ? "ok" : "not_found",
    pdbMapping: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout" : pdbHasError ? "error" : raw ? "ok" : "not_found",
    gnomadConstraint: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout"
        : gnomadConstraintHasError ? "error"
        : raw !== null && raw !== undefined ? "ok"
        : "not_found",
    gnomadFrequency: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout"
        : gnomadFreqHasError ? "error"
        : gnomadFreqBuildRefused ? "unsupported-build"
        : raw ? "ok"
        : "not_found",
    uniprotFeatures: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout" : uniprotFeaturesHasError ? "error" : raw ? "ok" : "not_found"
  } satisfies Record<keyof ServiceStatusMap, (raw: unknown) => ServiceFetchStatus>;

  const partialData: Record<string, unknown> = {};
  /**
   * Seeded COMPLETE, not empty.
   *
   * An empty map means every source that has not answered is simply ABSENT from the preview, and
   * absent is indistinguishable from "measured, and empty" at every consumer: a gnomAD lookup still
   * in flight was rendered as a confirmed rarity (PM2 ceiling) rather than as "still running". The
   * map therefore starts as ten `pending` markers and each settled source replaces its own.
   */
  const partialStatus: RunningServiceStatus = SERVICE_STATUS_KEYS.reduce((acc, key) => {
    acc[key] = "pending";
    return acc;
  }, {} as RunningServiceStatus);

  /**
   * All-null AoU counts mean "not measured", and the final payload says so by nulling the object.
   * The preview applies the SAME rule, or the two would disagree about a field the reader sees.
   */
  const normalizeAouFrequency = (value: any): any => {
    if (!value) return null;
    const allNull = value.aouAC == null && value.aouAN == null && value.aouHet == null && value.aouHom == null;
    return allNull ? null : value;
  };

  /**
   * The ACMG verdict as of RIGHT NOW — recomputed on every settled source.
   *
   * Progressive recomputation, not a second opinion: it uses the same engine, the same accumulated
   * evidence and the SAME running status map the preview carries, so a preview's verdict cannot
   * contradict the payload that supersedes it any more than its statuses can.
   *
   * It is safe to run with sources still `pending` — and the safety is the engine's, not this
   * function's: every criterion that could read a missing value as a measurement is gated on the
   * status (`gnomadFrequency === "not_found"` is what awards PM2 from a confirmed absence;
   * `timeout`/`error`/`unsupported-build` WITHDRAW the criterion instead), so a source still in
   * flight withholds its criterion rather than inventing one. That is why a preliminary verdict may
   * strengthen or weaken as the run proceeds, and why the final frame remains the authority.
   */
  const progressiveInsights = (runningStatus: RunningServiceStatus): RuleBasedInsights | null => {
    try {
      return computeRuleBasedACMG({
        gene,
        variant,
        residueIndex: context.residueIndex ? parseInt(context.residueIndex, 10) : null,
        clinvar: (partialData.clinvar as ClinVarData | null) ?? null,
        predictorData: (partialData.predictorData as PredictorData | null) ?? null,
        /**
         * Only a SETTLED composite. A streamed snapshot is missing the models still running, and the
         * engine reads the in-silico ensemble without a status gate: a REVEL-only snapshot would
         * be counted as the whole ensemble's vote.
         */
        conservationData: runningStatus.conservationData === "pending"
          ? null
          : (partialData.conservationData as ConservationData | null) ?? null,
        gnomadConstraint: (partialData.gnomadConstraint as GnomadGeneConstraint | null) ?? null,
        gnomadFrequency: (partialData.gnomadFrequency as GnomadVariantFrequency | null) ?? null,
        acmgWeighting,
        esm2: (partialData.esm2 as { llr: number | null; verdict: string } | null) ?? null,
        uniprotFeatures: (partialData.uniprotFeatures as UniprotFeaturesResult | null) ?? null,
        sequence,
        serviceStatus: runningStatus
      });
    } catch (err: any) {
      // A preview is advisory: a failure here must not abort a run whose evidence is still arriving.
      console.warn("[Progressive ACMG Warning] Could not recompute the running verdict:", err?.message ?? err);
      return null;
    }
  };

  const emitPartial = () => {
    if (!onPartial) return;
    const runningStatus = { ...partialStatus };
    const runningTimings = { ...serviceTimings };
    const runningOffsets = { ...serviceTimingOffsets };
    onPartial({
      data: {
        ...partialData,
        // Mirror into `metadata`, which is where several surfaces read status/timings from. The
        // client merges `metadata` key-by-key, so the placeholder's gene/variant/residue fields
        // survive a partial.
        metadata: {
          ...((partialData.metadata as Record<string, unknown>) || {}),
          serviceStatus: runningStatus,
          serviceTimings: runningTimings,
          serviceTimingOffsets: runningOffsets
        },
        serviceStatus: runningStatus,
        serviceTimings: runningTimings,
        serviceTimingOffsets: runningOffsets
      },
      serviceStatus: runningStatus,
      serviceTimings: runningTimings,
      serviceTimingOffsets: runningOffsets
    });
  };

  /**
   * Records settled fields and announces them. Every chain below is attached to a promise that
   * cannot reject (each producer catches and returns a null/[] fallback), but `.catch(() => {})` is
   * kept so a future change to a producer cannot turn a progress notification into an unhandled
   * rejection inside the request that is still trying to answer.
   */
  const publish = (
    fields: Record<string, unknown>,
    statuses: Partial<Record<keyof ServiceStatusMap, ServiceFetchStatus | "pending">>
  ) => {
    Object.assign(partialData, fields);
    Object.assign(partialStatus, statuses);
    // The verdict travels with the preview that supersedes the previous one, computed from exactly
    // the evidence and statuses that preview carries.
    partialData.ruleBasedInsights = progressiveInsights({ ...partialStatus });
    emitPartial();
  };

  /** Value of a raced source, or `null` when its budget expired. */
  const settled = <T>(raw: unknown): T | null => (raw === TIMEOUT_FLAG ? null : (raw as T));

  /**
   * Hand the run's two fast sources to the singleflight layer, SYNCHRONOUSLY and before the first
   * await, so a route that joins this run can build its first frame from them.
   *
   * These are the RACED promises, paired with the status the same `statusRules` above will report in
   * the final payload — so a joiner's chunk 1 cannot describe ClinVar differently from the payload
   * that supersedes it, and a source that never answers is a bounded `timeout` rather than a hang.
   * The raw sentinel is not exposed: it is converted here, once.
   */
  onFastTriage?.({
    clinvar: fastClinvarPromise.then(raw => ({ data: settled<ClinVarData>(raw), status: statusRules.clinvar(raw) })),
    predictorData: fastPredictorPromise.then(raw => ({ data: settled<PredictorData>(raw), status: statusRules.predictorData(raw) }))
  });

  fastClinvarPromise
    .then(raw => publish({ clinvar: settled<ClinVarData>(raw) }, { clinvar: statusRules.clinvar(raw) }))
    .catch(() => {});

  fastPredictorPromise
    .then(raw => publish({ predictorData: settled<PredictorData>(raw) }, { predictorData: statusRules.predictorData(raw) }))
    .catch(() => {});

  fastPdbMappingPromise
    .then(raw => {
      const map = settled<PdbBestStructureMapping>(raw);
      publish(
        {
          metadata: {
            pdbId: map?.pdbId ? map.pdbId.toUpperCase() : null,
            pdbSource: map?.pdbId ? PDB_SOURCE_RCSB : PDB_SOURCE_ALPHAFOLD
          }
        },
        { pdbMapping: statusRules.pdbMapping(raw) }
      );
    })
    .catch(() => {});

  fastStringPromise
    .then(raw => {
      const list = settled<StringInteraction[]>(raw);
      publish({ stringInteractions: list ?? [] }, { stringInteractions: statusRules.stringInteractions(raw) });
    })
    .catch(() => {});

  fastEsm2TriagePromise
    .then(raw => publish({ esm2: settled(raw) }, { esm2: statusRules.esm2(raw) }))
    .catch(() => {});

  /**
   * A composite whose budget expired keeps every model that answered, each still labelled with its
   * own state, and the models that did not answer are marked `timeout` rather than dropped silently.
   * Previously one slow model (an AlphaGenome or GPN-Star call) discarded REVEL, BayesDel and a
   * SpliceAI score already in hand.
   */
  const conservationValue = (raw: unknown): ConservationData | null =>
    raw === TIMEOUT_FLAG
      ? (conservationLatestSnapshot ? expireConservationSnapshot(conservationLatestSnapshot) : null)
      : (raw as ConservationData | null);

  fastConservationPromise
    .then(raw => {
      conservationSettled = true;
      publish({ conservationData: conservationValue(raw) }, { conservationData: statusRules.conservationData(raw) });
    })
    .catch(() => {});

  fastDisruptionPromise
    .then(raw => publish({ disruptionPredictor: settled(raw) }, { disruptionPredictor: statusRules.disruptionPredictor(raw) }))
    .catch(() => {});

  fastGnomadConstraintPromise
    .then(raw => publish({ gnomadConstraint: settled<GnomadGeneConstraint>(raw) }, { gnomadConstraint: statusRules.gnomadConstraint(raw) }))
    .catch(() => {});

  fastGnomadFrequencyPromise
    .then(raw => publish({ gnomadFrequency: settled<GnomadVariantFrequency>(raw) }, { gnomadFrequency: statusRules.gnomadFrequency(raw) }))
    .catch(() => {});

  fastUniprotFeaturesPromise
    .then(raw => publish({ uniprotFeatures: settled<UniprotFeaturesResult>(raw) }, { uniprotFeatures: statusRules.uniprotFeatures(raw) }))
    .catch(() => {});

  fastLocalFreqsPromise
    .then(raw => {
      // Not a status-bearing source: the local dbNSFP frequency feeds `aouFrequency` and the
      // gnomAD gate above, so only the derived field is published — through the same all-null
      // guard the final payload applies.
      const localFreqs = settled<any>(raw);
      const aou = normalizeAouFrequency(localFreqs?.aou);
      if (aou) publish({ aouFrequency: aou }, {});
    })
    .catch(() => {});

  clinvarPromise.catch(() => {});
  predictorPromise.catch(() => {});
  stringPromise.catch(() => {});
  disruptionPromise.catch(() => {});
  esm2Promise.catch(() => {});
  conservationPromise.catch(() => {});
  gnomadFrequencyPromise.catch(() => {});
  gnomadConstraintPromise.catch(() => {});
  uniprotFeaturesPromise.catch(() => {});
  localFreqsPromise.catch(() => {});
  pdbMappingPromise.catch(() => {});

  const [
    rawClinvar,
    rawConservation,
    rawString,
    rawGnomadFreq,
    rawDisruption,
    rawEsm2,
    rawPredictor,
    rawPdbMap,
    rawGnomadConstraint,
    rawUniprotFeatures,
    rawLocalFreqs
  ] = await Promise.all([
    fastClinvarPromise,
    fastConservationPromise,
    fastStringPromise,
    fastGnomadFrequencyPromise,
    fastDisruptionPromise,
    fastEsm2TriagePromise,
    fastPredictorPromise,
    fastPdbMappingPromise,
    fastGnomadConstraintPromise,
    fastUniprotFeaturesPromise,
    fastLocalFreqsPromise
  ]);

  /**
   * Every status below comes from `statusRules` — the SAME functions the progressive emissions
   * above use. Two independent derivations is exactly how one source ends up described as `pending`
   * on the wire and `ok` in the payload (or, worse, `not_found` in one place and `unsupported-build`
   * in the other, which an ACMG criterion reads as a measured absence).
   */
  const clinvarTimedOut = rawClinvar === TIMEOUT_FLAG;
  const clinvarRes = (clinvarTimedOut ? null : rawClinvar) as ClinVarData | null;
  const clinvarStatus: ServiceFetchStatus = statusRules.clinvar(rawClinvar);

  const predictorTimedOut = rawPredictor === TIMEOUT_FLAG;
  const predictorRes = (predictorTimedOut ? null : rawPredictor) as PredictorData | null;
  const predictorStatus: ServiceFetchStatus = statusRules.predictorData(rawPredictor);

  const conservationRes = conservationValue(rawConservation);
  const conservationStatus: ServiceFetchStatus = statusRules.conservationData(rawConservation);

  const stringTimedOut = rawString === TIMEOUT_FLAG;
  const stringRes = (stringTimedOut || !rawString ? [] : rawString) as StringInteraction[];
  const stringStatus: ServiceFetchStatus = statusRules.stringInteractions(rawString);

  const disruptionTimedOut = rawDisruption === TIMEOUT_FLAG;
  const disruptionRes = (disruptionTimedOut ? null : rawDisruption) as DisruptionPrediction | null;
  const disruptionStatus: ServiceFetchStatus = statusRules.disruptionPredictor(rawDisruption);

  const esm2TimedOut = rawEsm2 === TIMEOUT_FLAG;
  const esm2Res = (esm2TimedOut ? null : rawEsm2) as { llr: number | null; verdict: string } | null;
  const esm2Status: ServiceFetchStatus = statusRules.esm2(rawEsm2);

  const pdbMapTimedOut = rawPdbMap === TIMEOUT_FLAG;
  const pdbMapRes = (pdbMapTimedOut ? null : rawPdbMap) as PdbBestStructureMapping | null;
  const pdbMappingStatus: ServiceFetchStatus = statusRules.pdbMapping(rawPdbMap);

  const gnomadConstraintTimedOut = rawGnomadConstraint === TIMEOUT_FLAG;
  const gnomadConstraintRes = (gnomadConstraintTimedOut ? null : rawGnomadConstraint) as GnomadGeneConstraint | null;
  const gnomadConstraintStatus: ServiceFetchStatus = statusRules.gnomadConstraint(rawGnomadConstraint);

  const gnomadFreqTimedOut = rawGnomadFreq === TIMEOUT_FLAG;
  const gnomadFreqRes = (gnomadFreqTimedOut ? null : rawGnomadFreq) as GnomadVariantFrequency | null;
  const gnomadFreqStatus: ServiceFetchStatus = statusRules.gnomadFrequency(rawGnomadFreq);

  const uniprotFeaturesTimedOut = rawUniprotFeatures === TIMEOUT_FLAG;
  const uniprotFeaturesRes = (uniprotFeaturesTimedOut ? null : rawUniprotFeatures) as UniprotFeaturesResult | null;
  const uniprotFeaturesStatus: ServiceFetchStatus = statusRules.uniprotFeatures(rawUniprotFeatures);

  const localFreqsRes = (rawLocalFreqs === TIMEOUT_FLAG ? null : rawLocalFreqs) as any;

  let aouFrequency = null;
  if (localFreqsRes && localFreqsRes.aou) {
    aouFrequency = normalizeAouFrequency(localFreqsRes.aou);
  }
  const localAou = localFreqsRes?.aou ? normalizeAouFrequency(localFreqsRes.aou) : null;
  const aouLookup: AouLookup | null = localPopulationWithheld || localFreqsRes?.aouInvalidCounts || !verifiedPopulationCoordinate(predictorRes) ? null : {
    localTable: !localTableInstalled
      ? "not-installed"
      : rawLocalFreqs === TIMEOUT_FLAG
        ? "timed-out"
        : localTableFailed
          ? "failed"
          : localAou
            ? "found"
            : "absent",
    // No exact-allele remote AoU read occurred; this is not a population absence.
    remoteDbnsfp: "not-reported",
  };

  let resolvedPdbId: string | null = null;
  // "AlphaFold" is the default because it is what the structural models fall back to; the id
  // stays null until a PDB mapping resolves, which is why the UI's predicted case has no id.
  let resolvedPdbSource: PdbSource = PDB_SOURCE_ALPHAFOLD;
  if (pdbMapRes && pdbMapRes.pdbId) {
    resolvedPdbId = pdbMapRes.pdbId.toUpperCase();
    resolvedPdbSource = PDB_SOURCE_RCSB;
  }

  const serviceStatus: ServiceStatusMap = {
    clinvar: clinvarStatus,
    predictorData: predictorStatus,
    conservationData: conservationStatus,
    stringInteractions: stringStatus,
    disruptionPredictor: disruptionStatus,
    esm2: esm2Status,
    gnomadConstraint: gnomadConstraintStatus,
    gnomadFrequency: gnomadFreqStatus,
    uniprotFeatures: uniprotFeaturesStatus,
    pdbMapping: pdbMappingStatus
  };

  const ruleBasedInsights = computeRuleBasedACMG({
    gene,
    variant,
    residueIndex: context.residueIndex ? parseInt(context.residueIndex, 10) : null,
    clinvar: clinvarRes,
    predictorData: predictorRes,
    conservationData: conservationRes,
    gnomadConstraint: gnomadConstraintRes,
    gnomadFrequency: gnomadFreqRes,
    acmgWeighting,
    esm2: esm2Res,
    uniprotFeatures: uniprotFeaturesRes,
    sequence,
    serviceStatus
  });

  clearInterval(lagTimer);
  const totalMs = Math.round(performance.now() - overallStart);

  // Emit structured telemetry log
  console.log(JSON.stringify({
    event: "CORE_DATA_FETCH_COMPLETED",
    gene,
    variant,
    uniprotId,
    startedAt,
    totalMs,
    loopBlockedMs,
    /**
     * The local-MANE-locus speculation (speculative-locus.ts): "kept" / "discarded" when it was applied,
     * "would-keep" / "would-discard" in shadow mode (the default: recorded, not used), "none" when there
     * was no local locus to compare.
     */
    locusSpeculation: locusRunner.outcome(),
    timings: serviceTimings,
    /** When each source settled on this run's clock — the waterfall the durations cannot be rebuilt into. */
    timingOffsets: serviceTimingOffsets,
    statuses: serviceStatus
  }));

  // Trailing background handlers to heal persisted records when slow network queries settle
  genosPromise.then(async (genosRec) => {
    if (genosRec) {
      try {
        const db = AnalysisDatabase.getInstance();
        const existing = await db.getVariantAnalysisAsync(context.gene, context.variant, acmgWeighting);
        if (existing?.payload) {
          healCachedAnalysisIfPossible(existing.payload, context);
        }
      } catch (err: any) {
        console.warn(`[Self-Healing Background Genos Error] ${err.message}`);
      }
    }
  }).catch(() => {});

  clinvarPromise.then(async (cRes) => {
    if (cRes && cRes.classification !== "Not found in ClinVar") {
      try {
        const db = AnalysisDatabase.getInstance();
        const existing = await db.getVariantAnalysisAsync(context.gene, context.variant, acmgWeighting);
        if (existing?.payload) {
          healCachedAnalysisIfPossible(existing.payload, context);
        }
      } catch (err: any) {
        console.warn(`[Self-Healing Background ClinVar Error] ${err.message}`);
      }
    }
  }).catch(() => {});

  return {
    clinvar: clinvarRes,
    conservationData: conservationRes,
    stringInteractions: stringRes,
    gnomadFrequency: gnomadFreqRes,
    disruptionPredictor: disruptionRes,
    esm2: esm2Res,
    predictorData: predictorRes,
    pdbMapping: pdbMapRes,
    gnomadConstraint: gnomadConstraintRes,
    uniprotFeatures: uniprotFeaturesRes,
    ruleBasedInsights,
    aouFrequency,
    aouLookup,
    resolvedPdbId,
    resolvedPdbSource,
    serviceStatus,
    serviceTimings,
    serviceTimingOffsets
  };
}
