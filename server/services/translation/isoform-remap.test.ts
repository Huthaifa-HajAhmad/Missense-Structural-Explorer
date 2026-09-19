import { describe, it, expect } from "vitest";

import {
  buildAmbiguousNumberingMessage,
  mapPositionAcrossSequences,
  parseSubstitution,
  renameSubstitution,
  resolveNumberingAcrossBases,
  type NumberingBasis,
} from "./isoform-remap.ts";
import {
  ACOT9_CANONICAL,
  ACOT9_INSERTION,
  ACOT9_ISOFORM_4,
  withInsertion,
} from "./__fixtures__/acot9.ts";

const acot9Bases: NumberingBasis[] = [
  { id: "Q9Y305", sequence: ACOT9_CANONICAL, kind: "canonical" },
  { id: "Q9Y305-4", sequence: ACOT9_ISOFORM_4, kind: "isoform" },
];

/** The canonical sequence with a 10-residue insertion after position 20 (offset -10 above it). */
const SYNTHETIC_BASES: NumberingBasis[] = [
  { id: "P00001", sequence: ACOT9_CANONICAL, kind: "canonical" },
  {
    id: "P00001-2",
    sequence: withInsertion(ACOT9_CANONICAL, 20, ACOT9_INSERTION + "V"),
    kind: "isoform",
  },
];

describe("mapPositionAcrossSequences", () => {
  it("maps a position across an insertion and reports the offset", () => {
    const basis = withInsertion(ACOT9_CANONICAL, 20, ACOT9_INSERTION + "V");
    // Far enough from the insertion that the anchoring window does not straddle it: the mapper
    // deliberately refuses a window containing the difference rather than guessing.
    const position = 59; // canonical 49, shifted by the 10 inserted residues

    const result = mapPositionAcrossSequences({
      basisSequence: basis,
      canonicalSequence: ACOT9_CANONICAL,
      position,
    });

    expect(result.status).toBe("mapped");
    if (result.status === "mapped") {
      expect(result.mapping.canonicalPosition).toBe(49);
      expect(result.mapping.offset).toBe(-10);
      expect(result.mapping.anchorLength).toBeGreaterThan(30);
    }
  });

  it("refuses to anchor a window that straddles an insertion", () => {
    // 10 residues were inserted after position 20, so anything within 25 of it cannot be located
    // by context: the flanking sequence exists in neither numbering.
    const basis = withInsertion(ACOT9_CANONICAL, 20, ACOT9_INSERTION + "V");
    const result = mapPositionAcrossSequences({
      basisSequence: basis,
      canonicalSequence: ACOT9_CANONICAL,
      position: 31,
    });

    expect(result.status).toBe("unmappable");
  });

  it("maps the REAL ACOT9 pair the production case depends on", () => {
    const lab = mapPositionAcrossSequences({
      basisSequence: ACOT9_ISOFORM_4,
      canonicalSequence: ACOT9_CANONICAL,
      position: 281,
    });
    const canonicalSide = mapPositionAcrossSequences({
      basisSequence: ACOT9_CANONICAL,
      canonicalSequence: ACOT9_CANONICAL,
      position: 272,
    });

    expect(lab.status).toBe("mapped");
    expect(canonicalSide.status).toBe("mapped");
    if (lab.status === "mapped") {
      expect(lab.mapping.canonicalPosition).toBe(272);
      expect(ACOT9_CANONICAL[271]).toBe("K");
      expect(ACOT9_ISOFORM_4[280]).toBe("K");
      // …and canonical 281 is a different residue, which is why an index-only reading is wrong.
      expect(ACOT9_CANONICAL[280]).toBe("L");
    }
  });

  it("refuses a position whose region occurs more than once", () => {
    const repeated = "ACDEFGHIKL".repeat(6);
    const result = mapPositionAcrossSequences({
      basisSequence: repeated,
      canonicalSequence: repeated,
      position: 25,
    });

    expect(result.status).toBe("unmappable");
    if (result.status === "unmappable") expect(result.reason).toContain("more than once");
  });

  it("refuses when the region does not exist in the canonical sequence", () => {
    const result = mapPositionAcrossSequences({
      basisSequence: "MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ",
      canonicalSequence: "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
      position: 15,
    });

    expect(result.status).toBe("unmappable");
  });

  it("refuses a position outside the numbering basis and one without enough context", () => {
    expect(
      mapPositionAcrossSequences({
        basisSequence: ACOT9_CANONICAL,
        canonicalSequence: ACOT9_CANONICAL,
        position: ACOT9_CANONICAL.length + 5,
      }).status
    ).toBe("unmappable");

    expect(
      mapPositionAcrossSequences({
        basisSequence: ACOT9_CANONICAL,
        canonicalSequence: ACOT9_CANONICAL,
        position: 2,
        minFlank: 30,
      }).status
    ).toBe("unmappable");
  });
});

