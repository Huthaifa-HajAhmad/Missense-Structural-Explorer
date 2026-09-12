/**
 * Normalized Domain State Models for Variant Analysis Store
 */

export interface VariantBiophysicsState {
  variant: string;
  mutantPdb: string | null;
  foldedResidueIndex: number | null;
  isFolding: boolean;
  foldingError: string | null;
  foldingStatus: string | null;
  foldingDdG: number | null;
  foldingEnergetics: any | null;
  structuralDiff: any | null;
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
