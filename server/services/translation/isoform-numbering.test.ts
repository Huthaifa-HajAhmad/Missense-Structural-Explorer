import { describe, it, expect } from "vitest";

import {
  aminoAcidChange,
  buildIsoformRemapWarning,
  buildUnverifiedNumberingWarning,
  isCanonicalIsoformId,
  isCanonicallyNumbered,
  MAX_PROTEIN_POSITION,
  normalizeIsoformIds,
  normalizeCanonicalFlag,
  reconcileIsoformNumbering,
  sameAminoAcidChange,
  substitutionSignature,
} from "./isoform-numbering.ts";

/**
 * Regression context (production fatal): ACOT9 `chrX:g.23705858C>A`.
 *
 * VEP numbers the MANE Select consequence on UniProt isoform Q9Y305-4 (p.Lys281Asn) while
 * naming the canonical accession Q9Y305 (isoform Q9Y305-1, where the same residue is K272 and
 * position 281 is L). Pairing the two caused FoldX and the biophysics guard to reject the
 * variant as a "wild-type residue mismatch" — three fatal console entries from one upstream
 * numbering error. A review then showed the first version of this module could (a) substitute
 * a sibling describing a DIFFERENT position, and (b) skip verification entirely on the
 * VariantValidator path. Both are pinned below.
 */

/** The MANE Select consequence VEP reports for that variant (numbering on Q9Y305-4). */
const MANE_CONSEQUENCE = {
  transcript_id: "ENST00000379303",
  canonical: 1,
  mane_select: "NM_001037171.2",
  gene_symbol: "ACOT9",
  hgvsp: "ENSP00000368605.5:p.Lys281Asn",
  amino_acids: "K/N",
  uniprot_isoform: ["Q9Y305-4"],
  swissprot: ["Q9Y305.179"],
};

/** The same substitution as VEP reports it on a canonically-numbered transcript. */
const CANONICAL_CONSEQUENCE = {
  transcript_id: "ENST00000336430",
  canonical: 1,
  gene_symbol: "ACOT9",
  hgvsp: "ENSP00000336580.7:p.Lys272Asn",
  amino_acids: "K/N",
  uniprot_isoform: ["Q9Y305-1"],
  swissprot: ["Q9Y305.179"],
};

describe("isCanonicalIsoformId / isCanonicallyNumbered", () => {
  it("accepts the bare accession and the -1 isoform, including case and zero padding", () => {
    expect(isCanonicalIsoformId("Q9Y305", "Q9Y305")).toBe(true);
    expect(isCanonicalIsoformId("Q9Y305-1", "Q9Y305")).toBe(true);
    expect(isCanonicalIsoformId("q9y305-1", "Q9Y305")).toBe(true);
    expect(isCanonicalIsoformId("Q9Y305-01", "Q9Y305")).toBe(true);
    expect(isCanonicalIsoformId("Q9Y305-4", "Q9Y305")).toBe(false);
  });

  it("reports unknown (undefined) when the provider supplied no isoform metadata", () => {
    expect(isCanonicallyNumbered({ hgvsp: "p.Lys281Asn" }, "Q9Y305")).toBeUndefined();
    expect(isCanonicallyNumbered({ uniprot_isoform: [] }, "Q9Y305")).toBeUndefined();
  });

  it("distinguishes canonical from non-canonical numbering, in either payload shape", () => {
    expect(isCanonicallyNumbered(MANE_CONSEQUENCE, "Q9Y305")).toBe(false);
    expect(isCanonicallyNumbered(CANONICAL_CONSEQUENCE, "Q9Y305")).toBe(true);
    // A mixed array is canonical IF any listed isoform is the canonical one: VEP only lists
    // several isoforms when their sequences (and therefore numbering) agree.
    expect(isCanonicallyNumbered({ uniprot_isoform: ["Q9Y305-4", "Q9Y305-1"] }, "Q9Y305")).toBe(true);
    // The string form used to make the whole payload unusable.
    expect(isCanonicallyNumbered({ uniprot_isoform: "Q9Y305-1" }, "Q9Y305")).toBe(true);
  });
});

describe("payload normalisation helpers", () => {
  it("normalises isoform ids from either shape", () => {
    expect(normalizeIsoformIds("Q9Y305-4")).toEqual(["Q9Y305-4"]);
    expect(normalizeIsoformIds(["Q9Y305-4", ""])).toEqual(["Q9Y305-4"]);
    expect(normalizeIsoformIds(undefined)).toEqual([]);
    expect(normalizeIsoformIds(42)).toEqual([]);
  });

  it("normalises the canonical flag from either shape", () => {
    expect(normalizeCanonicalFlag(1)).toBe(true);
    expect(normalizeCanonicalFlag(true)).toBe(true);
    expect(normalizeCanonicalFlag("1")).toBe(true);
    expect(normalizeCanonicalFlag("true")).toBe(true);
    expect(normalizeCanonicalFlag(0)).toBe(false);
    expect(normalizeCanonicalFlag(undefined)).toBe(false);
  });
});

