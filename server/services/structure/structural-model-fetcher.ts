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
import { BUDGET_EXPIRED, createTimeoutScope, type TimeoutScope } from "../orchestration/timeout-scope.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

export interface StructuralAnalysisData {
  esm3Eval: ESM3StructureEvalResult | ModelEvalError | null;
  esmcEval: EsmcEvalResult | ModelEvalError | null;
  esm2Eval: EsmcEvalResult | ModelEvalError | null;
  saprotEval: SaprotEvalResult | ModelEvalError | null;
  pdbMapping: PdbBestStructureMapping | null;
  degraded?: boolean;
  /**
   * Structural model outcomes.
   *
   * `esm2Eval` is the ESM-2 650M `runEsm2Analysis` outcome and is deliberately NOT reported under
   * `esm2`. That key already belongs to the CORE run's VESM-150M evaluation (`serviceStatus.esm2`,
   * produced by `core-data-fetcher.ts`), and every consumer of this map merges it with a spread —
   * the structural overlay in `src/services/pipeline/biophysicalService.ts`, and the server's own
   * `mergeStructuralServiceStatus`. Under one shared key the deep model silently replaced the core
   * outcome, so a VESM evaluation that timed out read as "ok" (or the reverse) depending on which
   * route answered last, and the Evidence Lineage listed one source twice.
   */
  serviceStatus?: Record<string, "ok" | "error" | "timeout" | "offline">;
  /**
   * Per-model durations in ms, keyed EXACTLY as {@link StructuralAnalysisData.serviceStatus} keys its
   * outcomes (`esm3`, `esmc`, `esm2Eval`, `saprot`), plus `pdbText` for the structure text they share.
   *
   * Each is the span the RUN waited for that model (`min(model, budget)`), measured on real clocks —
   * not a copy of the request's own duration and not the model's eventual settling time after the
   * request has answered. Deliberately NOT named `serviceTimings`: that name belongs to the CORE run's
   * per-source timings, and a payload carries both.
   */
  structuralTimings?: Record<string, number>;
  /**
   * When each model settled, on this run's clock (ms from the structural run's start). Consumers derive
   * a start as `offset - duration`, clamped at 0, exactly as they do for the core timings.
   */
  structuralTimingOffsets?: Record<string, number>;
}

/**
 * Whether a mapping handed down as `prefetched.pdbMapping` may be used FOR THIS CONTEXT.
 *
 * Why this is not paranoia: the mapping is reused from a persisted payload's `_internal.pdbMapping`
 * (that is the whole point of handing it down — it saves a PDBe round trip), and a persisted row can
 * be read back for a context it was not resolved under. `fetchBestPdbStructure` picks a structure
 * that COVERS the residue, so a mapping whose UniProt numbering starts after this position cannot
 * contain it; the ESM3/SaProt window would then be cut around a residue the structure does not
 * have, and the model would return confident-looking numbers for atoms from somewhere else.
 *
 * The upper bound is not part of the mapping (PDBe's `unp_end` is not retained), so coverage in the
 * other direction is asserted by the resolver at lookup time. What is checkable here is checked
 * here, and an unverifiable mapping is refused rather than assumed good: the caller's fallback is a
 * fresh lookup, which is cheap (the resolver is memoised) and correct.
 */
export function isPdbMappingCompatibleWithContext(
  mapping: PdbBestStructureMapping | null | undefined,
  context: { pos?: number | null; residueIndex?: string | null }
): boolean {
  if (!mapping || !mapping.pdbId || !mapping.chainId) return false;

  const unpStart = mapping.unpStart;
  const structStart = mapping.structStart;
  if (!Number.isFinite(unpStart) || !Number.isFinite(structStart)) return false;

  /**
   * Internal consistency: the retained shift must equal the offset it was derived from
   * (`unp_start - start`). A row written by an older producer, or truncated in the payload, would
   * otherwise apply the WRONG shift to every residue number in the extracted chain.
   */
  if (Number.isFinite(mapping.shift) && mapping.shift !== unpStart - structStart) return false;

  const pos =
    typeof context.pos === "number" && Number.isFinite(context.pos)
      ? context.pos
      : context.residueIndex
        ? parseInt(context.residueIndex, 10)
        : null;
  if (pos === null || !Number.isFinite(pos)) return false;

  return pos >= unpStart;
}

