import { create } from "zustand";
import { SearchSlice, createSearchSlice } from "./slices/searchSlice";
import { PipelineSlice, createPipelineSlice } from "./slices/pipelineSlice";
import { BiophysicalSlice, createBiophysicalSlice } from "./slices/biophysicalSlice";
import { StructuralFoldingSlice, createStructuralFoldingSlice } from "./slices/structuralFoldingSlice";
import { UiSlice, createUiSlice } from "./slices/uiSlice";
import type { VariantBiophysicsState } from "./models";

export type { VariantBiophysicsState };

export interface RootStoreActions {
  resetVariantAnalysisState: () => void;
}

export type VariantAnalysisStore = SearchSlice &
  PipelineSlice &
  BiophysicalSlice &
  StructuralFoldingSlice &
  UiSlice &
  RootStoreActions;

export const useVariantAnalysisStore = create<VariantAnalysisStore>()((set, get, api) => ({
  ...createSearchSlice(set, get, api),
  ...createPipelineSlice(set, get, api),
  ...createBiophysicalSlice(set, get, api),
  ...createStructuralFoldingSlice(set, get, api),
  ...createUiSlice(set, get, api),

  resetVariantAnalysisState: () => {
    get().resetViewerState();
    get().resetEsmFoldState();
    set({
      analysisState: {
        result: null,
        isLoading: false,
        error: null
      },
      loadingStep: "",
      isBiophysicalLoading: false,
      isStructuralLoading: false,
      isClinicalLoading: false,
      isNarrativeLoading: false,
      homologs: [],
      isHomologsLoading: false,
      disruptionPredictor: null,
      triageOverride: false
    });
  }
}));

type ActionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

export type VariantAnalysisActions = Pick<VariantAnalysisStore, ActionKeys<VariantAnalysisStore>>;

/**
 * Non-hook getter for static action functions from the store.
 */
export const getVariantAnalysisActions = (): VariantAnalysisActions =>
  useVariantAnalysisStore.getState();

/**
 * Hook to retrieve static/stable action functions from the store without causing re-renders.
 */
export function useVariantAnalysisActions(): VariantAnalysisActions {
  return useVariantAnalysisStore.getState();
}
