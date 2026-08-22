import {
  fetchClinVarData,
  fetchAlphafoldPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  fetchPredictorData,
  fetchConservationData,
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
import { fetchEsm3StructureEval, type ESM3StructureEvalResult } from "./esm3_forge.ts";
import { predictStructuralDisruption, runEsm2Eval, type DisruptionPrediction } from "./biophysics.ts";
import { computeRuleBasedACMG, type RuleBasedInsights } from "./acmg.ts";
import { runEsmcAnalysis, type EsmcEvalResult } from "./esmc.ts";
import { runEsm2Analysis } from "./esm2.ts";
import { runSaprotAnalysis, type SaprotEvalResult } from "./saprot.ts";
import { generateAltVariants } from "../routes/shared.ts";
import type { ParsedVariantContext } from "../routes/variant/variant-parser.ts";
import { AnalysisDatabase } from "./analysis-db.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter } from "./http-client.ts";

export type ServiceFetchStatus = "ok" | "not_found" | "timeout" | "error";

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

/**
 * Self-healing on read: Checks if cached analysis has timed-out fields or missing SpliceAI
 * that have since settled into the SQLite external_cache, heals them, and updates variant_analyses.
 */
export function healCachedAnalysisIfPossible(
  payload: any,
  context: ParsedVariantContext
): any {
  if (!payload) return payload;
  const status = payload.serviceStatus || {};
  const hasTimeouts = Object.values(status).includes("timeout");
  const missingSplice = !payload.conservationData?.spliceai;

  if (!hasTimeouts && !missingSplice) {
    return payload;
  }

  const db = AnalysisDatabase.getInstance();
  const normGene = normalizeGeneSymbol(context.gene);
  const cleanVar = normalizeVariantTo3Letter(context.variant);
  const gnomadVarId = payload.predictorData?.gnomadVariantId || "";
  const genosCache = db.getExternalCache<any>(`genos_${normGene}_${cleanVar}_${gnomadVarId}`);
  const clinvarCache = db.getExternalCache<ClinVarData>(`clinvar_${normGene}_${cleanVar}_${context.originalNotation || ""}`);

  let didHeal = false;

  if (genosCache?.data) {
    const g = genosCache.data;
    payload.conservationData = {
      ...payload.conservationData,
      revel: g.revel ?? payload.conservationData?.revel ?? null,
      gerp: g.gerp ?? payload.conservationData?.gerp ?? null,
      phylop: g.phylop ?? payload.conservationData?.phylop ?? null,
      bayesdel: g.bayesdel ?? payload.conservationData?.bayesdel ?? null,
      metarnn: g.metarnn ?? payload.conservationData?.metarnn ?? null,
      clinpred: g.clinpred ?? payload.conservationData?.clinpred ?? null,
      eigenPhred: g.eigenPhred ?? payload.conservationData?.eigenPhred ?? null,
      dann: g.dann ?? payload.conservationData?.dann ?? null,
      esm1b: g.esm1b ?? payload.conservationData?.esm1b ?? null,
      popeve: g.popeve ?? payload.conservationData?.popeve ?? null,
      spliceai: g.spliceai ?? payload.conservationData?.spliceai ?? null,
      dbscsnv: g.dbscsnv ?? payload.conservationData?.dbscsnv ?? null,
      aouFrequency: (g.aou_ac !== null && g.aou_ac !== undefined) ? {
        aouAC: g.aou_ac,
        aouAN: g.aou_an ?? null,
        aouHet: g.aou_het ?? null,
        aouHom: g.aou_hom ?? null
      } : payload.conservationData?.aouFrequency ?? null
    };
    if (payload.serviceStatus) payload.serviceStatus.conservationData = "ok";
    didHeal = true;
  }

  if (clinvarCache?.data && status.clinvar === "timeout") {
    payload.clinvar = clinvarCache.data;
    if (payload.serviceStatus) payload.serviceStatus.clinvar = "ok";
    didHeal = true;
  }

  if (didHeal) {
    if (payload.metadata?.serviceStatus) {
      payload.metadata.serviceStatus = payload.serviceStatus;
    }
    const updatedInsights = computeRuleBasedACMG({
      gene: context.gene,
      variant: context.variant,
      clinvar: payload.clinvar,
      predictorData: payload.predictorData,
      conservationData: payload.conservationData,
      gnomadConstraint: payload.gnomadConstraint,
      gnomadFrequency: payload.gnomadFrequency,
      acmgWeighting: context.acmgWeighting,
      esm2: payload.esm2,
      uniprotFeatures: payload.uniprotFeatures,
      sequence: context.sequence,
      serviceStatus: payload.serviceStatus
    });
    payload.ruleBasedInsights = updatedInsights;

    try {
      db.saveVariantAnalysis({
        gene: context.gene,
        variant: context.variant,
        uniprotId: context.uniprotId,
        pos: context.pos,
        wildType: context.wildType,
        mutant: context.mutant,
        acmgWeighting: context.acmgWeighting,
        acmgVerdict: updatedInsights?.acmgVerdict || null,
        payload,
        modelVersions: { esm2: "esm2_t12_35M", version: "1.0.0" }
      });
      console.log(`[Self-Healing] Successfully healed and re-saved analysis for ${normGene} ${cleanVar}`);
    } catch (err: any) {
      console.warn(`[Self-Healing Warning] Failed to persist healed analysis: ${err.message}`);
    }
  }

  return payload;
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
  resolvedPdbId: string | null;
  resolvedPdbSource: "RCSB PDB" | "AlphaFold";
  ruleBasedInsights: RuleBasedInsights | null;
  serviceStatus: ServiceStatusMap;
}

export interface StructuralAnalysisData {
  esm3Eval: ESM3StructureEvalResult | { error: string } | null;
  esmcEval: EsmcEvalResult | null;
  esm2Eval: EsmcEvalResult | null;
  saprotEval: SaprotEvalResult | null;
  pdbMapping: PdbBestStructureMapping | null;
}

/**
 * Executes parallel fetching of external databases and quick predictor pipelines with timeout racing.
 */
export async function fetchCoreVariantData(
  context: ParsedVariantContext,
  coreTimeoutMs: number = 45000,
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
    mut1Letter
  } = context;

  const TIMEOUT_FLAG = Symbol("TIMEOUT_FLAG");
  const coreTimeout = new Promise(resolve => setTimeout(() => resolve(TIMEOUT_FLAG), coreTimeoutMs));
  const deepModelTimeout = new Promise(resolve => setTimeout(() => resolve(TIMEOUT_FLAG), 15000));

  let clinvarHasError = false;
  const clinvarPromise = (prefetched?.clinvarPromise || fetchClinVarData(gene, variant, originalNotation)).catch(err => {
    console.warn("[ClinVar Parallel Run Warning] Failed to fetch ClinVar data:", err);
    clinvarHasError = true;
    return null;
  });

  let predictorHasError = false;
  const predictorPromise = (prefetched?.predictorPromise || fetchPredictorData(gene, variant, uniprotId)).catch(err => {
    console.warn("[Predictor Parallel Run Warning] Failed to fetch predictor data:", err);
    predictorHasError = true;
    return null;
  });

  let pdbHasError = false;
  const pdbMappingPromise = fetchBestPdbStructure(uniprotId, pos).catch(err => {
    console.warn("[PDB Selection Error] Failed to query best PDB structure:", err);
    pdbHasError = true;
    return null;
  });

  let stringHasError = false;
  const stringPromise = fetchStringInteractions(gene).catch(err => {
    console.warn("[STRING Parallel Run Warning] Failed to fetch STRING network:", err);
    stringHasError = true;
    return [];
  });

  let esm2HasError = false;
  const esm2Promise = runEsm2Eval(sequence, pos, wt1Letter, mut1Letter).catch(err => {
    console.warn("[ESM2 Parallel Run Warning] Failed to run ESM2 evaluation:", err);
    esm2HasError = true;
    return null;
  });

  const genosPromise = queryGenosWebservice(gene, variant).catch(err => {
    console.warn("[Genos Web Query Warning] Failed to run Genos web query:", err);
    return null;
  });

  let gnomadConstraintHasError = false;
  const gnomadConstraintPromise = fetchGnomadGeneConstraint(gene, pos).catch(err => {
    console.warn("[Gnomad Constraint Warning] Failed to fetch gnomad gene constraint:", err);
    gnomadConstraintHasError = true;
    return null;
  });

  let uniprotFeaturesHasError = false;
  const uniprotFeaturesPromise = fetchUniprotFeatures(uniprotId).catch(err => {
    console.warn("[UniProt Features Warning] Failed to fetch uniprot features:", err);
    uniprotFeaturesHasError = true;
    return null;
  });

  const localFreqsPromise = (isLocalDbnsfpAvailable() && pos !== null)
    ? fetchLocalPopulationFrequencies(gene, pos, variant).catch(err => {
        console.warn("[Local dbNSFP Freq Warning] Error querying local frequencies:", err);
        return null;
      })
    : Promise.resolve(null);

  let gnomadFreqHasError = false;
  const gnomadFrequencyPromise = localFreqsPromise.then(localFreqs => {
    if (localFreqs && localFreqs.gnomad) return localFreqs.gnomad;
    return predictorPromise.then(pred => {
      return fetchGnomadVariantFrequency(pred?.gnomadVariantId || null);
    });
  }).catch(err => {
    console.warn("[Gnomad Frequency Warning] Error querying variant frequency:", err);
    gnomadFreqHasError = true;
    return null;
  });

  let conservationHasError = false;
  const conservationPromise = Promise.all([
    Promise.race([pdbMappingPromise, new Promise(r => setTimeout(() => r(null), 3000))]),
    Promise.race([predictorPromise, new Promise(r => setTimeout(() => r(null), 3000))]),
    Promise.race([genosPromise, new Promise(r => setTimeout(() => r(null), 3000))])
  ]).then(([pdbMap, pred, genosRec]: any[]) => {
    let genomicPos: number | null = null;
    if (pred?.gnomadVariantId) {
      const parts = pred.gnomadVariantId.split("-");
      if (parts.length >= 2) {
        const parsed = parseInt(parts[1], 10);
        if (!isNaN(parsed)) genomicPos = parsed;
      }
    }
    return fetchConservationData(
      gene,
      variant,
      pdbMap?.pdbId,
      pdbMap?.chainId,
      pos,
      pred?.gnomadVariantId || null,
      genosRec,
      uniprotId,
      pred?.transcriptId || null,
      genomicPos
    );
  }).catch(err => {
    console.warn("[Conservation Parallel Run Warning] Failed to fetch conservation:", err);
    conservationHasError = true;
    return null;
  });

  let disruptionHasError = false;
  const disruptionPromise = pdbMappingPromise.then(async (pdbMap) => {
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
  });

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

  // Trailing background handlers to heal persisted records when slow network queries settle
  genosPromise.then(async (genosRec) => {
    if (genosRec) {
      try {
        const db = AnalysisDatabase.getInstance();
        const normGene = normalizeGeneSymbol(gene);
        const cleanVar = normalizeVariantTo3Letter(variant);
        const existing = db.getVariantAnalysis(normGene, cleanVar, acmgWeighting);
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
        const normGene = normalizeGeneSymbol(gene);
        const cleanVar = normalizeVariantTo3Letter(variant);
        const existing = db.getVariantAnalysis(normGene, cleanVar, acmgWeighting);
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
    serviceStatus
  };
}

/**
 * Executes deep learning structural models (ESM3, ESMC, ESM-2 3B, SaProt) with timeout racing.
 */
export async function fetchStructuralModelData(
  context: ParsedVariantContext,
  biohubToken: string | null,
  hfToken: string | null,
  timeoutMs: number = 30000,
  prefetched?: {
    pdbMappingPromise?: Promise<PdbBestStructureMapping | null>;
    pdbMapping?: PdbBestStructureMapping | null;
  }
): Promise<StructuralAnalysisData> {
  const {
    gene,
    variant,
    uniprotId,
    sequence,
    pos,
    wt1Letter,
    mut1Letter
  } = context;

  const pdbMappingPromise = prefetched?.pdbMapping !== undefined
    ? Promise.resolve(prefetched.pdbMapping)
    : (prefetched?.pdbMappingPromise || fetchBestPdbStructure(uniprotId, pos).catch(err => {
        console.warn("[PDB Selection Error] Failed to query best PDB structure:", err);
        return null;
      }));

  const esm3EvalPromise = pdbMappingPromise.then(async (pdbMap) => {
    let pdbText: string | null = null;
    if (pdbMap && pdbMap.pdbId) {
      try {
        pdbText = await fetchPdbFromRcsb(
          pdbMap.pdbId,
          pdbMap.chainId,
          pdbMap.unpStart,
          pdbMap.structStart,
          { uniprotId, sequence, pos, expectedWt1: wt1Letter }
        );
      } catch (pdbFetchErr: any) {
        console.warn(`[ESM3 PDB Fetch] Failed to fetch PDB text for ${pdbMap.pdbId}:`, pdbFetchErr.message);
      }
    }
    try {
      return await fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, pdbText, biohubToken);
    } catch (err) {
      console.warn("[ESM3 Parallel Run Warning] Failed to run ESM3 structural evaluation:", err);
      return fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, null, biohubToken);
    }
  });

  const esmcEvalPromise = runEsmcAnalysis(
    gene,
    variant,
    uniprotId,
    sequence,
    biohubToken
  ).catch(err => {
    console.warn("[ESMC Parallel Run Warning] Failed to run ESMC analysis:", err);
    return null;
  });

  const esm2EvalPromise = runEsm2Analysis(
    gene,
    variant,
    uniprotId,
    sequence,
    hfToken
  ).catch(err => {
    console.warn("[ESM2 3B Parallel Run Warning] Failed to run ESM-2 3B analysis:", err);
    return null;
  });

  const saprotEvalPromise = pdbMappingPromise.then(async (pdbMap) => {
    let pdbText: string | null = null;
    if (pdbMap && pdbMap.pdbId) {
      try {
        pdbText = await fetchPdbFromRcsb(
          pdbMap.pdbId,
          pdbMap.chainId,
          pdbMap.unpStart,
          pdbMap.structStart,
          { uniprotId, sequence, pos, expectedWt1: wt1Letter }
        );
      } catch (pdbFetchErr: any) {
        console.warn(`[SaProt PDB Fetch] Failed to fetch PDB text for ${pdbMap.pdbId}:`, pdbFetchErr.message);
      }
    }
    if (!pdbText) {
      try {
        pdbText = await fetchAlphafoldPdb(uniprotId);
      } catch (afFetchErr: any) {
        console.warn(`[SaProt AF2 PDB Fetch] Failed to fetch AF2 PDB text for ${uniprotId}:`, afFetchErr.message);
      }
    }
    return runSaprotAnalysis(
      gene,
      variant,
      uniprotId,
      sequence,
      hfToken,
      pdbText
    );
  }).catch(err => {
    console.warn("[SaProt Parallel Run Warning] Failed to run SaProt analysis:", err);
    return null;
  });

  const deepModelTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs));
  const fastEsm3Promise = Promise.race([esm3EvalPromise, deepModelTimeout]);
  const fastEsmcPromise = Promise.race([esmcEvalPromise, deepModelTimeout]);
  const fastEsm2Promise = Promise.race([esm2EvalPromise, deepModelTimeout]);
  const fastSaprotPromise = Promise.race([saprotEvalPromise, deepModelTimeout]);

  const [esm3Eval, esmcEval, esm2Eval, saprotEval, pdbMapping] = await Promise.all([
    fastEsm3Promise,
    fastEsmcPromise,
    fastEsm2Promise,
    fastSaprotPromise,
    pdbMappingPromise
  ]);

  return {
    esm3Eval,
    esmcEval,
    esm2Eval,
    saprotEval,
    pdbMapping
  };
}

