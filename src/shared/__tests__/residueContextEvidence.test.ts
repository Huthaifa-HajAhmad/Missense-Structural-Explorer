import { describe, expect, it } from "vitest";
import { buildResidueContextEvidence, backboneCaveat, granthamClass } from "../residueContextEvidence";
import { derivePocketNarrative, buildBiochemicalContrast } from "../residueShiftEvidence";
import { granthamDistance, nativeResidueValue, residueScalePositions } from "../residueScales";
import { NAE1_POCKET, NAE1_RESULT } from "./fixtures/nae1ResidueShifts";

function nae1(overrides: Partial<Parameters<typeof buildResidueContextEvidence>[0]> = {}) {
  const contrast = buildBiochemicalContrast({
    wildTypeCode: "D",
    mutantCode: "G",
    wildTypeValues: residueScalePositions("D"),
    mutantValues: residueScalePositions("G"),
    wildTypeLabel: "Asp",
    mutantLabel: "Gly"
  });
  return buildResidueContextEvidence({
    wildTypeCode: "D",
    mutantCode: "G",
    wildTypeLabel: "Asp",
    mutantLabel: "Gly",
    wildTypeName: "Aspartate",
    mutantName: "Glycine",
    position: 116,
    contrast,
    disruption: NAE1_RESULT.disruptionPredictor,
    pdbId: "1YOV",
    pdbSource: "RCSB PDB",
    chain: "A",
    pocket: derivePocketNarrative(NAE1_POCKET, { variantResidueIndex: 116, variantResidueChain: "A" }),
    ...overrides
  });
}

describe("published residue scales", () => {
  it("reproduces Grantham's matrix values", () => {
    // Grantham 1974 Table 2: Asp–Gly 94, Asp–Glu 45, Leu–Ile 5, Cys–Trp 215.
    expect(granthamDistance("D", "G")).toBe(94);
    expect(granthamDistance("D", "E")).toBe(45);
    expect(granthamDistance("L", "I")).toBe(5);
    expect(granthamDistance("C", "W")).toBe(215);
    expect(granthamDistance("D", "D")).toBeNull();
    expect(granthamClass(94)).toBe("moderately conservative");
  });

  it("orders residues the way the cited scales do, which the hand table did not", () => {
    // Kyte–Doolittle puts Gly above Pro and Trp below Gly; the old table had both reversed.
    const kd = residueScalePositions("G")!.hydrophobicity;
    expect(kd).toBeGreaterThan(residueScalePositions("P")!.hydrophobicity);
    expect(residueScalePositions("W")!.hydrophobicity).toBeLessThan(kd);
    expect(nativeResidueValue("polarity", "G")).toBe(9.0);
    expect(nativeResidueValue("size", "D")).toBe(54);
  });
});

describe("buildResidueContextEvidence on NAE1 p.Asp116Gly", () => {
  it("leads with charge, not the old polarity −85", () => {
    const model = nae1();
    const [first, second] = model.properties!;
    expect(first.key).toBe("charge");
    expect(first.changePredicate).toBe("loses its negative charge");
    expect(first.wildTypeNative).toBe("−1");
    expect(first.mutantNative).toBe("0");
    expect(second.key).toBe("polarity");
    expect(Math.round(second.absoluteDelta)).toBe(49);
    expect(model.finding.headline).toMatch(/^The side chain loses its negative charge and becomes less polar, 23\.1 Å from the nearest predicted pocket\.$/);
  });

  it("reports burial as not measured and names the stored packing word as stale", () => {
    const model = nae1();
    expect(model.burial!.status).toBe("undetermined");
    expect(model.burial!.staleWord).toMatch(/boundary/);
    expect(model.facts[1]).toMatchObject({ label: "Burial", value: "Not measured" });
    expect(model.trace[2].state).toBe("warn");
    expect(model.cuts.filter(c => c.group === "Relative accessibility").every(c => !c.active)).toBe(true);
  });

  it("uses one pocket distance, the cavity centre, and one score format", () => {
    const model = nae1();
    expect(model.pocket.proximity.distance).toBe(23.14);
    expect(model.pocket.proximity.reference).toBe("the cavity centre");
    expect(model.pocket.ranking.display).toBe("0.23");
    expect(model.pocket.ranking.profile).toBe("alphafold");
    expect(model.pocket.classification.label).toBe("Distal");
    expect(model.cuts.find(c => c.active && c.group === "Pocket distance")!.rule).toMatch(/> 12 Å distal/);
  });

  it("lists pocket residues nearest first", () => {
    const model = nae1();
    expect(model.pocket.lining.byDistance.map(r => r.index)).toEqual([131, 152, 133, 402, 154, 161, 433, 430]);
  });

  it("says glycine's backbone effect is not on the scales", () => {
    expect(nae1().backbone!.title).toMatch(/glycine frees the backbone/);
    expect(backboneCaveat("E", "K")).toBeNull();
    expect(backboneCaveat("A", "P")!.title).toMatch(/proline/);
  });

  it("records that no ACMG criterion reads this tab", () => {
    const model = nae1();
    expect(model.facts[3].label).toBe("Pocket confidence");
    expect(model.trace[4].value).toMatch(/No ACMG criterion/);
  });

  it("gives a measured burial word when accessibility is present", () => {
    const model = nae1({ disruption: { burialStatus: "surface", rsa: 0.42, neighborCount: 9 } });
    expect(model.burial!.status).toBe("surface");
    expect(model.facts[1].value).toBe("Surface");
    expect(model.cuts.find(c => c.active && c.group === "Relative accessibility")!.here).toBe("this variant");
  });
});
