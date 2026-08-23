import {
  fetchAlphafoldPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  type PdbBestStructureMapping
} from "./external.ts";
import { fetchEsm3StructureEval, type ESM3StructureEvalResult } from "./esm3_forge.ts";
import { runEsmcAnalysis, type EsmcEvalResult } from "./esmc.ts";
import { runEsm2Analysis } from "./esm2.ts";
import { runSaprotAnalysis, type SaprotEvalResult } from "./saprot.ts";
import type { ParsedVariantContext } from "../routes/variant/variant-parser.ts";

export interface StructuralAnalysisData {
  esm3Eval: ESM3StructureEvalResult | { error: string } | null;
  esmcEval: EsmcEvalResult | null;
  esm2Eval: EsmcEvalResult | null;
  saprotEval: SaprotEvalResult | null;
  pdbMapping: PdbBestStructureMapping | null;
  degraded?: boolean;
}

/**
 * Executes deep learning structural models (ESM3, ESMC, ESM-2 3B, SaProt) with timeout racing
 * and single-pass shared PDB text resolution.
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
      return await fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, pdbText, biohubToken);
    } catch (err) {
      console.warn("[ESM3 Parallel Run Warning] Failed to run ESM3 structural evaluation:", err);
      return fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, null, biohubToken);
    }
  }).catch(() => null);

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

  const saprotEvalPromise = pdbTextPromise.then(async (pdbText) => {
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

  const isEsm3Failed = !esm3Eval || ("error" in esm3Eval && Boolean(esm3Eval.error));
  const anyModelFailed = isEsm3Failed || !esmcEval || !esm2Eval || !saprotEval;
  const anyModelSucceeded = Boolean((esm3Eval && !("error" in esm3Eval)) || esmcEval || esm2Eval || saprotEval);
  const degraded = anyModelFailed && anyModelSucceeded;

  return {
    esm3Eval,
    esmcEval,
    esm2Eval,
    saprotEval,
    pdbMapping,
    degraded
  };
}
