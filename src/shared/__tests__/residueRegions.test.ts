import { describe, expect, it } from "vitest";
import { betweenDomainsAt, isRegionFeatureType, regionsAt, trackRegions } from "../residueRegions";

const EXP = [{ code: "ECO:0000269", source: "PubMed", id: "1" }];
const SEQ = [{ code: "ECO:0000256" }];

// UniProt's own type names, as the server sends them.
const FEATURES = [
  { type: "Region", description: "Disordered", start: 1, end: 60, evidence: SEQ },
  { type: "Domain", description: "Kinase", start: 20, end: 120, evidence: EXP },
  { type: "Region", description: "Interdomain linker", start: 121, end: 139 },
  { type: "Domain", description: "SH2", start: 140, end: 230 },
  { type: "Disulfide bond", description: "", start: 25, end: 200 },
  { type: "Helix", description: "", start: 30, end: 40 },
];

describe("regionsAt", () => {
  it("matches UniProt's type names without case, which the old 'DOMAIN' filter never did", () => {
    expect(regionsAt(FEATURES, 50).map(h => h.kind)).toEqual(["domain", "disordered"]);
    expect(regionsAt([{ type: "DOMAIN", description: "Old casing", start: 1, end: 9 }], 5).map(h => h.label)).toEqual(["Old casing"]);
  });

  it("calls a region a linker only when UniProt does", () => {
    expect(regionsAt(FEATURES, 130)).toEqual([{ kind: "linker", label: "Interdomain linker", start: 121, end: 139, evidence: "No evidence cited" }]);
  });

  it("prints the evidence level UniProt cites", () => {
    const hits = regionsAt(FEATURES, 50);
    expect(hits.find(h => h.kind === "domain")?.evidence).toBe("Experimental");
    expect(hits.find(h => h.kind === "disordered")?.evidence).toBe("Sequence analysis");
  });

  it("ignores bonds, secondary-structure features and missing input", () => {
    expect(regionsAt(FEATURES, 100).map(h => h.kind)).toEqual(["domain"]);
    expect(regionsAt(null, 5)).toEqual([]);
    expect(regionsAt(FEATURES, null)).toEqual([]);
  });
});

describe("betweenDomainsAt", () => {
  it("names the two flanking domains and the uncovered stretch", () => {
    expect(betweenDomainsAt(FEATURES, 130)).toEqual({
      before: { label: "Kinase", start: 20, end: 120 },
      after: { label: "SH2", start: 140, end: 230 },
      start: 121,
      end: 139,
    });
  });

  it("is null inside a domain and before the first or after the last domain", () => {
    expect(betweenDomainsAt(FEATURES, 100)).toBeNull();
    expect(betweenDomainsAt(FEATURES, 10)).toBeNull();
    expect(betweenDomainsAt(FEATURES, 300)).toBeNull();
  });
});

describe("trackRegions", () => {
  it("keeps domains and the named linker and disordered regions, in sequence order", () => {
    expect(trackRegions(FEATURES).map(r => `${r.kind}:${r.start}`)).toEqual(["disordered:1", "domain:20", "linker:121", "domain:140"]);
  });
});

describe("isRegionFeatureType", () => {
  it("accepts UniProt's own casing and rejects everything else", () => {
    expect(isRegionFeatureType("Domain")).toBe(true);
    expect(isRegionFeatureType("REGION")).toBe(true);
    expect(isRegionFeatureType(" domain ")).toBe(true);
    expect(isRegionFeatureType("Disulfide bond")).toBe(false);
    expect(isRegionFeatureType(null)).toBe(false);
    expect(isRegionFeatureType(undefined)).toBe(false);
  });
});
