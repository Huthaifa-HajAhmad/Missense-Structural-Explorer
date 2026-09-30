import { useRef, useCallback, useEffect } from "react";

/**
 * Manages request lifecycle, active request generation counter, and AbortController instances
 * across parallel biophysical, structural, and LLM queries.
 */
export function usePipelineAbortController() {
  const analysisAbortRef = useRef<AbortController | null>(null);
  const mutantFoldAbortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  const abortAllPendingRequests = useCallback((
    clearDynaMutPoll?: () => void,
    clearDdmutPoll?: () => void,
    clearThermoMpnnPoll?: () => void
  ) => {
    activeRequestIdRef.current += 1;
    if (clearDynaMutPoll) clearDynaMutPoll();
    if (clearDdmutPoll) clearDdmutPoll();
    if (clearThermoMpnnPoll) clearThermoMpnnPoll();
    if (analysisAbortRef.current) {
      try {
        analysisAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort analysis request", e);
      }
    }
    if (mutantFoldAbortRef.current) {
      try {
        mutantFoldAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort mutant fold request", e);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      abortAllPendingRequests();
    };
  }, [abortAllPendingRequests]);

  return {
    analysisAbortRef,
    mutantFoldAbortRef,
    activeRequestIdRef,
    abortAllPendingRequests
  };
}
