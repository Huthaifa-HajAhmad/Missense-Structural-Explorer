import {
  fetchClinVarData,
  fetchAlphafoldPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  fetchPredictorData,
  fetchConservationData,
  fetchConservationDataProgressive,
  fetchStringInteractions,
  fetchGnomadGeneConstraint,
  fetchGnomadVariantFrequency,
  fetchUniprotFeatures,
  fetchLocalPopulationFrequencies,
  type PdbBestStructureMapping,
  type ClinVarData,
  type StringInteraction,
  type GnomadVariantFrequency,
  type GnomadGeneConstraint,
  type UniprotFeaturesResult
} from "./external.ts";
import type { PredictorData, ConservationData } from "../../src/shared/contracts.ts";
import { isLocalDbnsfpAvailable } from "./dbnsfp_local.ts";
import { queryGenosWebservice } from "./genos_web.ts";
import { predictStructuralDisruption, runEsm2Eval, type DisruptionPrediction } from "./biophysics.ts";
import { computeRuleBasedACMG, type RuleBasedInsights } from "./acmg.ts";
import type { ParsedVariantContext } from "../routes/variant/variant-parser.ts";
import { AnalysisDatabase } from "./analysis-db.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter } from "./http-client.ts";
import { healCachedAnalysisIfPossible } from "./self-healer.ts";
import type { ServiceFetchStatus, ServiceStatusMap, CoreAnalysisData } from "./payload-assembler.ts";
import { CONFIG } from "../config.ts";

export type { ServiceFetchStatus, ServiceStatusMap, CoreAnalysisData };

/**
 * Executes parallel fetching of external databases and quick predictor pipelines with timeout racing.
 */
