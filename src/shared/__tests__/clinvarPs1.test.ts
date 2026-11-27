import { describe, expect, it } from "vitest";
import { recordsUnverifiedPs1 } from "../clinvarPs1";

describe("recordsUnverifiedPs1 — saved-analysis staleness guard", () => {
  it("flags a saved unresolved protein-only analysis carrying PS1 as stale", () => {
    const savedK132N = {
      metadata: { variant: "p.Lys132Asn" },
      clinvar: { hasOtherPathogenicVariantSameAA: true },
      predictorData: { gnomadVariantId: null, gnomadVariantAssembly: null, locusResolution: { failureKind: "multiple-candidates" } },
      ruleBasedInsights: { acmgCriteria: [{ code: "PS1" }, { code: "PP3_Moderate" }] },
    };
    expect(recordsUnverifiedPs1(savedK132N)).toBe(true);
  });

  it("accepts a saved analysis with a verified GRCh38 allele or explicit coding notation", () => {
    const verifiedGrch38 = {
      metadata: { variant: "p.Lys132Asn" },
      clinvar: { hasOtherPathogenicVariantSameAA: true },
      predictorData: { gnomadVariantId: "17-7675216-C-G", gnomadVariantAssembly: "GRCh38", locusResolution: { failureKind: null } },
      ruleBasedInsights: { acmgCriteria: [{ code: "PS1" }] },
    };
    expect(recordsUnverifiedPs1(verifiedGrch38)).toBe(false);

    const explicitCoding = {
      metadata: { variant: "p.Lys132Asn", originalNotation: "NM_000546.6:c.396G>C" },
      clinvar: { hasOtherPathogenicVariantSameAA: true },
      predictorData: { gnomadVariantId: null, gnomadVariantAssembly: null },
      ruleBasedInsights: { acmgCriteria: [{ code: "PS1" }] },
    };
    expect(recordsUnverifiedPs1(explicitCoding)).toBe(false);
  });

  it("ignores saved analyses that do not record PS1", () => {
    expect(recordsUnverifiedPs1({
      metadata: { variant: "p.Lys132Asn" },
      clinvar: { hasOtherPathogenicVariantSameAA: false },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3_Moderate" }] },
    })).toBe(false);
  });
});
