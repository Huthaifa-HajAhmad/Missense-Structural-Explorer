import { useRef, useCallback, useEffect } from "react";

/**
 * Manages request lifecycle, active request generation counter, and AbortController instances
 * across parallel biophysical, structural, and LLM queries.
 */
export function usePipelineAbortController() {
  const analysisAbortRef = useRef<AbortController | null>(null);
  const mutantFoldAbortRef = useRef<AbortController | null>(null);
  const compareFoldAbortRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<number>(0);

  const abortAllPendingRequests = useCallback((
    clearDynaMutPoll?: () => void,
    clearDynaMutComparePoll?: () => void,
    clearDdmutPoll?: () => void,
    clearDdmutComparePoll?: () => void,
    clearThermoMpnnPoll?: () => void,
    clearThermoMpnnComparePoll?: () => void
  ) => {
    activeRequestIdRef.current += 1;
    if (clearDynaMutPoll) clearDynaMutPoll();
    if (clearDynaMutComparePoll) clearDynaMutComparePoll();
    if (clearDdmutPoll) clearDdmutPoll();
    if (clearDdmutComparePoll) clearDdmutComparePoll();
    if (clearThermoMpnnPoll) clearThermoMpnnPoll();
    if (clearThermoMpnnComparePoll) clearThermoMpnnComparePoll();
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
    if (compareFoldAbortRef.current) {
      try {
        compareFoldAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort compare fold request", e);
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
    compareFoldAbortRef,
    activeRequestIdRef,
    abortAllPendingRequests
  };
}
