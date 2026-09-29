import { describe, it, expect } from "vitest";
import { assessPm1, evidenceLevelOf, featureCoversResidue } from "../functionalSites";

const exp = [{ code: "ECO:0000269", source: "PubMed", id: "12345" }];

describe("featureCoversResidue", () => {
  it("covers a disulfide bond's two cysteines and nothing between them", () => {
    const bond = { type: "Disulfide bond", start: 20, end: 180 };
    expect(featureCoversResidue(bond, 20)).toBe(true);
    expect(featureCoversResidue(bond, 180)).toBe(true);
    // The old `start <= pos <= end` test said true here, and gave PM1 to residues 21–179.
    expect(featureCoversResidue(bond, 100)).toBe(false);
  });

  it("covers a span inclusively and a point at its residue only", () => {
    expect(featureCoversResidue({ type: "Region", start: 331, end: 344 }, 344)).toBe(true);
    expect(featureCoversResidue({ type: "Site", start: 211, end: 211 }, 212)).toBe(false);
  });
});

describe("evidenceLevelOf", () => {
  it("ranks the strongest tag and separates structure from proteomics for ECO:0007744", () => {
    expect(evidenceLevelOf([{ code: "ECO:0000250" }, { code: "ECO:0000269" }])).toBe("experimental");
    expect(evidenceLevelOf([{ code: "ECO:0007744", source: "PDB", id: "1TT5" }])).toBe("structure");
    expect(evidenceLevelOf([{ code: "ECO:0007744", source: "PubMed", id: "1" }])).toBe("proteomics");
    expect(evidenceLevelOf([{ code: "ECO:0000255" }])).toBe("predicted");
    expect(evidenceLevelOf([])).toBe("none");
    expect(evidenceLevelOf(undefined)).toBe("none");
  });
});

describe("assessPm1", () => {
  it("meets PM1 on an experimentally evidenced active site and says benign variation was not checked", () => {
    const r = assessPm1([{ type: "Active site", description: "Proton acceptor", start: 635, end: 635, evidence: exp }], 635);
    expect(r.status).toBe("met");
    expect(r.reason).toContain("PubMed 12345");
    expect(r.reason).toContain("Benign variation in the region was not checked");
  });

  it("does not count a site transferred by similarity or predicted by sequence analysis", () => {
    const r = assessPm1(
      [
        { type: "Active site", start: 10, end: 10, evidence: [{ code: "ECO:0000250", source: "UniProtKB", id: "P12345" }] },
        { type: "Binding site", start: 10, end: 10, evidence: [{ code: "ECO:0000255" }] },
      ],
      10
    );
    expect(r.status).toBe("not-met");
    expect(r.notCounted).toHaveLength(2);
    expect(r.reason).toContain("Not counted");
  });

  it("meets PM1 at a bonded cysteine but not between the cysteines", () => {
    const bond = [{ type: "Disulfide bond", start: 20, end: 180, evidence: exp }];
    expect(assessPm1(bond, 180).status).toBe("met");
    expect(assessPm1(bond, 180).reason).toContain("Cys180, bonded to Cys20");
    expect(assessPm1(bond, 100).status).toBe("not-met");
  });

  it("withholds PM1 when PP3 alone already reaches Strong (PP3 + PM1 capped at Strong)", () => {
    const site = [{ type: "Active site", start: 5, end: 5, evidence: exp }];
    expect(assessPm1(site, 5, { pp3Code: "PP3_Strong" }).status).toBe("withheld-cap");
    expect(assessPm1(site, 5, { pp3Code: "PP3_Moderate" }).status).toBe("met");
    expect(assessPm1(site, 5, { pp3Code: "PP3" }).status).toBe("met");
  });

  it("reports no-data, never not-met, when the features were not retrieved", () => {
    expect(assessPm1(null, 5).status).toBe("no-data");
  });
});
