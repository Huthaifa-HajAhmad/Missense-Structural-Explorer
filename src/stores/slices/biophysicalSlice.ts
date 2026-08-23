import { StateCreator } from "zustand";

export interface BiophysicalState {
  pdbText: string | null;
  mutantPdb: string | null;
  foldedResidueIndex: number | null;
  isFolding: boolean;
  foldingError: string | null;
  foldingStatus: string | null;
  foldingDdG: number | null;
  foldingEnergetics: any | null;
  dynamut2Status: string | null;
  compareMode: boolean;
  compareVariant: string;
  compareMutantPdb: string | null;
  compareFoldedResidueIndex: number | null;
  isFoldingCompare: boolean;
  foldingCompareError: string | null;
  compareFoldingStatus: string | null;
  compareFoldingDdG: number | null;
  compareFoldingEnergetics: any | null;
  comparisonLayout: "split" | "overlay";
  compareDynamut2Status: string | null;
  ddmutStatus: string | null;
  compareDdmutStatus: string | null;
  thermompnnStatus: string | null;
  compareThermompnnStatus: string | null;
  thermompnnError: string | null;
  compareThermompnnError: string | null;
  dynamut2JobId: string | null;
  compareDynamut2JobId: string | null;
  ddmutJobId: string | null;
  compareDdmutJobId: string | null;
  thermompnnJobId: string | null;
  compareThermompnnJobId: string | null;
  structuralDiff: any | null;
  compareStructuralDiff: any | null;
  computedPocket: any | null;
  isPocketLoading: boolean;
  pocketError: string | null;
  lastFetchedFold: string;
}

export interface BiophysicalActions {
  setPdbText: (pdbText: string | null) => void;
  setMutantPdb: (mutantPdb: string | null) => void;
  setFoldedResidueIndex: (foldedResidueIndex: number | null) => void;
  setIsFolding: (isFolding: boolean) => void;
  setFoldingError: (foldingError: string | null) => void;
  setFoldingStatus: (foldingStatus: string | null) => void;
  setFoldingDdG: (foldingDdG: number | null) => void;
  setFoldingEnergetics: (foldingEnergetics: any | null | ((prev: any) => any)) => void;
  setDynamut2Status: (dynamut2Status: string | null) => void;
  setCompareMode: (compareMode: boolean) => void;
  setCompareVariant: (compareVariant: string) => void;
  setCompareMutantPdb: (compareMutantPdb: string | null) => void;
  setCompareFoldedResidueIndex: (compareFoldedResidueIndex: number | null) => void;
  setIsFoldingCompare: (isFoldingCompare: boolean) => void;
  setFoldingCompareError: (foldingCompareError: string | null) => void;
  setCompareFoldingStatus: (compareFoldingStatus: string | null) => void;
  setCompareFoldingDdG: (compareFoldingDdG: number | null) => void;
  setCompareFoldingEnergetics: (compareFoldingEnergetics: any | null | ((prev: any) => any)) => void;
  setComparisonLayout: (comparisonLayout: "split" | "overlay") => void;
  setCompareDynamut2Status: (compareDynamut2Status: string | null) => void;
  setDdmutStatus: (ddmutStatus: string | null) => void;
  setCompareDdmutStatus: (compareDdmutStatus: string | null) => void;
  setThermompnnStatus: (thermompnnStatus: string | null) => void;
  setCompareThermompnnStatus: (compareThermompnnStatus: string | null) => void;
  setThermompnnError: (thermompnnError: string | null) => void;
  setCompareThermompnnError: (compareThermompnnError: string | null) => void;
  setDynamut2JobId: (dynamut2JobId: string | null) => void;
  setCompareDynamut2JobId: (compareDynamut2JobId: string | null) => void;
  setDdmutJobId: (ddmutJobId: string | null) => void;
  setCompareDdmutJobId: (compareDdmutJobId: string | null) => void;
  setThermompnnJobId: (thermompnnJobId: string | null) => void;
  setCompareThermompnnJobId: (compareThermompnnJobId: string | null) => void;
  setStructuralDiff: (structuralDiff: any | null) => void;
  setCompareStructuralDiff: (compareStructuralDiff: any | null) => void;
  setComputedPocket: (computedPocket: any | null) => void;
  setIsPocketLoading: (isPocketLoading: boolean) => void;
  setPocketError: (pocketError: string | null) => void;
  setLastFetchedFold: (lastFetchedFold: string) => void;
  resetViewerState: () => void;
}

