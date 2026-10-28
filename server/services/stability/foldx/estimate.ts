/**
 * foldx/estimate.ts — how long a FoldX job is expected to take on THIS host, before it runs.
 *
 * Used when the job is queued, so the queue can say how long the people behind it will wait
 * (`SQLiteQueue.getEta`). It is the WP-C prior (`foldxPriorP50Ms`) fed with the same three facts the
 * runner itself uses to plan the job: residue count, whether RepairPDB applies, and whether FoldX runs
 * under Box64 emulation. The runner imports `isAlphaFoldModel` from here so the two cannot disagree.
 */
import { foldxPriorP50Ms, foldxRepairApplies } from "../../../../src/shared/computeRouting.ts";
import { cleanPdbForFoldX, countIncompleteResidues, detectBFactorProvenance } from "./pdb-utils.ts";
import { repairFitsBudget } from "./budget.ts";
import { getFoldxExecutionTarget } from "./detector.ts";

/** The runner skips RepairPDB on predicted models; see the rationale where it is applied (runner.ts). */
export function isAlphaFoldModel(pdb: string): boolean {
  /**
   * An experimental method record decides first — the same rule `detectBFactorProvenance` applies.
   * Without it, a genuine X-ray entry whose REMARK 3 says "MODEL USED FOR MOLECULAR REPLACEMENT:
   * ALPHAFOLD" (routine since 2021) matched the bare `ALPHAFOLD` substring below and skipped
   * RepairPDB again. Real AlphaFold DB files carry no EXPDTA record, so this cannot misfile them.
   */
  if (/^EXPDTA\s+\S/m.test(pdb)) return false;
  return /DBREF.*\bAF-[A-Z0-9]+-F\d/i.test(pdb) ||
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

/** True when FoldX runs under Box64 here (the ARM server), which measured 3-6x slower than native (see budget.ts). */
export function foldxRunsEmulated(): boolean {
  return getFoldxExecutionTarget("foldx", []).file !== "foldx";
}

/** Prior p50 in ms for a FoldX BuildModel job (5 runs) on this structure, or null when it cannot tell. */
export function foldxQueueCostEstimateMs(wtPdb: string, numberOfRuns = 5): number | null {
  try {
    const residues = countResidues(wtPdb);
    if (residues === 0) return null;
    const emulated = foldxRunsEmulated();
    // The runner does not start a RepairPDB that cannot finish in its cap, so the estimate must not charge for one.
    const repair = foldxRepairApplies(residues, isAlphaFoldModel(wtPdb)) &&
      repairFitsBudget({ residueCount: residues, incompleteResidues: countIncompleteResidues(cleanPdbForFoldX(wtPdb)), emulated });
    return foldxPriorP50Ms({ residues, numberOfRuns, repair }, emulated);
  } catch {
    return null;
  }
}
