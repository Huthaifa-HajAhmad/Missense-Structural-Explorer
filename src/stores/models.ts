/**
 * Normalized Domain State Models for Variant Analysis Store
 */

import type { EnergeticsData, StructuralDiffResult } from "../types";
import type { FoldxProgress } from "../shared/foldxPhase";

export interface VariantBiophysicsState {
  variant: string;
  mutantPdb: string | null;
  foldedResidueIndex: number | null;
  isFolding: boolean;
  /**
   * What the FoldX worker is doing, and for how long, as reported by the server.
   *
   * One object rather than four sibling fields so a surface cannot pair a phase with an elapsed
   * time from a different run; `null` whenever no FoldX run is in flight.
   */
  foldingProgress: FoldxProgress | null;
  foldingError: string | null;
  foldingStatus: string | null;
  foldingDdG: number | null;
  foldingEnergetics: EnergeticsData | null;
  structuralDiff: StructuralDiffResult | null;
  dynamut2Status: string | null;
  dynamut2JobId: string | null;
  ddmutStatus: string | null;
  ddmutJobId: string | null;
  thermompnnStatus: string | null;
  thermompnnError: string | null;
  thermompnnJobId: string | null;
}

export const createInitialBiophysicsState = (variant = ""): VariantBiophysicsState => ({
  variant,
  mutantPdb: null,
  foldedResidueIndex: null,
  isFolding: false,
  foldingProgress: null,
  foldingError: null,
  foldingStatus: null,
  foldingDdG: null,
  foldingEnergetics: null,
  structuralDiff: null,
  dynamut2Status: null,
  dynamut2JobId: null,
  ddmutStatus: null,
  ddmutJobId: null,
  thermompnnStatus: null,
  thermompnnError: null,
  thermompnnJobId: null,
});
