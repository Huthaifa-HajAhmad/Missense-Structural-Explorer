import { create } from "zustand";
import { SearchSlice, createSearchSlice } from "./slices/searchSlice";
import { PipelineSlice, createPipelineSlice } from "./slices/pipelineSlice";
import { BiophysicalSlice, createBiophysicalSlice } from "./slices/biophysicalSlice";
import { StructuralFoldingSlice, createStructuralFoldingSlice } from "./slices/structuralFoldingSlice";
import { UiSlice, createUiSlice } from "./slices/uiSlice";
import type { VariantBiophysicsState } from "./models.ts";

export type { VariantBiophysicsState };

export type VariantAnalysisStore = SearchSlice &
  PipelineSlice &
  BiophysicalSlice &
  StructuralFoldingSlice &
  UiSlice;

export const useVariantAnalysisStore = create<VariantAnalysisStore>()((...a) => ({
  ...createSearchSlice(...a),
  ...createPipelineSlice(...a),
  ...createBiophysicalSlice(...a),
  ...createStructuralFoldingSlice(...a),
  ...createUiSlice(...a)
}));

/**
 * Hook to retrieve static/stable action functions from the store without causing re-renders.
 */
export function useVariantAnalysisActions(): VariantAnalysisStore {
  return useVariantAnalysisStore.getState();
}
