import { describe, expect, it } from "vitest";
import { normalizeEvidenceTab, retiredEvidenceTabView } from "../types";

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
    for (const id of ["clinical", "function", "predictors", "alphagenome", "splicing", "structure", "interfaces"]) {
      expect(normalizeEvidenceTab(id)).toBe(id);
    }
  });
});

describe("retiredEvidenceTabView", () => {
  it("sends the retired Structural perturbation tab to Energetics, where Packing & geometry now lives", () => {
    expect(retiredEvidenceTabView("perturbation")).toBe("energetics");
    expect(retiredEvidenceTabView("Perturbation")).toBe("energetics");
  });

  it("leaves live tabs, and tabs retired to another Evidence tab, to normalizeEvidenceTab", () => {
    for (const id of ["clinical", "predictors", "structure", "thresholds", "multimers"]) {
      expect(retiredEvidenceTabView(id)).toBeNull();
    }
  });
});
