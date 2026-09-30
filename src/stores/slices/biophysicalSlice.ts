import { StateCreator } from "zustand";
import { VariantBiophysicsState, createInitialBiophysicsState } from "../models";
import type { PocketResult, EnergeticsData, StructuralDiffResult } from "../../types";
import type { StructureProvenance } from "../../shared/contracts";
import type { FoldxProgress } from "../../shared/foldxPhase";

export interface FoldxReferenceState {
  state: "idle" | "loading" | "ready" | "unavailable";
  reason: string | null;
  provenance: StructureProvenance | null;
  /**
   * Which coordinates the variant is measured against: FoldX's own paired wild type from the same
   * run, or the template re-fetched from the resolver (results cached before the pair was kept).
   */
  basis?: "foldx-paired" | "template" | null;
}

export const IDLE_FOLDX_REFERENCE: FoldxReferenceState = { state: "idle", reason: null, provenance: null, basis: null };

export interface BiophysicalState {
  // Normalized Sub-State Models
  primaryBiophysics: VariantBiophysicsState;

  // Shared / Global Viewer State
  pdbText: string | null;
  /**
   * Where `pdbText` came from — the wild type the AlphaFold view draws.
   *
   * A single `structureProvenance` field used to be written by both the structure fetch and the
   * FoldX run (with its template), last writer wins, so the toolbar labelled the AlphaFold model
   * "RCSB PDB: 1YOV" once FoldX finished on 1YOV. That field is gone: this one describes `pdbText`,
   * and FoldX's template lives on `foldingEnergetics.structureProvenance`.
   */
  pdbTextProvenance: StructureProvenance | null;
  /**
   * The coordinates FoldX built its variant on, fetched so the superposition pairs the variant with
   * its OWN template. Overlaying it on the AlphaFold model instead measured AlphaFold-versus-crystal
   * differences and reported them as the substitution's effect.
   */
  foldxReferencePdb: string | null;
  foldxReference: FoldxReferenceState;
  /**
   * FoldX BuildModel's own wild type for the variant's run (`WT_wt_1_0.pdb`): the repaired template
   * with its side chains repacked alongside the variant's. The superposition prefers it to a
   * re-fetched template, whose differences from the variant include every change RepairPDB made.
   */
  foldxWtPdb: string | null;
  /** The FoldX variant after superposition on `foldxReferencePdb`; its B column holds Cα displacement (Å). */
  foldxAlignedPdb: string | null;
  computedPocket: PocketResult | null;
  isPocketLoading: boolean;
  pocketError: string | null;
  lastFetchedFold: string;

  // Flat Primary Variant Properties (retained for 100% backward compatibility)
  /** @deprecated Use granular selectors on primaryBiophysics, e.g. s => s.primaryBiophysics.mutantPdb */
  mutantPdb: string | null;
  /** @deprecated Use primaryBiophysics.foldedResidueIndex */
  foldedResidueIndex: number | null;
  /** @deprecated Use primaryBiophysics.isFolding */
  isFolding: boolean;
  /** @deprecated Use primaryBiophysics.foldingProgress */
  foldingProgress: FoldxProgress | null;
  /** @deprecated Use primaryBiophysics.foldingError */
  foldingError: string | null;
  /** @deprecated Use primaryBiophysics.foldingStatus */
  foldingStatus: string | null;
  /** @deprecated Use primaryBiophysics.foldingDdG */
  foldingDdG: number | null;
  /** @deprecated Use primaryBiophysics.foldingEnergetics */
  foldingEnergetics: EnergeticsData | null;
  /** @deprecated Use primaryBiophysics.dynamut2Status */
  dynamut2Status: string | null;
  /** @deprecated Use primaryBiophysics.dynamut2JobId */
  dynamut2JobId: string | null;
  /** @deprecated Use primaryBiophysics.ddmutStatus */
  ddmutStatus: string | null;
  /** @deprecated Use primaryBiophysics.ddmutJobId */
  ddmutJobId: string | null;
  /** @deprecated Use primaryBiophysics.thermompnnStatus */
  thermompnnStatus: string | null;
  /** @deprecated Use primaryBiophysics.thermompnnError */
  thermompnnError: string | null;
  /** @deprecated Use primaryBiophysics.thermompnnJobId */
  thermompnnJobId: string | null;
  /** @deprecated Use primaryBiophysics.structuralDiff */
  structuralDiff: StructuralDiffResult | null;

  // Flat Comparison Variant Properties (retained for 100% backward compatibility)
}

export interface BiophysicalActions {
  // Normalized Atomic Actions
  setVariantBiophysics: (partial: Partial<VariantBiophysicsState>, targetVariant?: string) => void;
  resetBiophysics: () => void;

