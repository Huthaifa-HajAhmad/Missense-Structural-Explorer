/**
 * state.ts — Shared mutable server state and type definitions.
 *
 * Extracted here to break the circular import chain:
 *   routes.ts → routes/index.ts → routes/variant.ts → routes.ts  (CIRCULAR)
 *
 * Now both routes.ts and route modules import from here instead.
 */

export interface FoldXResult {
  pdb: string;
  ddG: number | null;
  status: string;
  foldedResidueIndex: number;
  resolvedChain?: string;
  energetics?: {
    foldxMean: number | null;
    foldxSd: number | null;
    foldx: number | null;
    dynamut2: number | null;
    ddmut: number | null;
    rasp: number | null;
    thermompnn: number | null;
    vdw: number | null;
    electrostatics: number | null;
    rawDdGs: number[];
    stericClashWarning: boolean;
    localSidechainRmsd: number | null;
    consensusVerdict: string | null;
  } | null;
}

export interface BackgroundTask {
  id: string;
  controller: AbortController;
  promise: Promise<any>;
}

export const activeBackgroundTasks: BackgroundTask[] = [];
export const inFlightPrewarms = new Set<string>();
