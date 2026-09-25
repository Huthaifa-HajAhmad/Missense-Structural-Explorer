import { fetchClinVarData } from "../external-api/clinvar.ts";
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
  buildMutatedSequence
} from "./payload-assembler.ts";
import { healCachedAnalysisIfPossible } from "./self-healer.ts";
import { fetchCoreVariantData } from "../external-api/core-data-fetcher.ts";
import { fetchStructuralModelData, type StructuralAnalysisData } from "../structure/structural-model-fetcher.ts";
import { parseGenomicCoordinateString } from "../../../src/shared/contracts.ts";
import { CANONICAL_ASSEMBLY } from "../../../src/shared/assembly.ts";
import { CONFIG } from "../../config.ts";

export type { ServiceFetchStatus, ServiceStatusMap, CoreAnalysisData, StructuralAnalysisData };
export {
  healCachedAnalysisIfPossible,
  fetchCoreVariantData,
  fetchStructuralModelData,
  assembleCoreResponsePayload,
  persistVariantAnalysisPayload,
  buildAnalysisPayload,
  persistAnalysis
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

function isStaleCachedPayload(payload: any, context?: ParsedVariantContext, recordUpdatedAt?: string | null): boolean {
  if (!payload) return true;
  const cons = payload.conservationData;
  if (cons && cons.available === true) {
    if (cons.dann === null || cons.bayesdel === null || cons.clinpred === null || cons.eigenPhred === null) {
      return true;
    }
    // Invalidate stale cache if Hugging Face token is provided but cached payload lacks GPN-Star
    const hasGpnToken = Boolean(context?.hfToken || process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY);
    if (hasGpnToken) {
      const gpnMissing = cons.gpnStar === null && (cons.gpnStarStatus === "token_required" || cons.gpnStarStatus === "unavailable" || !cons.gpnStarStatus);
      if (gpnMissing) return true;
    }
    // Invalidate stale cache if Biohub token is provided but cached payload lacks ESM3
    const hasBiohubToken = Boolean(context?.biohubToken || process.env.BIOHUB_API_TOKEN);
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
 * Orchestrates synchronous end-to-end execution of core variant analysis (/analyze-variant).
 */
export async function runCoreAnalysis(context: ParsedVariantContext): Promise<any> {
  const { gene, variant, acmgWeighting } = context;

  // Check persistent SQLite database
  const db = AnalysisDatabase.getInstance();
  const cachedRecord = await db.getVariantAnalysisAsync(gene, variant, acmgWeighting);
  if (cachedRecord && cachedRecord.payload && !isStaleCachedPayload(cachedRecord.payload, context, cachedRecord.updatedAt)) {
    return healCachedAnalysisIfPossible(cachedRecord.payload, context);
  }

  const coreData = await fetchCoreVariantData(context, CONFIG.timeouts.coreAnalysisMs);
  const responsePayload = assembleCoreResponsePayload(coreData, context);
  persistVariantAnalysisPayload(context, responsePayload, coreData.ruleBasedInsights?.acmgVerdict || null);

  return responsePayload;
}

/**
 * Progressive streaming orchestration for /analyze-variant/stream endpoint.
 */
export async function streamCoreAnalysis(
  context: ParsedVariantContext,
  onChunk: (chunk: { chunkIndex: number; isFinal?: boolean; data: any }) => void,
  signal?: AbortSignal
): Promise<any> {
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
  const cachedRecord = await db.getVariantAnalysisAsync(gene, variant, context.acmgWeighting);
  if (cachedRecord && cachedRecord.payload && !isStaleCachedPayload(cachedRecord.payload, context, cachedRecord.updatedAt)) {
    const healed = healCachedAnalysisIfPossible(cachedRecord.payload, context);
    onChunk({
      chunkIndex: 1,
      isFinal: true,
      data: healed
    });
    return healed;
  }

  // Fast triage: fetch ClinVar + Predictors immediately with fine-grained status tracking
  const fastClinvarPromise = (async () => {
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

  const fastPredictorPromise = (async () => {
    try {
      const parsedInputCoord = context.genomicCoordinates ? parseGenomicCoordinateString(context.genomicCoordinates) : null;
      const inputCoordinate = parsedInputCoord
        ? { ...parsedInputCoord, assembly: context.assembly ?? CANONICAL_ASSEMBLY }
        : null;
      const data = await fetchPredictorData(gene, variant, uniprotId, inputCoordinate);
      return { data, status: (data ? "ok" : "not_found") as ServiceFetchStatus };
    } catch (err: any) {
      const isTimeout = err?.name === "TimeoutError" || err?.message?.toLowerCase().includes("timeout");
      return { data: null, status: (isTimeout ? "timeout" : "error") as ServiceFetchStatus };
    }
  })();

  // Chunk 1: Instant Header, ClinVar, Predictors, Initial ACMG Verdict (~100-150ms)
  const [clinvarOutcome, predictorOutcome] = await Promise.all([fastClinvarPromise, fastPredictorPromise]);
  if (signal?.aborted) return null;

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
      serviceStatus: {
        clinvar: clinvarOutcome.status,
        predictorData: predictorOutcome.status
      }
    },
    clinvar: clinvarRes,
    predictorData: predictorRes,
    ruleBasedInsights: preliminaryVerdict
  };

  onChunk({ chunkIndex: 1, isFinal: false, data: chunk1Data });
  if (signal?.aborted) return null;

  // Complete remaining background pipelines concurrently, reusing fast triage promises
  const fullCoreData = await fetchCoreVariantData(context, CONFIG.timeouts.coreAnalysisMs, {
    clinvarPromise: fastClinvarPromise.then(r => r.data),
    predictorPromise: fastPredictorPromise.then(r => r.data)
  });
  if (signal?.aborted) return null;

  const fullPayload = assembleCoreResponsePayload(fullCoreData, context);

  onChunk({
    chunkIndex: 2,
    isFinal: true,
    data: fullPayload
  });

  persistVariantAnalysisPayload(context, fullPayload, fullCoreData.ruleBasedInsights?.acmgVerdict || null);

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
  const cached = await db.getVariantAnalysisAsync(gene, variant, acmgWeighting);
  const cachedPdbMapping = cached?.payload?._internal?.pdbMapping || null;

  // Run deep models concurrently with core data fetching (or reuse existing)
  const [structuralData, coreData] = await Promise.all([
    fetchStructuralModelData(context, biohubToken, hfToken, CONFIG.timeouts.structuralModelsMs, { pdbMapping: cachedPdbMapping }),
    cached?.payload ? Promise.resolve(cached.payload) : fetchCoreVariantData(context, CONFIG.timeouts.coreAnalysisMs)
  ]);

  const ruleBasedInsights = computeRuleBasedACMG({
    gene,
    variant,
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

  const basePayload = cached?.payload || assembleCoreResponsePayload(coreData, context);
  const mergedServiceStatus = {
    ...(basePayload.serviceStatus || coreData.serviceStatus || {}),
    ...(structuralData.serviceStatus || {})
  };

  const updatedPayload = {
    ...basePayload,
    esm3Eval: structuralData.esm3Eval,
    esmcEval: structuralData.esmcEval,
    esm2Eval: structuralData.esm2Eval,
    saprotEval: structuralData.saprotEval,
    serviceStatus: mergedServiceStatus,
    ruleBasedInsights
  };

  persistVariantAnalysisPayload(context, updatedPayload, ruleBasedInsights?.acmgVerdict || null);

  return {
    esm3Eval: structuralData.esm3Eval,
    esmcEval: structuralData.esmcEval,
    esm2Eval: structuralData.esm2Eval,
    saprotEval: structuralData.saprotEval,
    serviceStatus: mergedServiceStatus,
    ruleBasedInsights
  };
}