  // Shared / Global Setters
  setPdbText: (pdbText: string | null) => void;
  setPdbTextProvenance: (pdbTextProvenance: StructureProvenance | null) => void;
  setFoldxReference: (reference: FoldxReferenceState, referencePdb?: string | null) => void;
  setFoldxWtPdb: (pdb: string | null) => void;
  setFoldxAlignedPdb: (foldxAlignedPdb: string | null) => void;
  setComputedPocket: (computedPocket: PocketResult | null) => void;
  setIsPocketLoading: (isPocketLoading: boolean) => void;
  setPocketError: (pocketError: string | null) => void;
  setLastFetchedFold: (lastFetchedFold: string) => void;
  resetViewerState: () => void;

  // Flat Primary Setters (retained for 100% backward compatibility)
  setMutantPdb: (mutantPdb: string | null) => void;
  setFoldedResidueIndex: (foldedResidueIndex: number | null) => void;
  setIsFolding: (isFolding: boolean) => void;
  setFoldingProgress: (foldingProgress: FoldxProgress | null) => void;
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
}

export type BiophysicalSlice = BiophysicalState & BiophysicalActions;

export const createBiophysicalSlice: StateCreator<BiophysicalSlice, [], [], BiophysicalSlice> = (set) => ({
  // Sub-models
  primaryBiophysics: createInitialBiophysicsState(""),

  // Shared
  pdbText: null,
  pdbTextProvenance: null,
  foldxReferencePdb: null,
  foldxReference: IDLE_FOLDX_REFERENCE,
  foldxWtPdb: null,
  foldxAlignedPdb: null,
  computedPocket: null,
  isPocketLoading: false,
  pocketError: null,
  lastFetchedFold: "",

  // Flat Primary
  mutantPdb: null,
  foldedResidueIndex: null,
  isFolding: false,
  foldingProgress: null,
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

  // Atomic Normalized Actions
  setVariantBiophysics: (partial, targetVariant) => set((state: any) => {
    const activeVariant = state.variant || state.primaryBiophysics?.variant;
    if (targetVariant && activeVariant && targetVariant !== activeVariant) {
      return state;
    }
    const updated = { ...state.primaryBiophysics, ...partial };
    return {
      primaryBiophysics: updated,
      ...(partial.variant !== undefined ? { variant: partial.variant } : {}),
      ...(partial.mutantPdb !== undefined ? { mutantPdb: partial.mutantPdb } : {}),
      ...(partial.foldedResidueIndex !== undefined ? { foldedResidueIndex: partial.foldedResidueIndex } : {}),
      ...(partial.isFolding !== undefined ? { isFolding: partial.isFolding } : {}),
      ...(partial.foldingProgress !== undefined ? { foldingProgress: partial.foldingProgress } : {}),
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
  }),

  resetBiophysics: () => set({
    primaryBiophysics: createInitialBiophysicsState(""),
    mutantPdb: null,
    foldxWtPdb: null,
    foldedResidueIndex: null,
    isFolding: false,
    foldingProgress: null,
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
  }),

  // Shared Setters
  setPdbText: (pdbText) => set({ pdbText }),
  setPdbTextProvenance: (pdbTextProvenance) => set({ pdbTextProvenance }),
  setFoldxReference: (foldxReference, referencePdb) =>
    set(referencePdb === undefined ? { foldxReference } : { foldxReference, foldxReferencePdb: referencePdb }),
  setFoldxWtPdb: (foldxWtPdb) => set({ foldxWtPdb }),
  setFoldxAlignedPdb: (foldxAlignedPdb) => set({ foldxAlignedPdb }),
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
    /**
     * The flag and the progress object move together.
     *
     * `isFolding` is the run's lifecycle; `foldingProgress` is its address. Clearing the flag while
     * the last phase stays on screen is the contradiction this pairing removes: a finished run can
     * never render "Structure repair" beside a result.
     */
    ...(isFolding ? {} : { foldingProgress: null }),
    primaryBiophysics: {
      ...state.primaryBiophysics,
      isFolding,
      ...(isFolding ? {} : { foldingProgress: null })
    }
  })),
  setFoldingProgress: (foldingProgress) => set((state) => ({
    foldingProgress,
    primaryBiophysics: { ...state.primaryBiophysics, foldingProgress }
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

  resetViewerState: () => set({
    primaryBiophysics: createInitialBiophysicsState(""),
    pdbText: null,
    pdbTextProvenance: null,
    foldxReferencePdb: null,
    foldxReference: IDLE_FOLDX_REFERENCE,
    foldxWtPdb: null,
    foldxAlignedPdb: null,
    mutantPdb: null,
    foldedResidueIndex: null,
    isFolding: false,
    foldingProgress: null,
    foldingError: null,
    foldingStatus: null,
    foldingDdG: null,
    foldingEnergetics: null,
    dynamut2Status: null,
    ddmutStatus: null,
    thermompnnStatus: null,
    thermompnnError: null,
    dynamut2JobId: null,
    ddmutJobId: null,
    thermompnnJobId: null,
    structuralDiff: null,
    computedPocket: null,
    isPocketLoading: false,
    pocketError: null,
    lastFetchedFold: ""
  })
});
