import { StateCreator } from "zustand";
import { AnalysisState, AnalysisResult, PdbHomolog, DisruptionPredictorResult } from "../../types";

export interface PipelineState {
  analysisState: AnalysisState;
  loadingStep: string;
  isBiophysicalLoading: boolean;
  isClinicalLoading: boolean;
  isNarrativeLoading: boolean;
  homologs: PdbHomolog[];
  isHomologsLoading: boolean;
  disruptionPredictor: DisruptionPredictorResult | null;
  computedResiduesCache: Record<string, any>;
  triageOverride: boolean;
}

export interface PipelineActions {
  setAnalysisState: (updater: AnalysisState | ((prev: AnalysisState) => AnalysisState)) => void;
  setLoadingStep: (loadingStep: string) => void;
  setIsBiophysicalLoading: (isBiophysicalLoading: boolean) => void;
  setIsClinicalLoading: (isClinicalLoading: boolean) => void;
  setIsNarrativeLoading: (isNarrativeLoading: boolean) => void;
  setHomologs: (homologs: PdbHomolog[] | ((prev: PdbHomolog[]) => PdbHomolog[])) => void;
  setIsHomologsLoading: (isHomologsLoading: boolean) => void;
  setDisruptionPredictor: (updater: DisruptionPredictorResult | null | ((prev: DisruptionPredictorResult | null) => DisruptionPredictorResult | null)) => void;
  setComputedResiduesCache: (cache: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void;
  setTriageOverride: (triageOverride: boolean) => void;
  updateAnalysisResultSlice: <K extends keyof AnalysisResult>(key: K, value: AnalysisResult[K]) => void;
}

export type PipelineSlice = PipelineState & PipelineActions;

export const createPipelineSlice: StateCreator<PipelineSlice, [], [], PipelineSlice> = (set) => ({
  analysisState: {
    result: null,
    isLoading: false,
    error: null
  },
  loadingStep: "",
  isBiophysicalLoading: false,
  isClinicalLoading: false,
  isNarrativeLoading: false,
  homologs: [],
  isHomologsLoading: false,
  disruptionPredictor: null,
  computedResiduesCache: {},
  triageOverride: false,

  setAnalysisState: (updater) => set((state) => ({
    analysisState: typeof updater === "function" ? updater(state.analysisState) : updater
  })),

  setLoadingStep: (loadingStep) => set({ loadingStep }),
  setIsBiophysicalLoading: (isBiophysicalLoading) => set({ isBiophysicalLoading }),
  setIsClinicalLoading: (isClinicalLoading) => set({ isClinicalLoading }),
  setIsNarrativeLoading: (isNarrativeLoading) => set({ isNarrativeLoading }),

  setHomologs: (updater) => set((state) => ({
    homologs: typeof updater === "function" ? updater(state.homologs) : updater
  })),

  setIsHomologsLoading: (isHomologsLoading) => set({ isHomologsLoading }),
  setDisruptionPredictor: (updater) => set((state) => ({
    disruptionPredictor: typeof updater === "function" ? updater(state.disruptionPredictor) : updater
  })),

  setComputedResiduesCache: (updater) => set((state) => ({
    computedResiduesCache: typeof updater === "function" ? updater(state.computedResiduesCache) : updater
  })),

  setTriageOverride: (triageOverride) => set({ triageOverride }),

  updateAnalysisResultSlice: (key, value) => set((state) => {
    if (!state.analysisState.result) return state;
    return {
      analysisState: {
        ...state.analysisState,
        result: {
          ...state.analysisState.result,
          [key]: value
        }
      }
    };
  })
});
