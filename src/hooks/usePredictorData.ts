import { useState } from "react";
import { AnalysisState } from "../types";

export function usePredictorData() {
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    result: null,
    isLoading: false,
    error: null
  });
  const [loadingStep, setLoadingStep] = useState<string>("");
  const [isBiophysicalLoading, setIsBiophysicalLoading] = useState(false);
  const [isClinicalLoading, setIsClinicalLoading] = useState(false);

  return {
    analysisState,
    setAnalysisState,
    loadingStep,
    setLoadingStep,
    isBiophysicalLoading,
    setIsBiophysicalLoading,
    isClinicalLoading,
    setIsClinicalLoading
  };
}
