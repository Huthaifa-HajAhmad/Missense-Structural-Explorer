import type { AnalysisPipelineStage, AnalysisStageOutcome } from "../../shared/contracts";

/**
 * What one analysis run knows about itself, and the only place that answers "is this run still current?".
 *
 * The ledger is pure so its rules can be tested without a pipeline. It holds stages that were announced
 * before a result object existed to carry them. Once a stage is written on the result, the result wins.
 */
type StageMap = Partial<Record<AnalysisPipelineStage, AnalysisStageOutcome>>;

export interface RunLedger {
  stages: StageMap;
  failed: boolean;
  acceptingEvidence: boolean;
}

export type RunEvent =
  | { type: "stage"; stage: AnalysisPipelineStage; outcome: AnalysisStageOutcome }
  | { type: "core-failed" }
  | { type: "evidence-stopped" };

export const EMPTY_RUN_LEDGER: RunLedger = { stages: {}, failed: false, acceptingEvidence: true };

export function applyRunEvent(ledger: RunLedger, event: RunEvent): RunLedger {
  switch (event.type) {
    case "stage":
      return { ...ledger, stages: { ...ledger.stages, [event.stage]: event.outcome } };
    case "core-failed": {
      const stages: StageMap = { ...ledger.stages };
      for (const [stage, outcome] of Object.entries(stages)) {
        if (outcome === "running") stages[stage as AnalysisPipelineStage] = "skipped";
      }
      return { ...ledger, failed: true, stages: { ...stages, core: "error" } };
    }
    case "evidence-stopped":
      return { ...ledger, acceptingEvidence: false };
  }
}

export interface PipelineRunIdentity {
  requestId: number;
  signal: AbortSignal;
  getActiveRequestId: () => number;
}

export function createPipelineRun({ requestId, signal, getActiveRequestId }: PipelineRunIdentity) {
  let ledger = EMPTY_RUN_LEDGER;
  const isStale = () => signal.aborted || getActiveRequestId() !== requestId;
  return {
    /** A newer run replaced this one, or it was cancelled. A stale run writes nothing. */
    isStale,
    /** False also after core failed: the run is still current, but late evidence must not land on its error. */
    acceptsEvidence: () => ledger.acceptingEvidence && !isStale(),
    hasFailed: () => ledger.failed,
    stopEvidence: () => { ledger = applyRunEvent(ledger, { type: "evidence-stopped" }); },
    record: (event: RunEvent) => { ledger = applyRunEvent(ledger, event); },
    /** The stages to show: everything announced, overlaid by what the result already says. */
    withAnnouncedStages: (resultStages: StageMap | undefined): StageMap => ({ ...ledger.stages, ...resultStages }),
  };
}
