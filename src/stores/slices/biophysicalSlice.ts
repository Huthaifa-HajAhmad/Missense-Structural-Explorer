import { StateCreator } from "zustand";
import { VariantBiophysicsState, createInitialBiophysicsState } from "../models.ts";

export interface BiophysicalState {
  // Normalized Sub-State Models
  primaryBiophysics: VariantBiophysicsState;
  compareBiophysics: VariantBiophysicsState;

  // Shared / Global Viewer State
  pdbText: string | null;
  compareMode: boolean;
  compareVariant: string;
  comparisonLayout: "split" | "overlay";
  computedPocket: any | null;
  isPocketLoading: boolean;
  pocketError: string | null;
  lastFetchedFold: string;

  // Flat Primary Variant Properties (retained for 100% backward compatibility)
  mutantPdb: string | null;
  foldedResidueIndex: number | null;
  isFolding: boolean;
  foldingError: string | null;
  foldingStatus: string | null;
  foldingDdG: number | null;
  foldingEnergetics: any | null;
  dynamut2Status: string | null;
  dynamut2JobId: string | null;
  ddmutStatus: string | null;
  ddmutJobId: string | null;
  thermompnnStatus: string | null;
  thermompnnError: string | null;
  thermompnnJobId: string | null;
  structuralDiff: any | null;

  // Flat Comparison Variant Properties (retained for 100% backward compatibility)
  compareMutantPdb: string | null;
  compareFoldedResidueIndex: number | null;
  isFoldingCompare: boolean;
  foldingCompareError: string | null;
  compareFoldingStatus: string | null;
  compareFoldingDdG: number | null;
  compareFoldingEnergetics: any | null;
  compareDynamut2Status: string | null;
  compareDynamut2JobId: string | null;
  compareDdmutStatus: string | null;
  compareDdmutJobId: string | null;
  compareThermompnnStatus: string | null;
  compareThermompnnError: string | null;
  compareThermompnnJobId: string | null;
  compareStructuralDiff: any | null;
}

export interface BiophysicalActions {
  // Normalized Atomic Actions
  setVariantBiophysics: (isCompare: boolean, partial: Partial<VariantBiophysicsState>) => void;
  resetBiophysics: (isCompare?: boolean) => void;

  // Shared / Global Setters
  setPdbText: (pdbText: string | null) => void;
  setCompareMode: (compareMode: boolean) => void;
  setCompareVariant: (compareVariant: string) => void;
  setComparisonLayout: (comparisonLayout: "split" | "overlay") => void;
  setComputedPocket: (computedPocket: any | null) => void;
  setIsPocketLoading: (isPocketLoading: boolean) => void;
  setPocketError: (pocketError: string | null) => void;
  setLastFetchedFold: (lastFetchedFold: string) => void;
  resetViewerState: () => void;

  // Flat Primary Setters (retained for 100% backward compatibility)
  setMutantPdb: (mutantPdb: string | null) => void;
  setFoldedResidueIndex: (foldedResidueIndex: number | null) => void;
  setIsFolding: (isFolding: boolean) => void;
  setFoldingError: (foldingError: string | null) => void;
  setFoldingStatus: (foldingStatus: string | null) => void;
  setFoldingDdG: (foldingDdG: number | null) => void;
  setFoldingEnergetics: (foldingEnergetics: any | null | ((prev: any) => any)) => void;
  setDynamut2Status: (dynamut2Status: string | null) => void;
  setDynamut2JobId: (dynamut2JobId: string | null) => void;
  setDdmutStatus: (ddmutStatus: string | null) => void;
  setDdmutJobId: (ddmutJobId: string | null) => void;
  setThermompnnStatus: (thermompnnStatus: string | null) => void;
  setThermompnnError: (thermompnnError: string | null) => void;
  setThermompnnJobId: (thermompnnJobId: string | null) => void;
  setStructuralDiff: (structuralDiff: any | null) => void;

