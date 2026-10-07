import { describe, expect, it, vi } from "vitest";

vi.mock("../external-api/gnomad.ts", () => ({
  fetchGnomadGeneConstraint: vi.fn(async () => ({
    hasRegionalData: true,
    regions: [{ aa_start: "p.Met96", aa_stop: "p.Leu262", obs_exp: 0.412, p_value: 0.001 }]
  }))
}));

import { classifyClinvar, fetchLandscapeContext, missenseResidue, parseClinvar, parseGnomad, parseRegions } from "./landscape-context.ts";

describe("landscape context parsing", () => {
  it("reads only missense HGVS", () => {
    expect(missenseResidue("p.Asp116Gly")).toBe(116);
    expect(missenseResidue("p.Asp116=")).toBeNull();
    expect(missenseResidue("p.Asp116Asp")).toBeNull();
    expect(missenseResidue("p.Arg12Ter")).toBeNull();
    expect(missenseResidue("p.Gly5fs")).toBeNull();
  });

  it("classifies ClinVar significance without promoting conflicts", () => {
    expect(classifyClinvar("Pathogenic/Likely pathogenic")).toBe("plp");
    expect(classifyClinvar("Likely benign")).toBe("blb");
    expect(classifyClinvar("Conflicting classifications of pathogenicity")).toBe("other");
    expect(classifyClinvar("Uncertain significance")).toBe("other");
  });

  it("keeps canonical-transcript missense rows and counts gnomAD variants per residue", () => {
    const cv = parseClinvar(
      [
        { hgvsp: "p.Arg131Trp", clinical_significance: "Pathogenic", gold_stars: 2, transcript_id: "ENST1.4" },
        { hgvsp: "p.Arg98Trp", clinical_significance: "Pathogenic", transcript_id: "ENST2" },
        { hgvsp: "p.Arg131=", clinical_significance: "Benign", transcript_id: "ENST1" }
      ],
      "ENST1"
    );
    expect(cv).toEqual([{ pos: 131, cls: "plp", significance: "Pathogenic", stars: 2, hgvsp: "p.Arg131Trp" }]);

    const gn = parseGnomad(
      [
        { consequence: "missense_variant", hgvsp: "p.Asp116Asn", transcript_id: "ENST1", exome: { ac: 3 }, genome: { ac: 1 } },
        { consequence: "missense_variant", hgvsp: "p.Asp116Glu", transcript_id: "ENST1", exome: { ac: 10 }, genome: null },
        { consequence: "synonymous_variant", hgvsp: "p.Asp116=", transcript_id: "ENST1", exome: { ac: 50 } },
        { consequence: "missense_variant", hgvsp: "p.Ser101Pro", transcript_id: "ENST1", exome: { ac: 0 }, genome: { ac: 0 } }
      ],
      "ENST1"
    );
    expect(gn).toEqual([{ pos: 116, variants: 2, maxAc: 10 }]);
  });

  it("parses regional constraint spans", () => {
    expect(parseRegions([{ aa_start: "p.Leu262", aa_stop: "p.Met96", obs_exp: 0.4123, p_value: "0.002" }])).toEqual([
      { start: 96, end: 262, oe: 0.41, pValue: 0.002 }
    ]);
  });

  it("reports a failed source as not loaded, not as empty", async () => {
    const spy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    const ctx = await fetchLandscapeContext("NAE1");
    expect(ctx.clinvar).toBeNull();
    expect(ctx.gnomad).toBeNull();
    expect(ctx.regions).toBeNull();
    expect(ctx.regionsBasis).toContain("v4.1.1");
    expect(ctx.errors.length).toBe(3);
    spy.mockRestore();
  });
});
