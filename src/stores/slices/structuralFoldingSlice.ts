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
  /** Which engine folded each de novo structure, as the `/esmfold` route reported it (null: not reported). */
  esmFoldEngines: { wildType: string | null; variant: string | null } | null;
  /** The route returned ONE structure (no variant model). The wild type used to be copied into both slots. */
  esmFoldSingleStructure: boolean;
  /** Kabsch fit scope for the de novo pair. FoldX's rigid-backbone pair has no scope to choose. */
  esmAlignmentScope: "local" | "global";
  /** The 3D colouring the reader picked; the evidence model falls back when it does not apply. */
  structureRepresentation: "confidence" | "plain" | "pair" | "displacement" | "esm3";
  /**
   * Text of the PDB entry the reader loaded from the experimental list (`customPdbUrl`), once the
   * viewer has fetched it — so the model can check which residue that entry carries at the variant's
   * position. Such entries keep their own numbering.
   */
  customPdbText: string | null;
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
  setEsmFoldEngines: (engines: { wildType: string | null; variant: string | null } | null) => void;
  setEsmFoldSingleStructure: (single: boolean) => void;
  setEsmAlignmentScope: (scope: "local" | "global") => void;
  setStructureRepresentation: (representation: StructuralFoldingState["structureRepresentation"]) => void;
  setCustomPdbText: (text: string | null) => void;
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
  esmFoldEngines: null,
  esmFoldSingleStructure: false,
  esmAlignmentScope: "local",
  structureRepresentation: "confidence",
  customPdbText: null,

  setEsmFoldWtPdb: (esmFoldWtPdb) => set({ esmFoldWtPdb }),
  setEsmFoldMutPdb: (esmFoldMutPdb) => set({ esmFoldMutPdb }),
  setEsmFoldAlignedPdb: (esmFoldAlignedPdb) => set({ esmFoldAlignedPdb }),
  setEsmFoldMetrics: (esmFoldMetrics) => set({ esmFoldMetrics }),
  setFoldxMetrics: (foldxMetrics) => set({ foldxMetrics }),
  setIsEsmFolding: (isEsmFolding) => set({ isEsmFolding }),
  setEsmFoldingError: (esmFoldingError) => set({ esmFoldingError }),
  setActive3dModelTab: (active3dModelTab) => set({ active3dModelTab }),
  setEsmFoldEngines: (esmFoldEngines) => set({ esmFoldEngines }),
  setEsmFoldSingleStructure: (esmFoldSingleStructure) => set({ esmFoldSingleStructure }),
  setEsmAlignmentScope: (esmAlignmentScope) => set({ esmAlignmentScope }),
  setStructureRepresentation: (structureRepresentation) => set({ structureRepresentation }),
  setCustomPdbText: (customPdbText) => set({ customPdbText }),

  resetEsmFoldState: () => set({
    esmFoldWtPdb: null,
    esmFoldMutPdb: null,
    esmFoldAlignedPdb: null,
    esmFoldMetrics: null,
    foldxMetrics: null,
    isEsmFolding: false,
    esmFoldingError: null,
    esmFoldEngines: null,
    esmFoldSingleStructure: false
  })
});
