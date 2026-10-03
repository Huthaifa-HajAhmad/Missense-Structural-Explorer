import { useRef, useCallback, useEffect } from "react";
import { useDevConsole } from "../../context/DevConsoleContext.tsx";
import type { TraceContext } from "../../services/pipeline/types.ts";
import type { TraceRunFinishStatus } from "../../types/devConsole.ts";

/**
 * Manages DevConsole telemetry spans and distributed tracing context for variant pipelines.
 */
export function usePipelineTelemetry() {
  const { dispatch, startTraceRun, addTraceSpan, updateTraceSpan, finishTraceRun } = useDevConsole();
  const activeTraceIdRef = useRef<string | null>(null);
  const traceStartRef = useRef<number>(0);

  const getTraceContext = useCallback((): TraceContext => ({
    activeTraceId: activeTraceIdRef.current,
    traceStart: traceStartRef.current,
    addTraceSpan,
    finishTraceRun
  }), [addTraceSpan, finishTraceRun]);

  const startPipelineTrace = useCallback((query: string) => {
    const traceId = startTraceRun(query || "Variant Analysis");
    activeTraceIdRef.current = traceId;
    traceStartRef.current = performance.now();
    return traceId;
  }, [startTraceRun]);

  /**
   * End a trace run.
   *
   * `status` is the caller's verdict and is passed through unchanged. `cancelled` exists so a run that
   * was superseded can be closed honestly rather than reported as a failure (no provider or pipeline
   * error occurred) or left `running` forever.
   *
   * `traceId` names the run to close. OMITTING it closes whatever this hook started most recently, which
   * is wrong for a superseded run: `startPipelineTrace` has since pointed the ref at the NEW run, so the
   * old one would keep hanging and the new one would be closed under a verdict that belongs to its
   * predecessor. A caller that can be superseded therefore captures the id it was given and passes it
   * here (or calls `finishTraceRun` directly), and the ref is deliberately NOT cleared — late spans from
   * a finished run still find their run rather than silently starting nothing.
   */
  const finishPipelineTrace = useCallback((status: TraceRunFinishStatus, traceId?: string) => {
    const target = traceId ?? activeTraceIdRef.current;
    if (target) {
      finishTraceRun(target, status);
    }
  }, [finishTraceRun]);

  /**
   * Close the run this hook was holding when it goes away.
   *
   * A run whose owner has unmounted has nobody left to finish it, so leaving it `running` would keep a
   * row that never ends — the shape this whole change exists to remove. The cleanup therefore cancels
   * it, and the reducer's idempotence makes that safe: a run that already ended (completed by its own
   * flow, or cancelled by the abort wrapper that runs first) keeps its outcome and its ending time, so
   * this can never overwrite a real verdict with an "unfinished" one.
   *
   * The ref is deliberately NOT cleared: a span that arrives after this hook unmounts — a background
   * poll reporting through the shared context — still finds its run instead of attaching to nothing.
   */
  useEffect(() => () => {
    if (activeTraceIdRef.current) {
      finishTraceRun(activeTraceIdRef.current, "cancelled");
    }
  }, [finishTraceRun]);

  return {
    dispatch,
    activeTraceIdRef,
    traceStartRef,
    getTraceContext,
    startPipelineTrace,
    finishPipelineTrace,
    startTraceRun,
    addTraceSpan,
    updateTraceSpan,
    finishTraceRun
  };
}