  // Flat Comparison Setters (retained for 100% backward compatibility)
  setCompareMutantPdb: (compareMutantPdb: string | null) => void;
  setCompareFoldedResidueIndex: (compareFoldedResidueIndex: number | null) => void;
  setIsFoldingCompare: (isFoldingCompare: boolean) => void;
  setFoldingCompareError: (foldingCompareError: string | null) => void;
  setCompareFoldingStatus: (compareFoldingStatus: string | null) => void;
  setCompareFoldingDdG: (compareFoldingDdG: number | null) => void;
  setCompareFoldingEnergetics: (compareFoldingEnergetics: any | null | ((prev: any) => any)) => void;
  setCompareDynamut2Status: (compareDynamut2Status: string | null) => void;
  setCompareDynamut2JobId: (compareDynamut2JobId: string | null) => void;
  setCompareDdmutStatus: (compareDdmutStatus: string | null) => void;
  setCompareDdmutJobId: (compareDdmutJobId: string | null) => void;
  setCompareThermompnnStatus: (compareThermompnnStatus: string | null) => void;
  setCompareThermompnnError: (compareThermompnnError: string | null) => void;
  setCompareThermompnnJobId: (compareThermompnnJobId: string | null) => void;
  setCompareStructuralDiff: (compareStructuralDiff: any | null) => void;
}

export type BiophysicalSlice = BiophysicalState & BiophysicalActions;

