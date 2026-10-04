import { describe, expect, it } from "vitest";
import { buildModelBudgetMs } from "./budget.ts";

const T = {
  foldxBuildModelMs: 180_000,
  foldxBuildModelMaxMs: 600_000,
  foldxEmulatedFixedMs: 15_000,
  foldxEmulatedMsPerResidueRun: 30,
};

describe("buildModelBudgetMs", () => {
  it("keeps the flat cap on a native host, whatever the size", () => {
    expect(buildModelBudgetMs({ residueCount: 2000, numberOfRuns: 5, emulated: false }, T)).toBe(180_000);
  });

  it("gives the measured SLC12A4 run (167.2 s under Box64) about 2x headroom instead of 7%", () => {
    const budget = buildModelBudgetMs({ residueCount: 1085, numberOfRuns: 5, emulated: true }, T);
    expect(budget).toBe(355_500);
    expect(budget / 167_200).toBeGreaterThan(2);
  });

  it("never drops below the native floor for small emulated structures", () => {
    expect(buildModelBudgetMs({ residueCount: 154, numberOfRuns: 5, emulated: true }, T)).toBe(180_000);
  });

  it("is clamped to the ceiling so the job still fits its whole-job cap", () => {
    expect(buildModelBudgetMs({ residueCount: 5000, numberOfRuns: 5, emulated: true }, T)).toBe(600_000);
  });
});
