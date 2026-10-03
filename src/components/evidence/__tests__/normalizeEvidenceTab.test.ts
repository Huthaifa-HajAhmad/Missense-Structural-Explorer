import { describe, expect, it } from "vitest";
import { normalizeEvidenceTab } from "../types";

describe("normalizeEvidenceTab", () => {
  it("sends the retired Score thresholds ids to Predictors", () => {
    expect(normalizeEvidenceTab("guidelines")).toBe("predictors");
    expect(normalizeEvidenceTab("thresholds")).toBe("predictors");
    expect(normalizeEvidenceTab("Guidelines")).toBe("predictors");
  });

  it("leaves every live tab id alone", () => {
    for (const id of ["clinical", "function", "predictors", "alphagenome", "splicing", "structure", "perturbation", "multimers", "interactions"]) {
      expect(normalizeEvidenceTab(id)).toBe(id);
    }
  });
});
