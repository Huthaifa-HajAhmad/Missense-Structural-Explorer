import { StateCreator } from "zustand";
import { StructuralMetrics } from "../../types";
import type { LoadedEntry, RepresentationId } from "../../shared/structure3dEvidence";

export interface StructuralFoldingState {
  foldxMetrics: StructuralMetrics | null;
  /** The 3D colouring the reader picked; the evidence model falls back when it does not apply. */
  structureRepresentation: RepresentationId;
  /**
   * The PDB entry the reader loaded from the experimental list, once the viewer has fetched it: the
   * canvas draws it from here, and the model reads its numbering and the residue at the variant's
   * position. Keyed by the URL it came from, so a text never outlives the selection it belongs to.
   */
  customPdbEntry: LoadedEntry | null;
}

export interface StructuralFoldingActions {
  setFoldxMetrics: (foldxMetrics: StructuralMetrics | null) => void;
  setStructureRepresentation: (representation: StructuralFoldingState["structureRepresentation"]) => void;
  setCustomPdbEntry: (entry: LoadedEntry | null) => void;
  /** Clears the FoldX superposition measurements, for a new variant. */
  resetFoldxMetrics: () => void;
}

export type StructuralFoldingSlice = StructuralFoldingState & StructuralFoldingActions;

export const createStructuralFoldingSlice: StateCreator<
  StructuralFoldingSlice,
  [],
  [],
  StructuralFoldingSlice
> = (set) => ({
  foldxMetrics: null,
  structureRepresentation: "confidence",
  customPdbEntry: null,

  setFoldxMetrics: (foldxMetrics) => set({ foldxMetrics }),
  setStructureRepresentation: (structureRepresentation) => set({ structureRepresentation }),
  setCustomPdbEntry: (customPdbEntry) => set({ customPdbEntry }),
  resetFoldxMetrics: () => set({ foldxMetrics: null })
});
