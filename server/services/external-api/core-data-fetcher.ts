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
import { fetchStringInteractions, type StringInteraction } from "./string.ts";
import {
  fetchGnomadGeneConstraint,
  fetchGnomadVariantFrequency,
  type GnomadVariantFrequency,
  type GnomadGeneConstraint
} from "./gnomad.ts";
import { fetchLocalPopulationFrequencies } from "../prediction/landscape.ts";
import { fetchUniprotFeatures, type UniprotFeaturesResult } from "./uniprot.ts";
import type { PredictorData, ConservationData } from "../../../src/shared/contracts.ts";
import {
  parseGenomicCoordinateString,
  predictorCoordinateFromContext,
  PDB_SOURCE_ALPHAFOLD,
  PDB_SOURCE_RCSB,
  type PdbSource
} from "../../../src/shared/contracts.ts";
import {
  CANONICAL_ASSEMBLY,
  sourceSupportsAssembly,
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
import { CONFIG } from "../../config.ts";

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
}

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
 * Executes parallel fetching of external databases and quick predictor pipelines with timeout racing.
 *
 * @param onPartial Called once per source, the moment that source settles. Optional: the
 *   non-streaming `/analyze-variant` route has no use for it.
 */
export async function fetchCoreVariantData(
  context: ParsedVariantContext,
  coreTimeoutMs: number = CONFIG.timeouts.coreAnalysisMs,
  prefetched?: {
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
  },
  onPartial?: CoreAnalysisPartialListener
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
    alphagenomeApiUrl
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
  const serviceTimings: Record<string, number> = {};

  const timeTask = <T>(key: string, task: Promise<T>): Promise<T> => {
    const t0 = performance.now();
    return task.finally(() => {
      serviceTimings[key] = Math.round(performance.now() - t0);
    });
  };

  const TIMEOUT_FLAG = Symbol("TIMEOUT_FLAG");
  const coreTimeout = new Promise(resolve => setTimeout(() => resolve(TIMEOUT_FLAG), coreTimeoutMs));
  const deepModelTimeout = new Promise(resolve => setTimeout(() => resolve(TIMEOUT_FLAG), 15000));

  let clinvarHasError = false;
  const clinvarPromise = timeTask("clinvar", (prefetched?.clinvarPromise || fetchClinVarData(gene, variant, originalNotation)).catch(err => {
    console.warn("[ClinVar Parallel Run Warning] Failed to fetch ClinVar data:", err);
    clinvarHasError = true;
    return null;
  }));

  let predictorHasError = false;
  const predictorPromise = timeTask("predictorData", (prefetched?.predictorPromise || fetchPredictorData(gene, variant, uniprotId, inputCoordinate)).catch(err => {
    console.warn("[Predictor Parallel Run Warning] Failed to fetch predictor data:", err);
    predictorHasError = true;
    return null;
  }));

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

  let gnomadConstraintHasError = false;
  const gnomadConstraintPromise = timeTask("gnomadConstraint", fetchGnomadGeneConstraint(gene, pos).catch(err => {
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

  const localFreqsPromise = timeTask("localFreqs", (isLocalDbnsfpAvailable() && pos !== null)
    ? fetchLocalPopulationFrequencies(gene, pos, variant).catch((err: any) => {
        console.warn("[Local dbNSFP Freq Warning] Error querying local frequencies:", err);
        return null;
      })
    : Promise.resolve(null));

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
    if (localFreqs && localFreqs.gnomad) return localFreqs.gnomad;
    return predictorPromise.then(pred => {
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
      const coordinateAssembly = pred?.gnomadVariantAssembly ?? null;
      if (!coordinateAssembly || !sourceSupportsAssembly("gnomad-variants", coordinateAssembly)) {
        gnomadFreqBuildRefused = true;
        return null;
      }
      return fetchGnomadVariantFrequency(pred?.gnomadVariantId || null, { assembly: coordinateAssembly });
    });
  }).catch(err => {
    console.warn("[Gnomad Frequency Warning] Error querying variant frequency:", err);
    gnomadFreqHasError = true;
    return null;
  }));

  let conservationHasError = false;
  const conservationPromise = timeTask("conservationData", fetchConservationDataProgressive({
    gene,
    variant,
    pos,
    uniprotId,
    assembly,
    pdbMappingPromise,
    predictorPromise,
    genosPromise,
    biohubToken,
    hfToken,
    gpnApiUrl,
    alphagenomeApiKey,
    alphagenomeApiUrl,
    sequence
  }).catch(err => {
    console.warn("[Conservation Parallel Run Warning] Failed to fetch conservation:", err);
    conservationHasError = true;
    return null;
  }));

  let disruptionHasError = false;
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
    return { level: "low" as const, reason: "Fallback: PDB structure mapping not resolved", plddt: null };
  }));

  const fastClinvarPromise = Promise.race([clinvarPromise, coreTimeout]);
  const fastPredictorPromise = Promise.race([predictorPromise, coreTimeout]);
  const fastStringPromise = Promise.race([stringPromise, coreTimeout]);
  const fastDisruptionPromise = Promise.race([disruptionPromise, coreTimeout]);
  const fastEsm2TriagePromise = Promise.race([esm2Promise, deepModelTimeout]);
  const fastConservationPromise = Promise.race([conservationPromise, coreTimeout]);
  const fastGnomadFrequencyPromise = Promise.race([gnomadFrequencyPromise, coreTimeout]);
  const fastGnomadConstraintPromise = Promise.race([gnomadConstraintPromise, coreTimeout]);
  const fastUniprotFeaturesPromise = Promise.race([uniprotFeaturesPromise, coreTimeout]);
  const fastLocalFreqsPromise = Promise.race([localFreqsPromise, coreTimeout]);
  const fastPdbMappingPromise = Promise.race([pdbMappingPromise, coreTimeout]);

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
      raw === TIMEOUT_FLAG ? "timeout" : disruptionHasError ? "error" : "ok",
    esm2: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout" : esm2HasError ? "error" : raw ? "ok" : "not_found",
    pdbMapping: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout" : pdbHasError ? "error" : raw ? "ok" : "not_found",
    gnomadConstraint: (raw: unknown): ServiceFetchStatus =>
      raw === TIMEOUT_FLAG ? "timeout"
        : gnomadConstraintHasError ? "error"
        : (raw as GnomadGeneConstraint | null)?.missense_z !== null && raw !== null ? "ok"
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
    const allNull = value.aouAC === null && value.aouAN === null && value.aouHet === null && value.aouHom === null;
    return allNull ? null : value;
  };

  const emitPartial = () => {
    if (!onPartial) return;
    const runningStatus = { ...partialStatus };
    const runningTimings = { ...serviceTimings };
    onPartial({
      data: {
        ...partialData,
        // Mirror into `metadata`, which is where several surfaces read status/timings from. The
        // client merges `metadata` key-by-key, so the placeholder's gene/variant/residue fields
        // survive a partial.
        metadata: {
          ...((partialData.metadata as Record<string, unknown>) || {}),
          serviceStatus: runningStatus,
          serviceTimings: runningTimings
        },
        serviceStatus: runningStatus,
        serviceTimings: runningTimings
      },
      serviceStatus: runningStatus,
      serviceTimings: runningTimings
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
    emitPartial();
  };

  /** Value of a raced source, or `null` when its budget expired. */
  const settled = <T>(raw: unknown): T | null => (raw === TIMEOUT_FLAG ? null : (raw as T));

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

  fastConservationPromise
    .then(raw => publish({ conservationData: settled<ConservationData>(raw) }, { conservationData: statusRules.conservationData(raw) }))
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

  const conservationTimedOut = rawConservation === TIMEOUT_FLAG;
  const conservationRes = (conservationTimedOut ? null : rawConservation) as ConservationData | null;
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
  } else if (conservationRes?.aouFrequency) {
    aouFrequency = normalizeAouFrequency(conservationRes.aouFrequency);
  }

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

  const totalMs = Math.round(performance.now() - overallStart);

  // Emit structured telemetry log
  console.log(JSON.stringify({
    event: "CORE_DATA_FETCH_COMPLETED",
    gene,
    variant,
    uniprotId,
    totalMs,
    timings: serviceTimings,
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
    resolvedPdbId,
    resolvedPdbSource,
    serviceStatus,
    serviceTimings
  };
}
