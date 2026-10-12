/**
 * foldx/estimate.ts — how long a FoldX job is expected to take on THIS host, before it runs.
 *
 * Used when the job is queued, so the queue can say how long the people behind it will wait
 * (`SQLiteQueue.getEta`). It is the WP-C prior (`foldxPriorP50Ms`) fed with the same three facts the
 * runner itself uses to plan the job: residue count, whether RepairPDB applies, and whether FoldX runs
 * under Box64 emulation. The runner imports `isAlphaFoldModel` from here so the two cannot disagree.
 */
import { foldxPriorP50Ms, foldxRepairApplies } from "../../../../src/shared/computeRouting.ts";
import { detectBFactorProvenance } from "./pdb-utils.ts";
import { getFoldxExecutionTarget } from "./detector.ts";

/** The runner skips RepairPDB on predicted models; see the rationale where it is applied (runner.ts). */
export function isAlphaFoldModel(pdb: string): boolean {
  return /ALPHAFOLD|DBREF.*AF\-/i.test(pdb) ||
    /^REMARK.*ALPHAFOLD/mi.test(pdb) ||
    /^HEADER.*PREDICTED/mi.test(pdb) ||
    detectBFactorProvenance(pdb).source === "alphafold";
}

/** Distinct residues with a CA atom (chain + number + insertion code), as FoldX sees them. */
export function countResidues(pdb: string): number {
  const seen = new Set<string>();
  for (const line of pdb.split("\n")) {
    if (line.startsWith("ATOM") && line.slice(12, 16).trim() === "CA") seen.add(line.slice(21, 27));
  }
  return seen.size;
}

/** True when FoldX runs under Box64 here (the ARM server), which is ~60x slower than native. */
export function foldxRunsEmulated(): boolean {
  return getFoldxExecutionTarget("foldx", []).file !== "foldx";
}

/** Prior p50 in ms for a FoldX BuildModel job (5 runs) on this structure, or null when it cannot tell. */
export function foldxQueueCostEstimateMs(wtPdb: string, numberOfRuns = 5): number | null {
  try {
    const residues = countResidues(wtPdb);
    if (residues === 0) return null;
    const repair = foldxRepairApplies(residues, isAlphaFoldModel(wtPdb));
    return foldxPriorP50Ms({ residues, numberOfRuns, repair }, foldxRunsEmulated());
  } catch {
    return null;
  }
}
