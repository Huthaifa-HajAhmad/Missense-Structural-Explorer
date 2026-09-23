import { StateCreator } from "zustand";
import { StructuralMetrics } from "../../types";

export interface StructuralFoldingState {
  esmFoldWtPdb: string | null;
  esmFoldMutPdb: string | null;
  esmFoldAlignedPdb: string | null;
  esmFoldMetrics: StructuralMetrics | null;
  foldxMetrics: StructuralMetrics | null;
  isEsmFolding: boolean;
  esmFoldingError: string | null;
  active3dModelTab: "alphafold2" | "esmfold2" | "esm3";
}

export interface StructuralFoldingActions {
  setEsmFoldWtPdb: (esmFoldWtPdb: string | null) => void;
  setEsmFoldMutPdb: (esmFoldMutPdb: string | null) => void;
  setEsmFoldAlignedPdb: (esmFoldAlignedPdb: string | null) => void;
  setEsmFoldMetrics: (esmFoldMetrics: StructuralMetrics | null) => void;
  setFoldxMetrics: (foldxMetrics: StructuralMetrics | null) => void;
  setIsEsmFolding: (isEsmFolding: boolean) => void;
  setEsmFoldingError: (esmFoldingError: string | null) => void;
  setActive3dModelTab: (active3dModelTab: "alphafold2" | "esmfold2" | "esm3") => void;
  resetEsmFoldState: () => void;
}

export type StructuralFoldingSlice = StructuralFoldingState & StructuralFoldingActions;

export const createStructuralFoldingSlice: StateCreator<
  StructuralFoldingSlice,
  [],
  [],
  StructuralFoldingSlice
> = (set) => ({
  esmFoldWtPdb: null,
  esmFoldMutPdb: null,
  esmFoldAlignedPdb: null,
  esmFoldMetrics: null,
  foldxMetrics: null,
  isEsmFolding: false,
  esmFoldingError: null,
  active3dModelTab: "alphafold2",

  setEsmFoldWtPdb: (esmFoldWtPdb) => set({ esmFoldWtPdb }),
  setEsmFoldMutPdb: (esmFoldMutPdb) => set({ esmFoldMutPdb }),
  setEsmFoldAlignedPdb: (esmFoldAlignedPdb) => set({ esmFoldAlignedPdb }),
  setEsmFoldMetrics: (esmFoldMetrics) => set({ esmFoldMetrics }),
  setFoldxMetrics: (foldxMetrics) => set({ foldxMetrics }),
  setIsEsmFolding: (isEsmFolding) => set({ isEsmFolding }),
  setEsmFoldingError: (esmFoldingError) => set({ esmFoldingError }),
  setActive3dModelTab: (active3dModelTab) => set({ active3dModelTab }),

  resetEsmFoldState: () => set({
    esmFoldWtPdb: null,
    esmFoldMutPdb: null,
    esmFoldAlignedPdb: null,
    esmFoldMetrics: null,
    foldxMetrics: null,
    isEsmFolding: false,
    esmFoldingError: null
  })
});
