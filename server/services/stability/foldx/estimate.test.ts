import { describe, it, expect } from "vitest";
import { countResidues, foldxQueueCostEstimateMs, foldxRunsEmulated, isAlphaFoldModel } from "./estimate.ts";
import { foldxPriorP50Ms } from "../../../../src/shared/computeRouting.ts";
import { repairFitsBudget } from "./budget.ts";
import { cleanPdbForFoldX, countIncompleteResidues } from "./pdb-utils.ts";

/** A minimal PDB with `n` residues, each a CA (and an N, which must not double-count). */
function pdb(n: number, header = ""): string {
  const lines = header ? [header] : [];
  for (let i = 1; i <= n; i++) {
    const num = String(i).padStart(4);
    lines.push(`ATOM  ${String(2 * i - 1).padStart(5)}  N   ALA A${num}       0.000   0.000   0.000  1.00 90.00           N`);
    lines.push(`ATOM  ${String(2 * i).padStart(5)}  CA  ALA A${num}       1.000   0.000   0.000  1.00 90.00           C`);
  }
  return lines.join("\n") + "\nEND\n";
}

describe("FoldX queue cost estimate", () => {
  it("counts residues by CA, once each", () => {
    expect(countResidues(pdb(154))).toBe(154);
    expect(countResidues("HEADER nothing\nEND\n")).toBe(0);
  });

  it("is the WP-C prior for the structure's size and repair rule", () => {
    const est = foldxQueueCostEstimateMs(pdb(154))!;
    // Whatever this machine is (native here, Box64 on the ARM server), the estimate uses the same flag.
    // The fixture's residues are N + CA only, i.e. all incomplete: under Box64 that is a repair the runner would not start.
    const repair = !isAlphaFoldModel(pdb(154)) &&
      repairFitsBudget({ residueCount: 154, incompleteResidues: countIncompleteResidues(cleanPdbForFoldX(pdb(154))), emulated: foldxRunsEmulated() });
    expect(est).toBe(foldxPriorP50Ms({ residues: 154, numberOfRuns: 5, repair }, foldxRunsEmulated()));
    expect(est).toBeGreaterThan(0);
  });

  it("has no estimate for a structure with no residues", () => {
    expect(foldxQueueCostEstimateMs("END\n")).toBeNull();
  });

  it("recognises an AlphaFold model the way the runner does", () => {
    expect(isAlphaFoldModel(pdb(5, "REMARK   1 ALPHAFOLD MODEL"))).toBe(true);
    // A crystal entry is repaired: its "MODEL" refinement remark and sub-100 B-factors are not pLDDT.
    expect(isAlphaFoldModel(pdb(5, "EXPDTA    X-RAY DIFFRACTION\nREMARK   3  REFINEMENT MODEL : RESTRAINED"))).toBe(false);
  });

  it("keeps an X-ray entry experimental even when its remarks cite AlphaFold for molecular replacement", () => {
    // Routine since 2021: a crystal solved by MR against an AlphaFold model names it in REMARK 3.
    // The bare substring test called this an AlphaFold model and skipped RepairPDB again.
    const crystal = pdb(5, "EXPDTA    X-RAY DIFFRACTION\nREMARK   3  MODEL USED FOR MOLECULAR REPLACEMENT: ALPHAFOLD");
    expect(isAlphaFoldModel(crystal)).toBe(false);
    // ...while a real predicted model (no EXPDTA) is still recognised.
    expect(isAlphaFoldModel(pdb(5, "TITLE     ALPHAFOLD MONOMER V2.0 PREDICTION"))).toBe(true);
  });
});
