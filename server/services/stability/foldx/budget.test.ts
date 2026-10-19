import { describe, expect, it } from "vitest";
import { backgroundRepairBudgetMs, buildModelBudgetMs, clampToJobRemaining, emulatedRepairResidueLimit, predictedRepairMs, repairFitsBudget } from "./budget.ts";
import { CONFIG } from "../../../config.ts";

const T = {
  foldxBuildModelMs: 180_000,
  foldxBuildModelMaxMs: 600_000,
  foldxEmulatedFixedMs: 15_000,
  foldxEmulatedMsPerResidueRun: 90,
  foldxEmulatedMsPerIncompleteResidue: 5_000,
  foldxRepairMs: 420_000,
  foldxEmulatedRepairMsPerResidue: 1_800,
  foldxBackgroundRepairMaxMs: 1_500_000,
};

/** What this budget replaced (constants as shipped before 2026-10-17, no incomplete-residue term). */
const OLD_T = { ...T, foldxEmulatedMsPerResidueRun: 30 };

/**
 * The OCI host (2 vCPU Neoverse-N1, Box64 0.4.4, FoldX 5.1), 5-run BuildModel in seconds, n = 3 per cell
 * (n = 2 for the Q867K and K750A rows), CV <= 1%, no throttling, steal 0.2%. See budget.ts.
 */
const MEASURED_5_RUN: Array<{ what: string; residues: number; incomplete: number; seconds: number }> = [
  { what: "CNNM2 6N7E S489C, unrepaired", residues: 305, incomplete: 44, seconds: 213.7 },
  { what: "CNNM2 6N7E S489C, repaired", residues: 305, incomplete: 0, seconds: 7.47 },
  { what: "SOD1 AlphaFold A5V", residues: 154, incomplete: 0, seconds: 10.02 },
  { what: "p53 AlphaFold R175H", residues: 393, incomplete: 0, seconds: 173.25 },
  { what: "CNNM2 AlphaFold S489C", residues: 875, incomplete: 0, seconds: 21.8 },
  { what: "SLC12A4 AlphaFold Q867H", residues: 1085, incomplete: 0, seconds: 169.75 },
  { what: "SLC12A4 AlphaFold K750A", residues: 1085, incomplete: 0, seconds: 294.46 },
  { what: "SLC12A4 AlphaFold Q867K", residues: 1085, incomplete: 0, seconds: 386.4 },
];

