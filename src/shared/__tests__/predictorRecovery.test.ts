import { describe, expect, it } from "vitest";
import { hasInterruptedPredictorReadings } from "../predictorRecovery";

const result = (conservationData: unknown) => ({ conservationData } as any);

describe("hasInterruptedPredictorReadings", () => {
  it.each([
    ["base pending with MetaRNN absent", { metarnn: null, modelStatus: { base: "pending" } }, true],
    ["base timed out with ESM1b absent", { esm1b: null, modelStatus: { base: "timeout" } }, true],
    ["base timed out with Eigen absent", { eigenPhred: null, modelStatus: { base: "timeout" } }, true],
    ["popEVE pending and absent", { popeve: null, modelStatus: { popeve: "pending" } }, true],
    ["popEVE timed out and absent", { popeve: null, modelStatus: { popeve: "timeout" } }, true],
    ["popEVE timed out but already scored", { popeve: -3.376, modelStatus: { popeve: "timeout" } }, false],
    ["base settled with a completed MetaRNN miss", { metarnn: null, modelStatus: { base: "settled" } }, false],
    ["base pending but all three readings present", { metarnn: 0.7, esm1b: -5.5, eigenPhred: 4.8, modelStatus: { base: "pending" } }, false],
    ["no model status on an older payload", { metarnn: null, popeve: null }, false],
    ["no conservation data", null, false],
  ])("%s", (_name, conservationData, expected) => {
    expect(hasInterruptedPredictorReadings(result(conservationData))).toBe(expected);
  });

  it("treats a missing result as nothing to refresh", () => {
    expect(hasInterruptedPredictorReadings(null)).toBe(false);
    expect(hasInterruptedPredictorReadings(undefined)).toBe(false);
  });
});