describe("parseSubstitution / renameSubstitution", () => {
  it("parses HGVSp forms and preserves the prefix style when renaming", () => {
    const parsed = parseSubstitution("p.Lys281Asn");
    expect(parsed).toMatchObject({ position: 281, wt1: "K", mut1: "N", prefixed: true });
    expect(renameSubstitution("p.Lys281Asn", parsed!, 272)).toBe("p.Lys272Asn");

    const bare = parseSubstitution("K281N");
    expect(bare).toMatchObject({ position: 281, wt1: "K", mut1: "N", prefixed: false });
    expect(renameSubstitution("K281N", bare!, 272)).toBe("K272N");

    expect(parseSubstitution("p.(Lys281Asn)")).toMatchObject({ position: 281, prefixed: true });
    expect(parseSubstitution("p.(=)")).toBeNull();
  });
});

describe("resolveNumberingAcrossBases", () => {
  it("returns canonical when the canonical sequence carries the stated residue", () => {
    // canonical 45 = R; the isoform has an inserted residue at that index, so only one
    // interpretation survives — this is the ordinary case for every gene.
    const resolution = resolveNumberingAcrossBases({
      notation: "p.Arg45Gly",
      bases: acot9Bases,
    });

    expect(resolution.status).toBe("canonical");
    if (resolution.status === "canonical") {
      expect(resolution.candidate.canonicalPosition).toBe(45);
      expect(resolution.candidate.basisKind).toBe("canonical");
    }
  });

  it("remaps a MANE-numbered notation onto canonical numbering", () => {
    const resolution = resolveNumberingAcrossBases({
      notation: "p.Lys281Asn",
      bases: acot9Bases,
    });

    expect(resolution.status).toBe("remapped");
    if (resolution.status === "remapped") {
      expect(resolution.candidate.variant).toBe("p.Lys272Asn");
      expect(resolution.candidate.basisId).toBe("Q9Y305-4");
      expect(resolution.candidate.basisPosition).toBe(281);
      expect(resolution.candidate.canonicalPosition).toBe(272);
    }
  });

  /**
   * The silent-mis-modelling case this module exists to prevent: at these indices the wild-type
   * LETTER is the same in both numberings while the residue is 9 positions away, so an
   * index-only reading would model the wrong residue. Two consistent interpretations must be
   * reported as ambiguous, never resolved by choosing one.
   */
  it("reports ambiguity when two numberings fit the same letters at different residues", () => {
    const index = 85; // canonical 85 = isoform 85 = D; the isoform's D is canonical 76
    expect(ACOT9_CANONICAL[index - 1]).toBe(ACOT9_ISOFORM_4[index - 1]);

    const resolution = resolveNumberingAcrossBases({
      notation: `p.Asp${index}Phe`,
      bases: acot9Bases,
    });

    expect(resolution.status).toBe("ambiguous");
    if (resolution.status === "ambiguous") {
      expect(resolution.candidates.map((c) => c.canonicalPosition).sort((a, b) => a - b)).toEqual([
        76,
        85,
      ]);
      const message = buildAmbiguousNumberingMessage(`p.Asp${index}Phe`, resolution.candidates);
      expect(message).toContain("cannot be resolved by residue number alone");
      expect(message).toContain("p.Asp85Phe");
      expect(message).toContain("p.Asp76Phe");
    }
  });

  it("is unresolved when no sequence carries the stated wild type", () => {
    const resolution = resolveNumberingAcrossBases({
      notation: "p.Trp281Asn",
      bases: acot9Bases,
    });

    expect(resolution.status).toBe("unresolved");
    if (resolution.status === "unresolved") {
      expect(resolution.reason).toContain("wild-type residue");
    }
  });

  it("uses the canonical sequence when a synthetic isoform shares its numbering there", () => {
    // Position 15 sits before the insertion, so both sequences carry the same residue and the
    // same canonical position: one candidate, canonical.
    const resolution = resolveNumberingAcrossBases({
      notation: "p.Gln15Ala",
      bases: SYNTHETIC_BASES,
    });

    expect(resolution.status).toBe("canonical");
  });

  it("remaps through a synthetic isoform whose insertion shifts the numbering", () => {
    // The synthetic isoform's position 59 is canonical 49 (10 residues inserted after 20), and
    // canonical 59 is a different residue (K), so only one interpretation survives.
    const resolution = resolveNumberingAcrossBases({
      notation: "p.Gly59Ala",
      bases: SYNTHETIC_BASES,
    });

    expect(resolution.status).toBe("remapped");
    if (resolution.status === "remapped") {
      expect(resolution.candidate.canonicalPosition).toBe(49);
      expect(resolution.candidate.variant).toBe("p.Gly49Ala");
      expect(resolution.candidate.basisId).toBe("P00001-2");
    }
  });
});
