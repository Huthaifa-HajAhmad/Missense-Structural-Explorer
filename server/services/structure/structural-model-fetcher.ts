import {
  fetchAlphafoldPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  type PdbBestStructureMapping
} from "../external.ts";
import { fetchEsm3StructureEval, type ESM3StructureEvalResult } from "../external-api/esm3_forge.ts";
import { runEsmcAnalysis, type EsmcEvalResult, type ModelEvalError } from "../external-api/esmc.ts";
import { runEsm2Analysis } from "../external-api/esm2.ts";
import { runSaprotAnalysis, type SaprotEvalResult } from "../external-api/saprot.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

export interface StructuralAnalysisData {
  esm3Eval: ESM3StructureEvalResult | ModelEvalError | null;
  esmcEval: EsmcEvalResult | ModelEvalError | null;
  esm2Eval: EsmcEvalResult | ModelEvalError | null;
  saprotEval: SaprotEvalResult | ModelEvalError | null;
  pdbMapping: PdbBestStructureMapping | null;
  degraded?: boolean;
  serviceStatus?: Record<string, "ok" | "error" | "timeout" | "offline">;
}

/**
 * Executes deep learning structural models (ESM3, ESMC, ESM-2 3B, SaProt) with timeout racing
 * and single-pass shared PDB text resolution.
 */
export async function fetchStructuralModelData(
  context: ParsedVariantContext,
  biohubToken: string | null,
  hfToken: string | null,
  timeoutMs: number = 45000,
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

  // Single-pass PDB text resolution shared across both ESM3 and SaProt
  const pdbTextPromise = pdbMappingPromise.then(async (pdbMap) => {
    let text: string | null = null;
    if (pdbMap && pdbMap.pdbId) {
      try {
        text = await fetchPdbFromRcsb(
          pdbMap.pdbId,
          pdbMap.chainId,
          pdbMap.unpStart,
          pdbMap.structStart,
          { uniprotId, sequence, pos, expectedWt1: wt1Letter }
        );
      } catch (pdbFetchErr: any) {
        console.warn(`[Structural PDB Fetch] Failed to fetch PDB text for ${pdbMap.pdbId}:`, pdbFetchErr.message);
      }
    }
    if (!text && uniprotId) {
      try {
        text = await fetchAlphafoldPdb(uniprotId);
      } catch (afFetchErr: any) {
        console.warn(`[Structural AF2 PDB Fetch] Failed to fetch AF2 PDB text for ${uniprotId}:`, afFetchErr.message);
      }
    }
    return text;
  }).catch(() => null);

  const esm3EvalPromise = pdbTextPromise.then(async (pdbText) => {
    try {
      const res = await fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, pdbText, biohubToken, sequence);
      if (!res) return { error: "ESM3 returned empty evaluation", status: "offline" as const };
      return res;
    } catch (err: any) {
      console.warn("[ESM3 Parallel Run Warning] Failed to run ESM3 structural evaluation:", err);
      const fallbackRes = await fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, null, biohubToken, sequence);
      return fallbackRes || { error: `ESM3 failed: ${err.message}`, status: "error" as const };
    }
  }).catch((err: any) => ({ error: `ESM3 evaluation failed: ${err.message}`, status: "error" as const }));

  const esmcEvalPromise = runEsmcAnalysis(
    gene,
    variant,
    uniprotId,
    sequence,
    biohubToken
  ).catch(err => {
    console.warn("[ESMC Parallel Run Warning] Failed to run ESMC analysis:", err);
    return { error: `ESMC-6B / VESM-150M analysis failed: ${err.message}`, status: "error" as const };
  });

  const esm2EvalPromise = runEsm2Analysis(
    gene,
    variant,
    uniprotId,
    sequence,
    hfToken
  ).catch(err => {
    console.warn("[ESM2 3B Parallel Run Warning] Failed to run ESM-2 3B analysis:", err);
    return { error: `ESM-2 3B analysis failed: ${err.message}`, status: "error" as const };
  });

  const chosenSaprotModel = context.saprotEngine === "saprot-35m"
    ? "westlake-repl/SaProt_35M_AF2"
    : "westlake-repl/SaProt_650M_AF2";

  const saprotEvalPromise = pdbTextPromise.then(async (pdbText) => {
    return runSaprotAnalysis(
      gene,
      variant,
      uniprotId,
      sequence,
      hfToken,
      pdbText,
      chosenSaprotModel,
      context.saprotEngine
    );
  }).catch(err => {
    console.warn("[SaProt Parallel Run Warning] Failed to run SaProt analysis:", err);
    return { error: `SaProt analysis failed: ${err.message}`, status: "error" as const };
  });

  const createTimeoutPromise = (name: string): Promise<ModelEvalError> =>
    new Promise<ModelEvalError>(resolve => {
      const timer = setTimeout(() => {
        resolve({
          error: `${name} analysis timed out after ${timeoutMs}ms`,
          status: "timeout"
        });
      }, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
    });

  const fastEsm3Promise = Promise.race([esm3EvalPromise, createTimeoutPromise("ESM3")]);
  const fastEsmcPromise = Promise.race([esmcEvalPromise, createTimeoutPromise("VESM-150M")]);
  const fastEsm2Promise = Promise.race([esm2EvalPromise, createTimeoutPromise("ESM-2 3B")]);
  const fastSaprotPromise = Promise.race([saprotEvalPromise, createTimeoutPromise("SaProt 650M AF2")]);

  const [esm3Eval, esmcEval, esm2Eval, saprotEval, pdbMapping] = await Promise.all([
    fastEsm3Promise,
    fastEsmcPromise,
    fastEsm2Promise,
    fastSaprotPromise,
    pdbMappingPromise
  ]);

  const getStatus = (evalRes: any): "ok" | "error" | "timeout" | "offline" => {
    if (!evalRes) return "offline";
    if ("error" in evalRes && evalRes.error) {
      if (evalRes.status === "timeout") return "timeout";
      if (evalRes.status === "offline") return "offline";
      return "error";
    }
    return "ok";
  };

  const structuralServiceStatus: Record<string, "ok" | "error" | "timeout" | "offline"> = {
    esm3: getStatus(esm3Eval),
    esmc: getStatus(esmcEval),
    esm2: getStatus(esm2Eval),
    saprot: getStatus(saprotEval)
  };

  const isSuccess = (evalRes: any) => Boolean(evalRes && !("error" in evalRes));
  const anyModelFailed = !isSuccess(esm3Eval) || !isSuccess(esmcEval) || !isSuccess(esm2Eval) || !isSuccess(saprotEval);
  const anyModelSucceeded = isSuccess(esm3Eval) || isSuccess(esmcEval) || isSuccess(esm2Eval) || isSuccess(saprotEval);
  const degraded = anyModelFailed && anyModelSucceeded;

  return {
    esm3Eval,
    esmcEval,
    esm2Eval,
    saprotEval,
    pdbMapping,
    degraded,
    serviceStatus: structuralServiceStatus
  };
}