export type BiophysicalSlice = BiophysicalState & BiophysicalActions;

export const createBiophysicalSlice: StateCreator<BiophysicalSlice, [], [], BiophysicalSlice> = (set) => ({
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
  comparisonLayout: "split",
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
  lastFetchedFold: "",

  setPdbText: (pdbText) => set({ pdbText }),
  setMutantPdb: (mutantPdb) => set({ mutantPdb }),
  setFoldedResidueIndex: (foldedResidueIndex) => set({ foldedResidueIndex }),
  setIsFolding: (isFolding) => set({ isFolding }),
  setFoldingError: (foldingError) => set({ foldingError }),
  setFoldingStatus: (foldingStatus) => set({ foldingStatus }),
  setFoldingDdG: (foldingDdG) => set({ foldingDdG }),
  setFoldingEnergetics: (foldingEnergetics) =>
    set((state) => ({
      foldingEnergetics: typeof foldingEnergetics === "function" ? foldingEnergetics(state.foldingEnergetics) : foldingEnergetics
    })),
  setDynamut2Status: (dynamut2Status) => set({ dynamut2Status }),
  setCompareMode: (compareMode) => set({ compareMode }),
  setCompareVariant: (compareVariant) => set({ compareVariant }),
  setCompareMutantPdb: (compareMutantPdb) => set({ compareMutantPdb }),
  setCompareFoldedResidueIndex: (compareFoldedResidueIndex) => set({ compareFoldedResidueIndex }),
  setIsFoldingCompare: (isFoldingCompare) => set({ isFoldingCompare }),
  setFoldingCompareError: (foldingCompareError) => set({ foldingCompareError }),
  setCompareFoldingStatus: (compareFoldingStatus) => set({ compareFoldingStatus }),
  setCompareFoldingDdG: (compareFoldingDdG) => set({ compareFoldingDdG }),
  setCompareFoldingEnergetics: (compareFoldingEnergetics) =>
    set((state) => ({
      compareFoldingEnergetics: typeof compareFoldingEnergetics === "function" ? compareFoldingEnergetics(state.compareFoldingEnergetics) : compareFoldingEnergetics
    })),
  setComparisonLayout: (comparisonLayout) => set({ comparisonLayout }),
  setCompareDynamut2Status: (compareDynamut2Status) => set({ compareDynamut2Status }),
  setDdmutStatus: (ddmutStatus) => set({ ddmutStatus }),
  setCompareDdmutStatus: (compareDdmutStatus) => set({ compareDdmutStatus }),
  setThermompnnStatus: (thermompnnStatus) => set({ thermompnnStatus }),
  setCompareThermompnnStatus: (compareThermompnnStatus) => set({ compareThermompnnStatus }),
  setThermompnnError: (thermompnnError) => set({ thermompnnError }),
  setCompareThermompnnError: (compareThermompnnError) => set({ compareThermompnnError }),
  setDynamut2JobId: (dynamut2JobId) => set({ dynamut2JobId }),
  setCompareDynamut2JobId: (compareDynamut2JobId) => set({ compareDynamut2JobId }),
  setDdmutJobId: (ddmutJobId) => set({ ddmutJobId }),
  setCompareDdmutJobId: (compareDdmutJobId) => set({ compareDdmutJobId }),
  setThermompnnJobId: (thermompnnJobId) => set({ thermompnnJobId }),
  setCompareThermompnnJobId: (compareThermompnnJobId) => set({ compareThermompnnJobId }),
  setStructuralDiff: (structuralDiff) => set({ structuralDiff }),
  setCompareStructuralDiff: (compareStructuralDiff) => set({ compareStructuralDiff }),
  setComputedPocket: (computedPocket) => set({ computedPocket }),
  setIsPocketLoading: (isPocketLoading) => set({ isPocketLoading }),
  setPocketError: (pocketError) => set({ pocketError }),
  setLastFetchedFold: (lastFetchedFold) => set({ lastFetchedFold }),

  resetViewerState: () => set({
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