describe("substitution identity", () => {
  it("derives a position-free identity from amino_acids or from the HGVSp letters", () => {
    expect(aminoAcidChange({ amino_acids: "K/N" })).toBe("K>N");
    expect(aminoAcidChange({ hgvsp: "ENSP1.1:p.Lys281Asn" })).toBe("K>N");
    expect(aminoAcidChange({ hgvsp: "p.K281N" })).toBe("K>N");
    // No-change and unknown forms are NOT substitution identities.
    expect(aminoAcidChange({ hgvsp: "p.(=)" })).toBeUndefined();
    expect(aminoAcidChange({ hgvsp: "p.?" })).toBeUndefined();
  });

  it("never equates two consequences without a derivable identity on both sides", () => {
    expect(sameAminoAcidChange({ amino_acids: "K/N" }, { hgvsp: "p.Lys272Asn" })).toBe(true);
    expect(sameAminoAcidChange({ hgvsp: "p.(=)" }, { hgvsp: "p.?" })).toBe(false);
    expect(sameAminoAcidChange({ amino_acids: "K/N" }, { amino_acids: "K/E" })).toBe(false);
  });

  it("keeps the coarse signature available but documents it as position-agnostic", () => {
    // The signature intentionally collides across positions — which is why it is no longer
    // used as the identity proof.
    expect(substitutionSignature("p.Lys281Asn")).toBe(substitutionSignature("p.Lys231Asn"));
  });
});

