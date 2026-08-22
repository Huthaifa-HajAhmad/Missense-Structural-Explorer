import { useState, useEffect, useCallback } from "react";
import { AnalysisState, AnalysisResult } from "../types";
import { getCachedVariant, setCachedVariant } from "../services/pipeline/variantCache";

export function usePredictorData() {
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    result: null,
    isLoading: false,
    error: null
  });
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [isBiophysicalLoading, setIsBiophysicalLoading] = useState(false);
  const [isClinicalLoading, setIsClinicalLoading] = useState(false);
  const [isNarrativeLoading, setIsNarrativeLoading] = useState(false);

  // Cache completed analysis in unified versioned variantCache
  useEffect(() => {
    if (analysisState.result && !analysisState.isLoading && typeof window !== "undefined") {
      try {
        const gene = analysisState.result.metadata?.gene || "";
        const variant = analysisState.result.metadata?.variant || "";
        const uniprotId = analysisState.result.metadata?.uniprotId || "";
        if (gene && variant) {
          setCachedVariant(gene, variant, uniprotId, {
            analysisResult: analysisState.result
          });
        }
      } catch (e) {
        // Ignore quota errors
      }
    }
  }, [analysisState.result, analysisState.isLoading]);

  const getCachedAnalysis = useCallback((gene: string, variant: string): AnalysisResult | null => {
    if (typeof window === "undefined" || !gene || !variant) return null;
    const bundle = getCachedVariant(gene, variant);
    return bundle?.analysisResult || null;
  }, []);

  const updateAnalysisResultSlice = useCallback(<K extends keyof AnalysisResult>(key: K, value: AnalysisResult[K]) => {
    setAnalysisState(prev => {
      if (!prev.result) return prev;
      return {
        ...prev,
        result: {
          ...prev.result,
          [key]: value
        }
      };
    });
  }, []);

  return {
    analysisState,
    setAnalysisState,
    loadingStep,
    setLoadingStep,
    isBiophysicalLoading,
    setIsBiophysicalLoading,
    isClinicalLoading,
    setIsClinicalLoading,
    isNarrativeLoading,
    setIsNarrativeLoading,
    getCachedAnalysis,
    updateAnalysisResultSlice
  };
}