describe("buildModelBudgetMs", () => {
  it("keeps the flat cap on a native host, whatever the size", () => {
    expect(buildModelBudgetMs({ residueCount: 2000, numberOfRuns: 5, emulated: false }, T)).toBe(180_000);
    expect(buildModelBudgetMs({ residueCount: 305, numberOfRuns: 5, emulated: false, incompleteResidues: 44 }, T)).toBe(180_000);
  });

  it("gives every measured run at least 1.5x its measured time", () => {
    for (const m of MEASURED_5_RUN) {
      const budget = buildModelBudgetMs({ residueCount: m.residues, numberOfRuns: 5, emulated: true, incompleteResidues: m.incomplete }, T) / 1000;
      expect(budget / m.seconds, `${m.what}: ${budget} s budget for a ${m.seconds} s run`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("would have killed the two measured runs the previous constants could not hold", () => {
    // 6N7E unrepaired took 213.7 s against a 180 s cap (the production incident); SLC12A4 Q867K took 386 s
    // against a 355.5 s cap. Both are the reason the constants moved.
    expect(buildModelBudgetMs({ residueCount: 305, numberOfRuns: 5, emulated: true }, OLD_T)).toBe(180_000);
    expect(buildModelBudgetMs({ residueCount: 1085, numberOfRuns: 5, emulated: true }, OLD_T)).toBe(355_500);
    expect(buildModelBudgetMs({ residueCount: 305, numberOfRuns: 5, emulated: true, incompleteResidues: 44 }, T)).toBe(600_000);
  });

  it("charges for the side chains FoldX rebuilds, and not for a repaired template", () => {
    // Sized so neither budget meets the floor or the ceiling and the difference is the incomplete-residue term.
    const repaired = buildModelBudgetMs({ residueCount: 300, numberOfRuns: 5, emulated: true, incompleteResidues: 0 }, T);
    const unrepaired = buildModelBudgetMs({ residueCount: 300, numberOfRuns: 5, emulated: true, incompleteResidues: 10 }, T);
    expect(unrepaired - repaired).toBe(2 * 10 * 5_000);
  });

  it("never drops below the native floor for small emulated structures", () => {
    expect(buildModelBudgetMs({ residueCount: 154, numberOfRuns: 5, emulated: true }, T)).toBe(180_000);
  });

  it("is clamped to the ceiling so the job still fits its whole-job cap", () => {
    expect(buildModelBudgetMs({ residueCount: 5000, numberOfRuns: 5, emulated: true }, T)).toBe(600_000);
    expect(buildModelBudgetMs({ residueCount: 400, numberOfRuns: 5, emulated: true, incompleteResidues: 400 }, T)).toBe(600_000);
  });

  it("ships the constants the test above is written against", () => {
    expect(CONFIG.timeouts).toMatchObject({
      foldxEmulatedFixedMs: T.foldxEmulatedFixedMs,
      foldxEmulatedMsPerResidueRun: T.foldxEmulatedMsPerResidueRun,
      foldxEmulatedMsPerIncompleteResidue: T.foldxEmulatedMsPerIncompleteResidue,
      foldxEmulatedRepairMsPerResidue: T.foldxEmulatedRepairMsPerResidue,
    });
  });
});

describe("repair gate under emulation", () => {
  // RepairPDB wall seconds measured under Box64: SOD1 272.5 (154 residues), p53 456.5 (393), 6N7E 659.8 (305, 44 incomplete).
  const REPAIR_MEASURED = [
    { residues: 154, incomplete: 0, seconds: 272.5 },
    { residues: 393, incomplete: 0, seconds: 456.5 },
    { residues: 305, incomplete: 44, seconds: 659.8 },
  ];

  it("is an envelope: it predicts no measured repair as faster than it was", () => {
    for (const m of REPAIR_MEASURED) {
      expect(predictedRepairMs({ residueCount: m.residues, incompleteResidues: m.incomplete }, T) / 1000).toBeGreaterThanOrEqual(m.seconds);
    }
  });

  it("starts the repair that fits its cap and skips the two that did not", () => {
    const fits = (m: (typeof REPAIR_MEASURED)[number]) => repairFitsBudget({ residueCount: m.residues, incompleteResidues: m.incomplete, emulated: true }, T);
    expect(fits(REPAIR_MEASURED[0])).toBe(true); // 272 s against a 420 s cap
    expect(fits(REPAIR_MEASURED[1])).toBe(false); // 456 s
    expect(fits(REPAIR_MEASURED[2])).toBe(false); // 660 s: the production incident
  });

  it("never gates a native host (6N7E repaired in 205 s there)", () => {
    expect(repairFitsBudget({ residueCount: 400, incompleteResidues: 400, emulated: false }, T)).toBe(true);
  });

  it("bounds the structure a repaired job can carry", () => {
    expect(emulatedRepairResidueLimit(T)).toBe(233);
  });
});

describe("clampToJobRemaining", () => {
  it("shortens a stage to what the job has left and never below a useful floor", () => {
    expect(clampToJobRemaining(600_000, 360_000)).toBe(360_000);
    expect(clampToJobRemaining(100_000, 360_000)).toBe(100_000);
    expect(clampToJobRemaining(600_000, 5_000)).toBe(30_000);
  });
});

describe("backgroundRepairBudgetMs", () => {
  it("holds every measured repair with at least 1.5x to spare, including the one the interactive cap could not", () => {
    const measured = [
      { residues: 154, incomplete: 0, seconds: 272.5 },
      { residues: 393, incomplete: 0, seconds: 456.5 },
      { residues: 305, incomplete: 44, seconds: 659.8 },
    ];
    for (const m of measured) {
      const budget = backgroundRepairBudgetMs({ residueCount: m.residues, incompleteResidues: m.incomplete }, T);
      expect(budget, `${m.residues} residues`).not.toBeNull();
      expect((budget as number) / 1000 / m.seconds).toBeGreaterThanOrEqual(1.5);
    }
    expect(backgroundRepairBudgetMs({ residueCount: 305, incompleteResidues: 44 }, T)).toBe(1_153_500);
  });

  it("never goes below the interactive repair cap, and refuses what would outlast its ceiling", () => {
    expect(backgroundRepairBudgetMs({ residueCount: 10 }, T)).toBe(420_000);
    expect(backgroundRepairBudgetMs({ residueCount: 400, incompleteResidues: 400 }, T)).toBeNull();
  });

  it("is a ceiling the repair gate stays below: a repair that fits interactively never needs the background", () => {
    const fits = { residueCount: 200, incompleteResidues: 0 };
    expect(repairFitsBudget({ ...fits, emulated: true }, T)).toBe(true);
    expect(backgroundRepairBudgetMs(fits, T)).toBeGreaterThanOrEqual(T.foldxRepairMs);
  });
});
