import { describe, expect, it } from "vitest";
import { resolveResidueShiftModel } from "../residueShiftModel";
import { getPropertyScaleDefinition } from "../../shared/residueShiftEvidence";

describe("resolveResidueShiftModel", () => {
  it("prefers pipeline metadata over the variant string", () => {
    const model = resolveResidueShiftModel({ wildType: "Arg", mutant: "Trp", variant: "p.Ala1Gly" });

    expect(model.source).toBe("metadata");
    expect(model.wildTypeCode).toBe("R");
    expect(model.mutantCode).toBe("W");
    expect(model.wildTypeLabel).toBe("Arg");
    expect(model.mutantLabel).toBe("Trp");
  });

  it("accepts one-letter, three-letter and mixed-case metadata codes", () => {
    for (const [wildType, mutant] of [
      ["R", "W"],
      ["Arg", "Trp"],
      ["ARG", "TRP"],
      ["aRg", "tRp"]
    ] as const) {
      const model = resolveResidueShiftModel({ wildType, mutant });
      expect(model.wildTypeCode).toBe("R");
      expect(model.mutantCode).toBe("W");
      expect(model.wildTypeLabel).toBe("Arg");
    }
  });

  it("falls back to variant notation when metadata residues are absent", () => {
    const model = resolveResidueShiftModel({ variant: "p.Glu433Lys" });

    expect(model.source).toBe("variant-notation");
    expect(model.wildTypeCode).toBe("E");
    expect(model.mutantCode).toBe("K");
    expect(model.wildTypeLabel).toBe("Glu");
    // The fallback path used to render a blank wild-type/mutant card with no scales.
    expect(model.contrast).not.toBeNull();
  });

  it("takes both residues from one source rather than mixing a partial pair", () => {
    // Metadata has the wild type only; pairing it with a parsed mutant would
    // describe a substitution that does not exist.
    const model = resolveResidueShiftModel({ wildType: "Arg", variant: "p.Glu433Lys" });

    expect(model.source).toBe("variant-notation");
    expect(model.wildTypeCode).toBe("E");
    expect(model.mutantCode).toBe("K");
  });

  it("reports unresolved instead of inventing mid-scale values", () => {
    const model = resolveResidueShiftModel({ variant: "chr1:12345:A:T" });

    expect(model.source).toBe("unresolved");
    expect(model.contrast).toBeNull();
    expect(model.wildTypeLabel).toBe("");
  });

  it("does not throw on malformed variant notation", () => {
    for (const variant of ["", "p.", "???", "p.Gly", "p.433Lys", "E433"]) {
      expect(() => resolveResidueShiftModel({ variant })).not.toThrow();
    }
  });

  it("builds the contrast with the shared wild-type and mutant labels", () => {
    const model = resolveResidueShiftModel({ wildType: "Glu", mutant: "Lys" });
    expect(model.contrast?.wildTypeLabel).toBe("Glu");
    expect(model.contrast?.mutantLabel).toBe("Lys");
    expect(model.contrast?.rows).toHaveLength(4);
  });

  it("projects the contrast into the Insights radar axes through shared labels", () => {
    // This is the exact projection the radar chart renders. Pinning it here means
    // an axis rename or addition is a deliberate change rather than silent drift
    // between the chart legend and the Residue Shifts tab.
    const model = resolveResidueShiftModel({ wildType: "Glu", mutant: "Lys" });
    const subjects = model.contrast!.rows.map(row => getPropertyScaleDefinition(row.key).shortLabel);

    expect(subjects).toEqual(["Hydropathy", "Volume", "Polarity", "Charge"]);
  });
});

describe("property scale definitions", () => {
  it("keeps one canonical long label and one compact label per axis", () => {
    // The Insights radar previously invented "Molecular Size" and "Charge" while
    // the scales used "Residue Volume / Size" and "Isoelectric Charge Index". The labels
    // now name the published scales (Grantham 1974 volume, formal charge at pH 7.4).
    expect(getPropertyScaleDefinition("size").label).toBe("Side-chain volume");
    expect(getPropertyScaleDefinition("size").shortLabel).toBe("Volume");
    expect(getPropertyScaleDefinition("charge").label).toBe("Net charge");
    expect(getPropertyScaleDefinition("charge").shortLabel).toBe("Charge");
  });

  it("gives every axis a distinct compact label", () => {
    const shortLabels = (["hydrophobicity", "size", "polarity", "charge"] as const).map(
      key => getPropertyScaleDefinition(key).shortLabel
    );
    expect(new Set(shortLabels).size).toBe(shortLabels.length);
  });

  it("fails loudly on an unknown axis rather than rendering undefined", () => {
    expect(() => getPropertyScaleDefinition("nope" as never)).toThrow(/Unknown amino-acid scale key/);
  });
});
