import { describe, expect, it } from "vitest";
import { summariseCuratedLofMechanism } from "../lofMechanismBasis";

describe("summariseCuratedLofMechanism", () => {
  it("recognizes qualifying definitive/strong/moderate G2P LOF records and ignores limited/undetermined", () => {
    expect(summariseCuratedLofMechanism([
      { confidence: "limited", mechanism: "loss of function" },
      { confidence: "definitive", mechanism: "undetermined" },
    ])).toBeNull();

    const lof = summariseCuratedLofMechanism([
      { confidence: "definitive", mechanism: "loss of function" },
      { confidence: "strong", mechanism: "gain of function" },
    ]);
    expect(lof).toEqual({
      source: "Gene2Phenotype",
      lofEstablished: true,
      nonLofOnly: false,
      mechanisms: ["gain of function", "loss of function"],
      records: 2,
    });
  });

  it("flags gain-of-function-only genes as nonLofOnly so pLI >= 0.9 never triggers PVS1", () => {
    const gof = summariseCuratedLofMechanism([
      { confidence: "definitive", mechanism: "gain of function" },
    ]);
    expect(gof).toEqual({
      source: "Gene2Phenotype",
      lofEstablished: false,
      nonLofOnly: true,
      mechanisms: ["gain of function"],
      records: 1,
    });
  });

  it("recognizes ClinGen HI score 3 as curated LOF evidence", () => {
    expect(summariseCuratedLofMechanism([], { clingenHaploScore: 3 })).toEqual({
      source: "ClinGen",
      lofEstablished: true,
      nonLofOnly: false,
      mechanisms: ["clingen haploinsufficiency (score 3)"],
      records: 1,
    });
  });
});