/**
 * High-level orchestration for /analyze-variant endpoint.
 */
export async function runCoreAnalysis(context: ParsedVariantContext) {
  const {
    gene,
    variant,
    uniprotId,
    residueIndex,
    wildType,
    mutant,
    acmgWeighting,
    sequence,
    pos,
    wt1Letter,
    mut1Letter
  } = context;

  // Check persistent SQLite database
  const db = AnalysisDatabase.getInstance();
  const cachedRecord = db.getVariantAnalysis(gene, variant, acmgWeighting);
  if (cachedRecord && cachedRecord.payload) {
    const healed = healCachedAnalysisIfPossible(cachedRecord.payload, context);
    return healed;
  }

  const coreData = await fetchCoreVariantData(context, 45000);

  let mutatedSequence: string | null = null;
  if (sequence && pos >= 1 && pos <= sequence.length && wt1Letter && mut1Letter) {
    mutatedSequence = sequence.substring(0, pos - 1) + mut1Letter + sequence.substring(pos);
  }

  const responsePayload = {
    analysis: null,
    insights: null,
    ruleBasedInsights: coreData.ruleBasedInsights,
    disclaimer: "This analysis is automatically generated by an artificial intelligence model for research purposes only. It does not constitute a clinical diagnosis or validated medical recommendation.",
    clinvar: coreData.clinvar,
    predictorData: coreData.predictorData,
    conservationData: coreData.conservationData,
    landscapeData: null,
    stringInteractions: coreData.stringInteractions,
    disruptionPredictor: coreData.disruptionPredictor,
    gnomadConstraint: coreData.gnomadConstraint ?? null,
    uniprotFeatures: coreData.uniprotFeatures ?? null,
    gnomadFrequency: coreData.gnomadFrequency ?? null,
    aouFrequency: coreData.aouFrequency ?? null,
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
      alternativeVariants: generateAltVariants(sequence),
      mutatedSequence,
      serviceStatus: coreData.serviceStatus
    },
    serviceStatus: coreData.serviceStatus,
    _internal: {
      pdbMapping: coreData.pdbMapping
    }
  };

  // Persist verified payload to SQLite database
  try {
    db.saveVariantAnalysis({
      gene,
      variant,
      uniprotId,
      pos,
      wildType,
      mutant,
      acmgWeighting,
      acmgVerdict: coreData.ruleBasedInsights?.acmgVerdict || null,
      payload: responsePayload,
      modelVersions: { esm2: "esm2_t12_35M", version: "1.0.0" }
    });
  } catch (err: any) {
    console.warn("[Analysis DB Warning] Failed to persist analysis:", err.message);
  }

  return responsePayload;
}