describe("reconcileIsoformNumbering", () => {
  it("marks the answer unverified when the provider reported no accession (VariantValidator)", () => {
    const result = reconcileIsoformNumbering(MANE_CONSEQUENCE, [MANE_CONSEQUENCE], undefined);
    expect(result.status).toBe("unverified");
    expect(result.reason).toContain("did not report a UniProt accession");
    expect(result.consequence).toBe(MANE_CONSEQUENCE);
  });

  it("keeps a canonically-numbered selection as canonical", () => {
    const result = reconcileIsoformNumbering(CANONICAL_CONSEQUENCE, [CANONICAL_CONSEQUENCE], "Q9Y305");
    expect(result.status).toBe("canonical");
    expect(result.numberingIsoform).toBe("Q9Y305-1");
    expect(result.consequence).toBe(CANONICAL_CONSEQUENCE);
  });

  it("remaps a non-canonically-numbered selection onto the canonical-numbered sibling", () => {
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, CANONICAL_CONSEQUENCE],
      "Q9Y305"
    );

    expect(result.status).toBe("remapped");
    expect(result.consequence).toBe(CANONICAL_CONSEQUENCE);
    expect(result.fromIsoform).toBe("Q9Y305-4");
    expect(result.numberingIsoform).toBe("Q9Y305-1");
    expect(result.canonicalAccession).toBe("Q9Y305");
  });

  /**
   * The hole a review found in the first version: six of 34 consequences in the live ACOT9
   * payload carry an HGVSp with NO `uniprot_isoform`, several of them reporting the
   * NON-canonical numbering. Absence of metadata was treated as "canonical", so those were
   * returned un-reconciled and (worse) cached for ten years.
   */
  it("infers the basis from a canonically-numbered sibling when metadata is absent", () => {
    const unannotated = { ...MANE_CONSEQUENCE, uniprot_isoform: undefined };
    const result = reconcileIsoformNumbering(
      unannotated,
      [unannotated, CANONICAL_CONSEQUENCE],
      "Q9Y305"
    );
    expect(result.status).toBe("remapped");
    expect(result.consequence).toBe(CANONICAL_CONSEQUENCE);
  });

  it("treats an unannotated selection whose position MATCHES the canonical sibling as canonical", () => {
    const unannotated = {
      transcript_id: "ENST00000216862",
      canonical: 1,
      gene_symbol: "ACOT9",
      hgvsp: "ENSP00000368605.5:p.Lys272Asn",
      amino_acids: "K/N",
    };
    const result = reconcileIsoformNumbering(
      unannotated,
      [unannotated, CANONICAL_CONSEQUENCE],
      "Q9Y305"
    );
    expect(result.status).toBe("canonical");
  });

  it("marks the answer unverified when nothing states or implies the numbering basis", () => {
    const unannotated = { ...MANE_CONSEQUENCE, uniprot_isoform: undefined };
    const result = reconcileIsoformNumbering(unannotated, [unannotated], "Q9Y305");
    expect(result.status).toBe("unverified");
    expect(result.reason).toContain("did not state which UniProt isoform");
  });

  it("refuses when the non-canonical selection has no canonically-numbered sibling", () => {
    const result = reconcileIsoformNumbering(MANE_CONSEQUENCE, [MANE_CONSEQUENCE], "Q9Y305");
    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("no canonically-numbered transcript");
  });

  it("refuses to remap onto a sibling reporting a DIFFERENT substitution", () => {
    // Identity is the amino-acid change, not the position-stripped signature.
    const differentChange = { ...CANONICAL_CONSEQUENCE, hgvsp: "p.Lys272Glu", amino_acids: "K/E" };
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, differentChange],
      "Q9Y305"
    );
    expect(result.status).toBe("unsupported");
  });

  it("refuses when amino_acids contradicts the HGVSp letters (identity must be consistent)", () => {
    const liar = { ...CANONICAL_CONSEQUENCE, amino_acids: "K/E" };
    const result = reconcileIsoformNumbering(MANE_CONSEQUENCE, [MANE_CONSEQUENCE, liar], "Q9Y305");
    expect(result.status).toBe("unsupported");
  });

  it("refuses a sibling from a different gene", () => {
    const otherGene = { ...CANONICAL_CONSEQUENCE, gene_symbol: "SOMETHINGELSE" };
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, otherGene],
      "Q9Y305"
    );
    expect(result.status).toBe("unsupported");
  });

  it("refuses a sibling whose position cannot exist on any protein", () => {
    const impossible = {
      ...CANONICAL_CONSEQUENCE,
      hgvsp: `p.Lys${MAX_PROTEIN_POSITION + 1}Asn`,
    };
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, impossible],
      "Q9Y305"
    );
    expect(result.status).toBe("unsupported");
  });

  it("refuses when canonically-numbered siblings disagree on the numbering offset", () => {
    const conflicting = { ...CANONICAL_CONSEQUENCE, hgvsp: "p.Lys231Asn" };
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, CANONICAL_CONSEQUENCE, conflicting],
      "Q9Y305"
    );
    expect(result.status).toBe("unsupported");
    expect(result.reason).toContain("disagree on the residue position");
  });

  it("prefers the canonical-flagged sibling and reports its isoform", () => {
    const alternative = {
      transcript_id: "ENST00000907180",
      gene_symbol: "ACOT9",
      hgvsp: "ENSP00000577239.1:p.Lys272Asn",
      amino_acids: "K/N",
      uniprot_isoform: ["Q9Y305-1"],
    };
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, alternative, CANONICAL_CONSEQUENCE],
      "Q9Y305"
    );
    expect(result.status).toBe("remapped");
    expect(result.consequence.transcript_id).toBe("ENST00000336430");
  });

  it("accepts a string-form isoform on the selection (payload must not be discarded)", () => {
    const stringForm = { ...MANE_CONSEQUENCE, uniprot_isoform: "Q9Y305-1" };
    const result = reconcileIsoformNumbering(stringForm, [stringForm], "Q9Y305");
    expect(result.status).toBe("canonical");
  });
});

describe("disclosure text", () => {
  it("names both notations and both isoforms for a remap", () => {
    const warning = buildIsoformRemapWarning(
      MANE_CONSEQUENCE.hgvsp,
      CANONICAL_CONSEQUENCE.hgvsp,
      "Q9Y305-4",
      "Q9Y305-1",
      "NM_001037171.2"
    );

    expect(warning).toContain("p.Lys281Asn");
    expect(warning).toContain("p.Lys272Asn");
    expect(warning).toContain("Q9Y305-4");
    expect(warning).toContain("Q9Y305-1");
    expect(warning).toContain("NM_001037171.2");
    expect(warning).toContain("canonical numbering");
  });

  it("states that an unverified numbering was NOT repaired", () => {
    const warning = buildUnverifiedNumberingWarning(
      MANE_CONSEQUENCE.hgvsp,
      "Q9Y305",
      "the provider did not report a UniProt accession to verify the numbering against"
    );
    expect(warning).toContain("could not be verified");
    expect(warning).toContain("Q9Y305");
    expect(warning).toContain("p.Lys281Asn");
    expect(warning).toContain("check the transcript/isoform");
  });
});