/**
 * Executes deep learning structural models (ESM3, ESMC, ESM-2 650M, SaProt) with timeout racing
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
  /**
   * One budget scope for the four races, disposed in a `finally`.
   *
   * Each model's timer is cleared the moment that model settles, and a model that settles after its
   * budget already answered is absorbed rather than rejecting into a timer context nobody awaits
   * (see `timeout-scope.ts`). Disposal covers the path where this function throws instead of
   * returning: no armed timers left behind, whatever happened.
   */
  const budgets = createTimeoutScope();
  try {
    return await runStructuralModels(context, biohubToken, hfToken, timeoutMs, prefetched, budgets);
  } finally {
    budgets.dispose();
  }
}

async function runStructuralModels(
  context: ParsedVariantContext,
  biohubToken: string | null,
  hfToken: string | null,
  timeoutMs: number,
  prefetched: {
    pdbMappingPromise?: Promise<PdbBestStructureMapping | null>;
    pdbMapping?: PdbBestStructureMapping | null;
  } | undefined,
  budgets: TimeoutScope
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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * PER-MODEL SPANS — measured here, because the parent HTTP span cannot express them
   * ─────────────────────────────────────────────────────────────────────────────
   * The structural route returned no timing metadata at all, so a consumer had exactly one span: the
   * whole request, reported as successful as long as the route answered — including the case where
   * every model was unavailable and the response was four error objects. A waterfall drawn from that
   * shows a healthy structural stage for a run that produced no model output.
   *
   * These are the four models' OWN spans, keyed exactly as `serviceStatus` keys them (so a span can be
   * paired with the outcome it belongs to), plus the PDB text resolution they share. Both quantities
   * are measured from real clocks:
   *
   *   • `durationMs`: how long the run actually waited for that model — i.e. the RACED promise, so a
   *     model that never answers is counted at its budget rather than at whatever it does later, in a
   *     request that has already responded;
   *   • `settleOffsetMs`: when it settled on this run's clock, which is the position a span needs.
   *
   * Named `structuralTimings` / `structuralTimingOffsets` so that persisting them beside a payload can
   * never overwrite the CORE `serviceTimings` / `serviceTimingOffsets` the same payload carries.
   */
  const structuralStart = performance.now();
  const structuralTimings: Record<string, number> = {};
  const structuralTimingOffsets: Record<string, number> = {};

  const timeModel = <T>(key: string, task: Promise<T>): Promise<T> => {
    const t0 = performance.now();
    const record = (): void => {
      const now = performance.now();
      structuralTimings[key] = Math.round(now - t0);
      structuralTimingOffsets[key] = Math.round(now - structuralStart);
    };
    return task.then(
      value => {
        record();
        return value;
      },
      err => {
        record();
        throw err;
      }
    );
  };

  /**
   * The structure this run will read, resolved ONCE for ESM3 and SaProt.
   *
   * A handed-down mapping is used only when it is compatible with THIS context; otherwise the
   * resolver is asked again. The old form reversed that: any value except `undefined` — including
   * the `null` the structural route sends when the persisted row carries no mapping — was taken as
   * final, so the run skipped the PDBe lookup and fell back to AlphaFold for a variant whose
   * experimental structure exists and covers the position.
   */
  const pdbMappingPromise = (async (): Promise<PdbBestStructureMapping | null> => {
    const handed =
      prefetched?.pdbMapping !== undefined
        ? prefetched.pdbMapping
        : prefetched?.pdbMappingPromise
          ? await prefetched.pdbMappingPromise
          : undefined;

    if (handed !== undefined && isPdbMappingCompatibleWithContext(handed, context)) {
      return handed;
    }

    if (handed !== undefined) {
      console.warn(
        "[Structural PDB Reuse] A handed-down PDB mapping is not compatible with this context " +
        `(${context.gene} ${context.variant}, residue ${pos}); resolving the structure again.`
      );
    }

    return fetchBestPdbStructure(uniprotId, pos).catch(err => {
      console.warn("[PDB Selection Error] Failed to query best PDB structure:", err);
      return null;
    });
  })();

  /**
   * Which kind of structure `pdbTextPromise` resolved to. The ESM3 evaluation reads the site's B
   * column as "pLDDT"; for a mapped crystal entry that is a temperature factor (see
   * `fetchEsm3StructureEval`), so the source travels with the text.
   */
  let pdbTextSource: "alphafold" | "experimental" | null = null;

  // Single-pass PDB text resolution shared across both ESM3 and SaProt
  const pdbTextPromise = timeModel("pdbText", pdbMappingPromise.then(async (pdbMap) => {
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
    if (text) pdbTextSource = "experimental";
    if (!text && uniprotId) {
      try {
        text = await fetchAlphafoldPdb(uniprotId);
        if (text) pdbTextSource = "alphafold";
      } catch (afFetchErr: any) {
        console.warn(`[Structural AF2 PDB Fetch] Failed to fetch AF2 PDB text for ${uniprotId}:`, afFetchErr.message);
      }
    }
    return text;
  }).catch(() => null));

  const esm3EvalPromise = pdbTextPromise.then(async (pdbText) => {
    try {
      const res = await fetchEsm3StructureEval(uniprotId, pos, wt1Letter, mut1Letter, pdbText, biohubToken, sequence, pdbTextSource);
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
    console.warn("[ESM-2 Parallel Run Warning] Failed to run ESM-2 analysis:", err);
    return { error: `ESM-2 analysis failed: ${err.message}`, status: "error" as const };
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

  /**
   * The model's own result if it settles inside the budget, otherwise a `timeout` evaluation.
   *
   * Replaces a `Promise.race` against a fresh never-cleared timer per model: this clears the timer
   * the moment the model settles, and a model that settles after its budget already answered is
   * absorbed rather than left to reject into the timer's context (see `timeout-scope.ts`).
   */
  const withModelBudget = async <T,>(name: string, task: Promise<T>): Promise<T | ModelEvalError> => {
    const raw = await budgets.race(task, timeoutMs);
    if (raw !== BUDGET_EXPIRED) return raw as T;
    return {
      error: `${name} analysis timed out after ${timeoutMs}ms`,
      status: "timeout"
    };
  };

  /**
   * Timed OUTSIDE the budget wrapper, deliberately.
   *
   * The span a reader needs is what the RUN waited for, and this run stops waiting at the budget; the
   * underlying model may settle much later (or never), in a request that has already responded.
   * Timing the inner promise would put a 300 s bar on a 45 s request. So the measured span is
   * `min(model, budget)`, which is exactly the bar the waterfall should draw.
   */
  const fastEsm3Promise = timeModel("esm3", withModelBudget("ESM3", esm3EvalPromise));
  const fastEsmcPromise = timeModel("esmc", withModelBudget("VESM-150M", esmcEvalPromise));
  const fastEsm2Promise = timeModel("esm2Eval", withModelBudget("ESM-2", esm2EvalPromise));
  const fastSaprotPromise = timeModel("saprot", withModelBudget("SaProt", saprotEvalPromise));

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
    /**
     * NOT `esm2`. That key is the CORE VESM-150M outcome; a consumer that spreads this map over the
     * core payload's would replace it. See the note on `StructuralAnalysisData.serviceStatus`.
     */
    esm2Eval: getStatus(esm2Eval),
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
    serviceStatus: structuralServiceStatus,
    /**
     * Every model that was raced has a span, including the ones that failed or timed out — a run where
     * all four were unavailable is exactly the case a parent-span-only view reports as healthy.
     */
    structuralTimings,
    structuralTimingOffsets
  };
}