/**
 * Progressive streaming orchestration for /analyze-variant/stream endpoint.
 */
export async function streamCoreAnalysis(
  context: ParsedVariantContext,
  onChunk: (chunk: { chunkIndex: number; isFinal?: boolean; data: any }) => void,
  signal?: AbortSignal
) {
  if (signal?.aborted) return null;

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
  const cachedRecord = db.getVariantAnalysis(gene, variant, context.acmgWeighting);
  if (cachedRecord && cachedRecord.payload) {
    const healed = healCachedAnalysisIfPossible(cachedRecord.payload, context);
    onChunk({
      chunkIndex: 1,
      isFinal: true,
      data: healed
    });
    return healed;
  }

  // Fast triage: fetch ClinVar + Predictors immediately
  const fastClinvarPromise = fetchClinVarData(gene, variant, context.originalNotation).catch(() => null);
  const fastPredictorPromise = fetchPredictorData(gene, variant, uniprotId).catch(() => null);

  // Chunk 1: Instant Header, ClinVar, Predictors, Initial ACMG Verdict (~100-150ms)
  const [clinvarRes, predictorRes] = await Promise.all([fastClinvarPromise, fastPredictorPromise]);
  if (signal?.aborted) return null;

  let mutatedSequence: string | null = null;
  if (sequence && pos >= 1 && pos <= sequence.length && wt1Letter && mut1Letter) {
    mutatedSequence = sequence.substring(0, pos - 1) + mut1Letter + sequence.substring(pos);
  }

  const preliminaryVerdict = computeRuleBasedACMG(
    gene,
    variant,
    clinvarRes,
    predictorRes,
    null,
    null,
    null,
    context.acmgWeighting,
    null,
    null,
    sequence,
    null,
    null,
    null
  );

  const chunk1Data = {
    metadata: {
      gene,
      variant,
      uniprotId,
      residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
      wildType,
      mutant,
      mutatedSequence,
      serviceStatus: {
        clinvar: clinvarRes ? (clinvarRes.classification === "Not found in ClinVar" ? "not_found" : "ok") : "not_found",
        predictorData: predictorRes ? "ok" : "not_found"
      }
    },
    clinvar: clinvarRes,
    predictorData: predictorRes,
    ruleBasedInsights: preliminaryVerdict
  };

  onChunk({ chunkIndex: 1, isFinal: false, data: chunk1Data });
  if (signal?.aborted) return null;

  // Complete remaining background pipelines concurrently, reusing fast triage promises
  const fullCoreData = await fetchCoreVariantData(context, 45000, {
    clinvarPromise: fastClinvarPromise,
    predictorPromise: fastPredictorPromise
  });
  if (signal?.aborted) return null;

  const fullPayload = {
    analysis: null,
    insights: null,
    ruleBasedInsights: fullCoreData.ruleBasedInsights,
    disclaimer: "This analysis is automatically generated by an artificial intelligence model for research purposes only. It does not constitute a clinical diagnosis or validated medical recommendation.",
    clinvar: fullCoreData.clinvar,
    predictorData: fullCoreData.predictorData,
    conservationData: fullCoreData.conservationData,
    landscapeData: null,
    stringInteractions: fullCoreData.stringInteractions,
    disruptionPredictor: fullCoreData.disruptionPredictor,
    gnomadConstraint: fullCoreData.gnomadConstraint ?? null,
    uniprotFeatures: fullCoreData.uniprotFeatures ?? null,
    gnomadFrequency: fullCoreData.gnomadFrequency ?? null,
    aouFrequency: fullCoreData.aouFrequency ?? null,
    esm2: fullCoreData.esm2 ?? null,
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
      pdbId: fullCoreData.resolvedPdbId,
      pdbSource: fullCoreData.resolvedPdbSource,
      alternativeVariants: generateAltVariants(sequence),
      mutatedSequence,
      serviceStatus: fullCoreData.serviceStatus
    },
    serviceStatus: fullCoreData.serviceStatus,
    _internal: {
      pdbMapping: fullCoreData.pdbMapping
    }
  };

  onChunk({
    chunkIndex: 2,
    isFinal: true,
    data: fullPayload
  });

  try {
    db.saveVariantAnalysis({
      gene,
      variant,
      uniprotId,
      pos,
      wildType,
      mutant,
      acmgWeighting: context.acmgWeighting,
      acmgVerdict: fullCoreData.ruleBasedInsights?.acmgVerdict || null,
      payload: fullPayload,
      modelVersions: { esm2: "esm2_t12_35M", version: "1.0.0" }
    });
  } catch (err: any) {
    console.warn("[Analysis DB Warning] Failed to persist streamed analysis:", err.message);
  }

  return fullPayload;
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
  const cached = db.getVariantAnalysis(gene, variant, acmgWeighting);
  const cachedPdbMapping = cached?.payload?._internal?.pdbMapping || null;

  // Run deep models concurrently with core data fetching (or reuse existing)
  const [structuralData, coreData] = await Promise.all([
    fetchStructuralModelData(context, biohubToken, hfToken, 30000, { pdbMapping: cachedPdbMapping }),
    cached?.payload ? Promise.resolve(cached.payload) : fetchCoreVariantData(context, 10000)
  ]);

  const ruleBasedInsights = computeRuleBasedACMG(
    gene,
    variant,
    coreData.clinvar,
    coreData.predictorData,
    coreData.conservationData,
    coreData.gnomadConstraint,
    coreData.gnomadFrequency,
    acmgWeighting,
    coreData.esm2,
    coreData.uniprotFeatures,
    sequence,
    structuralData.esmcEval,
    structuralData.esm2Eval,
    structuralData.saprotEval
  );

  const updatedPayload = cached?.payload ? {
    ...cached.payload,
    esm3Eval: structuralData.esm3Eval,
    esmcEval: structuralData.esmcEval,
    esm2Eval: structuralData.esm2Eval,
    saprotEval: structuralData.saprotEval,
    ruleBasedInsights
  } : null;

  if (updatedPayload) {
    try {
      db.saveVariantAnalysis({
        gene,
        variant,
        uniprotId: context.uniprotId,
        pos: context.pos,
        wildType: context.wildType,
        mutant: context.mutant,
        acmgWeighting,
        acmgVerdict: ruleBasedInsights?.acmgVerdict || null,
        payload: updatedPayload,
        modelVersions: { esm2: "esm2_t12_35M", version: "1.0.0" }
      });
    } catch (err: any) {
      console.warn("[Analysis DB Warning] Failed to persist structural analysis payload:", err.message);
    }
  }

  return {
    esm3Eval: structuralData.esm3Eval,
    esmcEval: structuralData.esmcEval,
    esm2Eval: structuralData.esm2Eval,
    saprotEval: structuralData.saprotEval,
    ruleBasedInsights
  };
}