export const createBiophysicalSlice: StateCreator<BiophysicalSlice, [], [], BiophysicalSlice> = (set) => ({
  // Sub-models
  primaryBiophysics: createInitialBiophysicsState(""),
  compareBiophysics: createInitialBiophysicsState("p.Arg408Pro"),

  // Shared
  pdbText: null,
  compareMode: false,
  compareVariant: "p.Arg408Pro",
  comparisonLayout: "split",
  computedPocket: null,
  isPocketLoading: false,
  pocketError: null,
  lastFetchedFold: "",

  // Flat Primary
  mutantPdb: null,
  foldedResidueIndex: null,
  isFolding: false,
  foldingError: null,
  foldingStatus: null,
  foldingDdG: null,
  foldingEnergetics: null,
  dynamut2Status: null,
  dynamut2JobId: null,
  ddmutStatus: null,
  ddmutJobId: null,
  thermompnnStatus: null,
  thermompnnError: null,
  thermompnnJobId: null,
  structuralDiff: null,

  // Flat Comparison
  compareMutantPdb: null,
  compareFoldedResidueIndex: null,
  isFoldingCompare: false,
  foldingCompareError: null,
  compareFoldingStatus: null,
  compareFoldingDdG: null,
  compareFoldingEnergetics: null,
  compareDynamut2Status: null,
  compareDynamut2JobId: null,
  compareDdmutStatus: null,
  compareDdmutJobId: null,
  compareThermompnnStatus: null,
  compareThermompnnError: null,
  compareThermompnnJobId: null,
  compareStructuralDiff: null,

  // Atomic Normalized Actions
  setVariantBiophysics: (isCompare, partial) => set((state) => {
    if (isCompare) {
      const updated = { ...state.compareBiophysics, ...partial };
      return {
        compareBiophysics: updated,
        ...(partial.variant !== undefined ? { compareVariant: partial.variant } : {}),
        ...(partial.mutantPdb !== undefined ? { compareMutantPdb: partial.mutantPdb } : {}),
        ...(partial.foldedResidueIndex !== undefined ? { compareFoldedResidueIndex: partial.foldedResidueIndex } : {}),
        ...(partial.isFolding !== undefined ? { isFoldingCompare: partial.isFolding } : {}),
        ...(partial.foldingError !== undefined ? { foldingCompareError: partial.foldingError } : {}),
        ...(partial.foldingStatus !== undefined ? { compareFoldingStatus: partial.foldingStatus } : {}),
        ...(partial.foldingDdG !== undefined ? { compareFoldingDdG: partial.foldingDdG } : {}),
        ...(partial.foldingEnergetics !== undefined ? { compareFoldingEnergetics: partial.foldingEnergetics } : {}),
        ...(partial.dynamut2Status !== undefined ? { compareDynamut2Status: partial.dynamut2Status } : {}),
        ...(partial.dynamut2JobId !== undefined ? { compareDynamut2JobId: partial.dynamut2JobId } : {}),
        ...(partial.ddmutStatus !== undefined ? { compareDdmutStatus: partial.ddmutStatus } : {}),
        ...(partial.ddmutJobId !== undefined ? { compareDdmutJobId: partial.ddmutJobId } : {}),
        ...(partial.thermompnnStatus !== undefined ? { compareThermompnnStatus: partial.thermompnnStatus } : {}),
        ...(partial.thermompnnError !== undefined ? { compareThermompnnError: partial.thermompnnError } : {}),
        ...(partial.thermompnnJobId !== undefined ? { compareThermompnnJobId: partial.thermompnnJobId } : {}),
        ...(partial.structuralDiff !== undefined ? { compareStructuralDiff: partial.structuralDiff } : {}),
      };
    } else {
      const updated = { ...state.primaryBiophysics, ...partial };
      return {
        primaryBiophysics: updated,
        ...(partial.variant !== undefined ? { variant: partial.variant } : {}),
        ...(partial.mutantPdb !== undefined ? { mutantPdb: partial.mutantPdb } : {}),
        ...(partial.foldedResidueIndex !== undefined ? { foldedResidueIndex: partial.foldedResidueIndex } : {}),
        ...(partial.isFolding !== undefined ? { isFolding: partial.isFolding } : {}),
        ...(partial.foldingError !== undefined ? { foldingError: partial.foldingError } : {}),
        ...(partial.foldingStatus !== undefined ? { foldingStatus: partial.foldingStatus } : {}),
        ...(partial.foldingDdG !== undefined ? { foldingDdG: partial.foldingDdG } : {}),
        ...(partial.foldingEnergetics !== undefined ? { foldingEnergetics: partial.foldingEnergetics } : {}),
        ...(partial.dynamut2Status !== undefined ? { dynamut2Status: partial.dynamut2Status } : {}),
        ...(partial.dynamut2JobId !== undefined ? { dynamut2JobId: partial.dynamut2JobId } : {}),
        ...(partial.ddmutStatus !== undefined ? { ddmutStatus: partial.ddmutStatus } : {}),
        ...(partial.ddmutJobId !== undefined ? { ddmutJobId: partial.ddmutJobId } : {}),
        ...(partial.thermompnnStatus !== undefined ? { thermompnnStatus: partial.thermompnnStatus } : {}),
        ...(partial.thermompnnError !== undefined ? { thermompnnError: partial.thermompnnError } : {}),
        ...(partial.thermompnnJobId !== undefined ? { thermompnnJobId: partial.thermompnnJobId } : {}),
        ...(partial.structuralDiff !== undefined ? { structuralDiff: partial.structuralDiff } : {}),
      };
    }
  }),

  resetBiophysics: (isCompare) => set((state) => {
    if (isCompare === undefined) {
      return {
        primaryBiophysics: createInitialBiophysicsState(""),
        compareBiophysics: createInitialBiophysicsState("p.Arg408Pro"),
        mutantPdb: null,
        foldedResidueIndex: null,
        isFolding: false,
        foldingError: null,
        foldingStatus: null,
        foldingDdG: null,
        foldingEnergetics: null,
        dynamut2Status: null,
        dynamut2JobId: null,
        ddmutStatus: null,
        ddmutJobId: null,
        thermompnnStatus: null,
        thermompnnError: null,
        thermompnnJobId: null,
        structuralDiff: null,
        compareMutantPdb: null,
        compareFoldedResidueIndex: null,
        isFoldingCompare: false,
        foldingCompareError: null,
        compareFoldingStatus: null,
        compareFoldingDdG: null,
        compareFoldingEnergetics: null,
        compareDynamut2Status: null,
        compareDynamut2JobId: null,
        compareDdmutStatus: null,
        compareDdmutJobId: null,
        compareThermompnnStatus: null,
        compareThermompnnError: null,
        compareThermompnnJobId: null,
        compareStructuralDiff: null,
      };
    } else if (isCompare) {
      return {
        compareBiophysics: createInitialBiophysicsState("p.Arg408Pro"),
        compareMutantPdb: null,
        compareFoldedResidueIndex: null,
        isFoldingCompare: false,
        foldingCompareError: null,
        compareFoldingStatus: null,
        compareFoldingDdG: null,
        compareFoldingEnergetics: null,
        compareDynamut2Status: null,
        compareDynamut2JobId: null,
        compareDdmutStatus: null,
        compareDdmutJobId: null,
        compareThermompnnStatus: null,
        compareThermompnnError: null,
        compareThermompnnJobId: null,
        compareStructuralDiff: null,
      };
    } else {
      return {
        primaryBiophysics: createInitialBiophysicsState(""),
        mutantPdb: null,
        foldedResidueIndex: null,
        isFolding: false,
        foldingError: null,
        foldingStatus: null,
        foldingDdG: null,
        foldingEnergetics: null,
        dynamut2Status: null,
        dynamut2JobId: null,
        ddmutStatus: null,
        ddmutJobId: null,
        thermompnnStatus: null,
        thermompnnError: null,
        thermompnnJobId: null,
        structuralDiff: null,
      };
    }
  }),

  // Shared Setters
  setPdbText: (pdbText) => set({ pdbText }),
  setCompareMode: (compareMode) => set({ compareMode }),
  setCompareVariant: (compareVariant) => set((state) => ({
    compareVariant,
    compareBiophysics: { ...state.compareBiophysics, variant: compareVariant }
  })),
  setComparisonLayout: (comparisonLayout) => set({ comparisonLayout }),
  setComputedPocket: (computedPocket) => set({ computedPocket }),
  setIsPocketLoading: (isPocketLoading) => set({ isPocketLoading }),
  setPocketError: (pocketError) => set({ pocketError }),
  setLastFetchedFold: (lastFetchedFold) => set({ lastFetchedFold }),

  // Primary Setters
  setMutantPdb: (mutantPdb) => set((state) => ({
    mutantPdb,
    primaryBiophysics: { ...state.primaryBiophysics, mutantPdb }
  })),
  setFoldedResidueIndex: (foldedResidueIndex) => set((state) => ({
    foldedResidueIndex,
    primaryBiophysics: { ...state.primaryBiophysics, foldedResidueIndex }
  })),
  setIsFolding: (isFolding) => set((state) => ({
    isFolding,
    primaryBiophysics: { ...state.primaryBiophysics, isFolding }
  })),
  setFoldingError: (foldingError) => set((state) => ({
    foldingError,
    primaryBiophysics: { ...state.primaryBiophysics, foldingError }
  })),
  setFoldingStatus: (foldingStatus) => set((state) => ({
    foldingStatus,
    primaryBiophysics: { ...state.primaryBiophysics, foldingStatus }
  })),
  setFoldingDdG: (foldingDdG) => set((state) => ({
    foldingDdG,
    primaryBiophysics: { ...state.primaryBiophysics, foldingDdG }
  })),
  setFoldingEnergetics: (foldingEnergetics) => set((state) => {
    const val = typeof foldingEnergetics === "function" ? foldingEnergetics(state.foldingEnergetics) : foldingEnergetics;
    return {
      foldingEnergetics: val,
      primaryBiophysics: { ...state.primaryBiophysics, foldingEnergetics: val }
    };
  }),
  setDynamut2Status: (dynamut2Status) => set((state) => ({
    dynamut2Status,
    primaryBiophysics: { ...state.primaryBiophysics, dynamut2Status }
  })),
  setDynamut2JobId: (dynamut2JobId) => set((state) => ({
    dynamut2JobId,
    primaryBiophysics: { ...state.primaryBiophysics, dynamut2JobId }
  })),
  setDdmutStatus: (ddmutStatus) => set((state) => ({
    ddmutStatus,
    primaryBiophysics: { ...state.primaryBiophysics, ddmutStatus }
  })),
  setDdmutJobId: (ddmutJobId) => set((state) => ({
    ddmutJobId,
    primaryBiophysics: { ...state.primaryBiophysics, ddmutJobId }
  })),
  setThermompnnStatus: (thermompnnStatus) => set((state) => ({
    thermompnnStatus,
    primaryBiophysics: { ...state.primaryBiophysics, thermompnnStatus }
  })),
  setThermompnnError: (thermompnnError) => set((state) => ({
    thermompnnError,
    primaryBiophysics: { ...state.primaryBiophysics, thermompnnError }
  })),
  setThermompnnJobId: (thermompnnJobId) => set((state) => ({
    thermompnnJobId,
    primaryBiophysics: { ...state.primaryBiophysics, thermompnnJobId }
  })),
  setStructuralDiff: (structuralDiff) => set((state) => ({
    structuralDiff,
    primaryBiophysics: { ...state.primaryBiophysics, structuralDiff }
  })),

  // Comparison Setters
  setCompareMutantPdb: (compareMutantPdb) => set((state) => ({
    compareMutantPdb,
    compareBiophysics: { ...state.compareBiophysics, mutantPdb: compareMutantPdb }
  })),
  setCompareFoldedResidueIndex: (compareFoldedResidueIndex) => set((state) => ({
    compareFoldedResidueIndex,
    compareBiophysics: { ...state.compareBiophysics, foldedResidueIndex: compareFoldedResidueIndex }
  })),
  setIsFoldingCompare: (isFoldingCompare) => set((state) => ({
    isFoldingCompare,
    compareBiophysics: { ...state.compareBiophysics, isFolding: isFoldingCompare }
  })),
  setFoldingCompareError: (foldingCompareError) => set((state) => ({
    foldingCompareError,
    compareBiophysics: { ...state.compareBiophysics, foldingError: foldingCompareError }
  })),
  setCompareFoldingStatus: (compareFoldingStatus) => set((state) => ({
    compareFoldingStatus,
    compareBiophysics: { ...state.compareBiophysics, foldingStatus: compareFoldingStatus }
  })),
  setCompareFoldingDdG: (compareFoldingDdG) => set((state) => ({
    compareFoldingDdG,
    compareBiophysics: { ...state.compareBiophysics, foldingDdG: compareFoldingDdG }
  })),
  setCompareFoldingEnergetics: (compareFoldingEnergetics) => set((state) => {
    const val = typeof compareFoldingEnergetics === "function" ? compareFoldingEnergetics(state.compareFoldingEnergetics) : compareFoldingEnergetics;
    return {
      compareFoldingEnergetics: val,
      compareBiophysics: { ...state.compareBiophysics, foldingEnergetics: val }
    };
  }),
  setCompareDynamut2Status: (compareDynamut2Status) => set((state) => ({
    compareDynamut2Status,
    compareBiophysics: { ...state.compareBiophysics, dynamut2Status: compareDynamut2Status }
  })),
  setCompareDynamut2JobId: (compareDynamut2JobId) => set((state) => ({
    compareDynamut2JobId,
    compareBiophysics: { ...state.compareBiophysics, dynamut2JobId: compareDynamut2JobId }
  })),
  setCompareDdmutStatus: (compareDdmutStatus) => set((state) => ({
    compareDdmutStatus,
    compareBiophysics: { ...state.compareBiophysics, ddmutStatus: compareDdmutStatus }
  })),
  setCompareDdmutJobId: (compareDdmutJobId) => set((state) => ({
    compareDdmutJobId,
    compareBiophysics: { ...state.compareBiophysics, ddmutJobId: compareDdmutJobId }
  })),
  setCompareThermompnnStatus: (compareThermompnnStatus) => set((state) => ({
    compareThermompnnStatus,
    compareBiophysics: { ...state.compareBiophysics, thermompnnStatus: compareThermompnnStatus }
  })),
  setCompareThermompnnError: (compareThermompnnError) => set((state) => ({
    compareThermompnnError,
    compareBiophysics: { ...state.compareBiophysics, thermompnnError: compareThermompnnError }
  })),
  setCompareThermompnnJobId: (compareThermompnnJobId) => set((state) => ({
    compareThermompnnJobId,
    compareBiophysics: { ...state.compareBiophysics, thermompnnJobId: compareThermompnnJobId }
  })),
  setCompareStructuralDiff: (compareStructuralDiff) => set((state) => ({
    compareStructuralDiff,
    compareBiophysics: { ...state.compareBiophysics, structuralDiff: compareStructuralDiff }
  })),

  resetViewerState: () => set({
    primaryBiophysics: createInitialBiophysicsState(""),
    compareBiophysics: createInitialBiophysicsState("p.Arg408Pro"),
    pdbText: null,
    mutantPdb: null,
    foldedResidueIndex: null,
    isFolding: false,
    foldingError: null,
    foldingStatus: null,
    foldingDdG: null,
    foldingEnergetics: null,
    dynamut2Status: null,
    compareMode: false,
    compareVariant: "p.Arg408Pro",
    compareMutantPdb: null,
    compareFoldedResidueIndex: null,
    isFoldingCompare: false,
    foldingCompareError: null,
    compareFoldingStatus: null,
    compareFoldingDdG: null,
    compareFoldingEnergetics: null,
    compareDynamut2Status: null,
    ddmutStatus: null,
    compareDdmutStatus: null,
    thermompnnStatus: null,
    compareThermompnnStatus: null,
    thermompnnError: null,
    compareThermompnnError: null,
    dynamut2JobId: null,
    compareDynamut2JobId: null,
    ddmutJobId: null,
    compareDdmutJobId: null,
    thermompnnJobId: null,
    compareThermompnnJobId: null,
    structuralDiff: null,
    compareStructuralDiff: null,
    computedPocket: null,
    isPocketLoading: false,
    pocketError: null,
    lastFetchedFold: ""
  })
});
