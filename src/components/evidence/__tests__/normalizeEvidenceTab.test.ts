import { describe, expect, it } from "vitest";
import { normalizeEvidenceTab } from "../types";

describe("normalizeEvidenceTab", () => {
  it("sends the retired Score thresholds ids to Predictors", () => {
    expect(normalizeEvidenceTab("guidelines")).toBe("predictors");
    expect(normalizeEvidenceTab("thresholds")).toBe("predictors");
    expect(normalizeEvidenceTab("Guidelines")).toBe("predictors");
  });

  it("sends the retired Multimer assembly and Protein interactions ids to Interfaces & PPI", () => {
    expect(normalizeEvidenceTab("multimers")).toBe("interfaces");
    expect(normalizeEvidenceTab("interactions")).toBe("interfaces");
  });

  it("leaves every live tab id alone", () => {
    for (const id of ["clinical", "function", "predictors", "alphagenome", "splicing", "structure", "perturbation", "interfaces"]) {
      expect(normalizeEvidenceTab(id)).toBe(id);
    }
  });
});
