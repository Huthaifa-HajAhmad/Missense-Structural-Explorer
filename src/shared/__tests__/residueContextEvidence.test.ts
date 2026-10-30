import { describe, expect, it } from "vitest";
import { assignLanes, buildResidueContextEvidence, backboneCaveat, granthamClass } from "../residueContextEvidence";
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

describe("structure absence reason", () => {
  it("uses the payload's reason only when it reports a structural failure", () => {
    expect(nae1({ disruption: { level: "unknown", reason: "Target residue not found in structure." } }).structureReason)
      .toBe("Target residue not found in structure.");
    // A rule-based level explains a substitution that was measured; it is not a burial cause.
    expect(nae1({ disruption: { level: "high", reason: "Proline introduced at position 116." } }).structureReason)
      .toBe("No structure reading was returned for this residue.");
  });

  it("keeps the pocket's state out of the structure reason", () => {
    const model = nae1({
      disruption: null,
      pocket: derivePocketNarrative(null, { variantResidueIndex: 116, variantResidueChain: "A", error: "Java not found" })
    });
    expect(model.structureReason).toBe("No structure reading was returned for this residue.");
    expect(model.structureReason).not.toMatch(/cavity scan/i);
    expect(model.finding.detail).toMatch(/cavity scan/i);
  });
});

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
    expect(model.facts[3].label).toBe("Ligand-site probability");
    expect(model.trace[4].value).toMatch(/No ACMG criterion/);
  });

  it("gives a measured burial word when accessibility is present", () => {
    const model = nae1({ disruption: { burialStatus: "surface", rsa: 0.42, neighborCount: 9 } });
    expect(model.burial!.status).toBe("surface");
    expect(model.facts[1].value).toBe("Surface");
    expect(model.cuts.find(c => c.active && c.group === "Relative accessibility")!.here).toBe("this variant");
  });
});

describe("cut-point wording states exact inequalities", () => {
  it("covers every shift from 0 up with no gap, in the model's own words", () => {
    const rules = nae1().cuts.filter(c => c.group.startsWith("Property shift")).map(c => c.rule);
    // `slight` is |delta| <= 9 and `moderate` is |delta| <= 29 (SHIFT_MAGNITUDE_BANDS); deltas carry
    // one decimal, so "10 to 29" left 9.1 to 9.9 unnamed. The rail also said "large" where the model
    // and the tab's interpretation say "marked".
    expect(rules).toEqual(["> 29 marked", "> 9 to ≤ 29 moderate", "> 0 to ≤ 9 slight"]);
  });

  it("states the pocket bands against the same rule the classifier applies", () => {
    const rules = nae1().cuts.filter(c => c.group === "Pocket distance").map(c => c.rule);
    // classifyProximity: lining residue first, then <= 4, <= 8, <= 12 Å, else distal.
    expect(rules).toEqual([
      "Pocket residue, or ≤ 4 Å lining",
      "> 4 to ≤ 8 Å near",
      "> 8 to ≤ 12 Å rim",
      "> 12 Å distal",
    ]);
  });

  it("labels a rescaled score as a score, never as a probability", () => {
    const pocket = derivePocketNarrative(
      { ...NAE1_POCKET, provenance: { ...NAE1_POCKET.provenance, scoreSource: "rescaled_raw_score" } },
      { variantResidueIndex: 116, variantResidueChain: "A" }
    );
    expect(nae1({ pocket }).facts[3].label).toBe("P2Rank score");
  });
});

describe("side-chain glyph", () => {
  it("diffs Asp to Gly as four lost atoms", () => {
    const glyph = nae1().glyph!;
    expect(glyph.lost).toEqual(["CB", "CG", "OD1", "OD2"]);
    expect(glyph.summary).toBe("CB, CG, OD1 and OD2 lost");
  });

  it("is absent for a non-standard residue so nothing is drawn for it", () => {
    expect(nae1({ wildTypeCode: "X" }).glyph).toBeNull();
  });
});

describe("alphabet context on each published scale", () => {
  it("lists the other 18 residues as ticks on their native value, excluding the pair", () => {
    const model = nae1();
    const size = model.scaleContext.size;
    // Grantham volume: Trp 170 is the top of the scale, Gly 3 the bottom; Asp and Gly are the pair.
    expect(size.find(t => t.codes.includes("W"))).toMatchObject({ position: 100, native: "170" });
    expect(size.flatMap(t => t.codes)).not.toContain("D");
    expect(size.flatMap(t => t.codes)).not.toContain("G");
    expect(size.flatMap(t => t.codes)).toHaveLength(18);
  });

  it("merges residues sharing a value into one tick, so net charge has three", () => {
    const charge = nae1().scaleContext.charge;
    // Asp is the pair; E is the only other −1. K and R are +1; the other 15 carry 0 (Gly is the pair).
    expect(charge.map(t => t.native)).toEqual(["−1", "0", "+1"]);
    expect(charge[0].codes).toEqual(["E"]);
    expect(charge[2].codes).toEqual(["K", "R"]);
    expect(charge[1].codes).toHaveLength(15);
  });
});

describe("pocket distance strip", () => {
  it("places the cavity centre and the pocket residues on one axis from the variant residue", () => {
    const strip = nae1().pocketStrip!;
    expect(strip.origin).toBe("residue 116");
    expect(strip.marks).toEqual([4, 8, 12]);
    expect(strip.centre).toMatchObject({ distance: 23.14, reference: "the cavity centre" });
    expect(strip.max).toBe(30);
    expect(strip.residues.map(r => r.label)).toEqual([
      "Leu131", "Ile152", "Glu133", "Tyr402", "Arg154", "Tyr161", "Asp433", "Arg430",
    ]);
    expect(strip.residues[0]).toMatchObject({ index: 131, chain: "A", distance: 17.8 });
    expect(strip.residues[0].position).toBeCloseTo((17.8 / 30) * 100, 5);
  });

  it("stretches the axis to contain every marker so none is pinned to the edge", () => {
    const strip = nae1().pocketStrip!;
    const farthest = Math.max(strip.centre!.distance, ...strip.residues.map(r => r.distance));
    expect(strip.max).toBeGreaterThanOrEqual(farthest);
    for (const r of strip.residues) expect(r.position).toBeLessThanOrEqual(100);
  });

  it("gives labels that would collide different lanes", () => {
    const strip = nae1().pocketStrip!;
    const byLane = new Map<number, number[]>();
    for (const r of strip.residues) byLane.set(r.lane, [...(byLane.get(r.lane) ?? []), r.position]);
    expect(strip.lanes).toBe(byLane.size);
    for (const positions of byLane.values()) {
      const sorted = [...positions].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(10);
    }
  });

  it("is absent until the pocket scan has a result", () => {
    expect(nae1({ pocket: derivePocketNarrative(null, { isLoading: true, variantResidueIndex: 116 }) }).pocketStrip).toBeNull();
  });
});

describe("assignLanes", () => {
  it("reuses a lane once the gap is wide enough and opens a new one otherwise", () => {
    expect(assignLanes([10, 12, 30, 31], 10)).toEqual([0, 1, 0, 1]);
    expect(assignLanes([], 10)).toEqual([]);
  });
});
