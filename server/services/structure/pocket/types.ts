import { type SelectablePocket } from "./selection.ts";

/**
 * Shape of a pocket result, including which quantity each ambiguous field carries.
 *
 * `cavityCentreDistance` is optional because only P2Rank reports a cavity centre;
 * the fpocket path leaves it null and the client then falls back to
 * `pocketDistance` and says so. `provenance` is what lets the client decide
 * whether it may print a unit or a probability label.
 */
export interface PocketInfoResult {
  pocketResidues: any[];
  pocketScore: number;
  pocketVolume: number;
  likelyCofactor: string;
  status: "success" | "fallback" | "none_detected" | "unavailable";
  pocketDistance?: number | null;
  sasPoints?: number;
  surfaceAtoms?: number;
  cavityCentreDistance?: number | null;
  provenance?: {
    engine: "p2rank" | "fpocket";
    scoreSource: "probability" | "rescaled_raw_score" | "unavailable";
    volumeSource: "measured" | "unavailable";
    profile?: string;
  };
}

/** A pocket detected by either engine, in the shape the shared selection rule consumes. */
export interface DetectedPocket extends SelectablePocket {
  score: number;
  probability: number;
  sasPoints?: number;
  surfaceAtoms?: number;
  volume: number;
}

/** The 0–100 score and the volume of a pocket, each with the provenance the client needs to label it. */
export interface ScoreAndVolume {
  pocketScore: number;
  pocketScoreSource: "probability" | "rescaled_raw_score" | "unavailable";
  pocketVolume: number;
  pocketVolumeSource: "measured" | "unavailable";
}

/** The files one pocket run reads and writes. */
export interface JobPaths {
  jobDir: string;
  pdbPath: string;
  outDir: string;
}