export async function fetchCoreVariantData(
  context: ParsedVariantContext,
  coreTimeoutMs: number = CONFIG.timeouts.coreAnalysisMs,
  prefetched?: {
    clinvarPromise?: Promise<ClinVarData | null>;
    predictorPromise?: Promise<PredictorData | null>;
  }
): Promise<CoreAnalysisData> {
  const {
    gene,
    variant,
    uniprotId,
    originalNotation,
    acmgWeighting,
    sequence,
    pos,
    wt1Letter,
    mut1Letter,
    biohubToken,
    hfToken,
    nvidiaApiKey
  } = context;

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
  const predictorPromise = timeTask("predictorData", (prefetched?.predictorPromise || fetchPredictorData(gene, variant, uniprotId)).catch(err => {
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
    ? fetchLocalPopulationFrequencies(gene, pos, variant).catch(err => {
        console.warn("[Local dbNSFP Freq Warning] Error querying local frequencies:", err);
        return null;
      })
    : Promise.resolve(null));

  let gnomadFreqHasError = false;
  const gnomadFrequencyPromise = timeTask("gnomadFrequency", localFreqsPromise.then(localFreqs => {
    if (localFreqs && localFreqs.gnomad) return localFreqs.gnomad;
    return predictorPromise.then(pred => {
      return fetchGnomadVariantFrequency(pred?.gnomadVariantId || null);
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
    pdbMappingPromise,
    predictorPromise,
    genosPromise,
    biohubToken,
    nvidiaApiKey,
    hfToken,
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
      if (pdbMap && pdbMap.pdbId) {
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
        return predictStructuralDisruption(wtPdbText, wt1Letter, pos, mut1Letter, chainId);
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

  const clinvarTimedOut = rawClinvar === TIMEOUT_FLAG;
  const clinvarRes = (clinvarTimedOut ? null : rawClinvar) as ClinVarData | null;
  const clinvarStatus: ServiceFetchStatus = clinvarTimedOut
    ? "timeout"
    : clinvarHasError
    ? "error"
    : !clinvarRes || clinvarRes.classification === "Not found in ClinVar"
    ? "not_found"
    : "ok";

  const predictorTimedOut = rawPredictor === TIMEOUT_FLAG;
  const predictorRes = (predictorTimedOut ? null : rawPredictor) as PredictorData | null;
  const predictorStatus: ServiceFetchStatus = predictorTimedOut
    ? "timeout"
    : predictorHasError
    ? "error"
    : !predictorRes || (!predictorRes.amPathogenicity && !predictorRes.caddPhred)
    ? "not_found"
    : "ok";

  const conservationTimedOut = rawConservation === TIMEOUT_FLAG;
  const conservationRes = (conservationTimedOut ? null : rawConservation) as ConservationData | null;
  const conservationStatus: ServiceFetchStatus = conservationTimedOut
    ? "timeout"
    : conservationHasError
    ? "error"
    : !conservationRes || (conservationRes.revel === null && conservationRes.gerp === null && conservationRes.phylop === null)
    ? "not_found"
    : "ok";

  const stringTimedOut = rawString === TIMEOUT_FLAG;
  const stringRes = (stringTimedOut || !rawString ? [] : rawString) as StringInteraction[];
  const stringStatus: ServiceFetchStatus = stringTimedOut
    ? "timeout"
    : stringHasError
    ? "error"
    : stringRes.length === 0
    ? "not_found"
    : "ok";

  const disruptionTimedOut = rawDisruption === TIMEOUT_FLAG;
  const disruptionRes = (disruptionTimedOut ? null : rawDisruption) as DisruptionPrediction | null;
  const disruptionStatus: ServiceFetchStatus = disruptionTimedOut
    ? "timeout"
    : disruptionHasError
    ? "error"
    : "ok";

  const esm2TimedOut = rawEsm2 === TIMEOUT_FLAG;
  const esm2Res = (esm2TimedOut ? null : rawEsm2) as { llr: number | null; verdict: string } | null;
  const esm2Status: ServiceFetchStatus = esm2TimedOut
    ? "timeout"
    : esm2HasError
    ? "error"
    : esm2Res ? "ok" : "not_found";

  const pdbMapTimedOut = rawPdbMap === TIMEOUT_FLAG;
  const pdbMapRes = (pdbMapTimedOut ? null : rawPdbMap) as PdbBestStructureMapping | null;
  const pdbMappingStatus: ServiceFetchStatus = pdbMapTimedOut
    ? "timeout"
    : pdbHasError
    ? "error"
    : pdbMapRes ? "ok" : "not_found";

  const gnomadConstraintTimedOut = rawGnomadConstraint === TIMEOUT_FLAG;
  const gnomadConstraintRes = (gnomadConstraintTimedOut ? null : rawGnomadConstraint) as GnomadGeneConstraint | null;
  const gnomadConstraintStatus: ServiceFetchStatus = gnomadConstraintTimedOut
    ? "timeout"
    : gnomadConstraintHasError
    ? "error"
    : gnomadConstraintRes?.missense_z !== null && gnomadConstraintRes !== null ? "ok" : "not_found";

  const gnomadFreqTimedOut = rawGnomadFreq === TIMEOUT_FLAG;
  const gnomadFreqRes = (gnomadFreqTimedOut ? null : rawGnomadFreq) as GnomadVariantFrequency | null;
  const gnomadFreqStatus: ServiceFetchStatus = gnomadFreqTimedOut
    ? "timeout"
    : gnomadFreqHasError
    ? "error"
    : gnomadFreqRes ? "ok" : "not_found";

  const uniprotFeaturesTimedOut = rawUniprotFeatures === TIMEOUT_FLAG;
  const uniprotFeaturesRes = (uniprotFeaturesTimedOut ? null : rawUniprotFeatures) as UniprotFeaturesResult | null;
  const uniprotFeaturesStatus: ServiceFetchStatus = uniprotFeaturesTimedOut
    ? "timeout"
    : uniprotFeaturesHasError
    ? "error"
    : uniprotFeaturesRes ? "ok" : "not_found";

  const localFreqsRes = (rawLocalFreqs === TIMEOUT_FLAG ? null : rawLocalFreqs) as any;

  let aouFrequency = null;
  if (localFreqsRes && localFreqsRes.aou) {
    aouFrequency = localFreqsRes.aou;
  } else if (conservationRes?.aouFrequency) {
    aouFrequency = conservationRes.aouFrequency;
  }
  if (aouFrequency && aouFrequency.aouAC === null && aouFrequency.aouAN === null && aouFrequency.aouHet === null && aouFrequency.aouHom === null) {
    aouFrequency = null;
  }

  let resolvedPdbId: string | null = null;
  let resolvedPdbSource: "RCSB PDB" | "AlphaFold" = "AlphaFold";
  if (pdbMapRes && pdbMapRes.pdbId) {
    resolvedPdbId = pdbMapRes.pdbId.toUpperCase();
    resolvedPdbSource = "RCSB PDB";
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
