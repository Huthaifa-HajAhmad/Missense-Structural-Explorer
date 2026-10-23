import type { ConservationData, ConservationModelKey, ConservationModelState } from "./contracts.ts";

/**
 * Where one model inside the conservation composite stands, for a surface deciding between
 * "still running", "not assessed in time" and "answered".
 *
 * The composite (`conservationData`) streams: SpliceAI, AlphaGenome, GPN-Star and the dbNSFP base
 * each publish as they answer, and the snapshot carries `modelStatus`. Precedence:
 *
 * 1. A settled composite status (`ok`, `not_found`, …) with no `modelStatus` is final: every model
 *    settled. A failed or expired composite (`error`, `timeout`) with no `modelStatus` salvaged
 *    nothing, so every model reads `timeout` (not assessed). With `modelStatus` it is a salvaged
 *    budget expiry, whose per-model states say which models timed out.
 * 2. A pending composite with `modelStatus` answers per model.
 * 3. Otherwise the composite status, and with no status at all, the caller's loading flag.
 */
export function conservationModelState(
  result: any,
  model: ConservationModelKey,
  fallbackLoading: boolean
): ConservationModelState {
  const composite = result?.serviceStatus?.conservationData ?? result?.metadata?.serviceStatus?.conservationData;
  const perModel: ConservationModelState | undefined = result?.conservationData?.modelStatus?.[model];
  if (composite && composite !== "pending") {
    // A stale `pending` cannot outlive the composite: the run is over for this source.
    if (perModel) return perModel === "timeout" ? "timeout" : "settled";
    // A composite that FAILED or ran out of time with nothing salvaged says nothing about any model:
    // "not assessed", never "assessed and empty".
    return composite === "error" || composite === "timeout" ? "timeout" : "settled";
  }
  if (!composite && !fallbackLoading) return perModel === "timeout" ? "timeout" : "settled";
  if (perModel) return perModel;
  return composite === "pending" || fallbackLoading ? "pending" : "settled";
}

export function isConservationModelPending(result: any, model: ConservationModelKey, fallbackLoading: boolean): boolean {
  return conservationModelState(result, model, fallbackLoading) === "pending";
}

/**
 * Whether the run still owns `conservationData`. A tab-side re-score written while it does is
 * overwritten: by the next streamed snapshot, and — after the composite settles — by the final core
 * payload, which replaces the whole result when the remaining sources land. So the lock holds until
 * the core stage itself is terminal, not merely until the composite settles.
 */
export function isConservationCompositePending(result: any, fallbackLoading: boolean): boolean {
  const composite = result?.serviceStatus?.conservationData ?? result?.metadata?.serviceStatus?.conservationData;
  if (composite === "pending") return true;
  if (result?.metadata?.pipelineStages?.core === "running") return true;
  return composite ? false : fallbackLoading;
}

/**
 * The composite after an AlphaGenome-only re-evaluation: ONLY the AlphaGenome reading (and its
 * refusal) is taken from the second run. Its other models belong beside a verdict this run never
 * computed with them, so they are not imported — even into a run that has no composite yet.
 */
export function mergeAlphaGenomeReevaluation(current: ConservationData | null, fresh: ConservationData): ConservationData {
  const { alphagenome: _stale, modelStatus: priorStatus, assemblyRefusals: priorRefusals, ...rest } = current ?? ({} as ConservationData);
  const refusals = [
    ...(priorRefusals ?? []).filter(r => r.source !== "alphagenome"),
    ...(fresh.assemblyRefusals ?? []).filter(r => r.source === "alphagenome"),
  ];
  const modelStatus = priorStatus ? { ...priorStatus, alphagenome: "settled" as const } : undefined;
  return {
    ...rest,
    alphagenome: fresh.alphagenome ?? null,
    assemblyRefusals: refusals.length > 0 ? refusals : null,
    ...(modelStatus && !Object.values(modelStatus).every(state => state === "settled") ? { modelStatus } : {}),
  } as ConservationData;
}
