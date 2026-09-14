import { useRef, useCallback } from "react";
import { useDevConsole } from "../../context/DevConsoleContext.tsx";
import type { TraceContext } from "../../services/pipeline/types.ts";

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

  const finishPipelineTrace = useCallback((status: "completed" | "failed") => {
    if (activeTraceIdRef.current) {
      finishTraceRun(activeTraceIdRef.current, status);
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
