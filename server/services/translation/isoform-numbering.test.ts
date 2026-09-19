import { describe, it, expect } from "vitest";

import {
  buildIsoformRemapWarning,
  isCanonicalIsoformId,
  isCanonicallyNumbered,
  reconcileIsoformNumbering,
  substitutionSignature,
} from "./isoform-numbering.ts";

/**
 * Regression context (production fatal): ACOT9 `chrX:g.23705858C>A`.
 *
 * VEP numbers the MANE Select consequence on UniProt isoform Q9Y305-4 (p.Lys281Asn) while
 * naming the canonical accession Q9Y305 (isoform Q9Y305-1, where the same residue is K272
 * and position 281 is L). Pairing the two caused FoldX and the biophysics guard to reject
 * the variant as a "wild-type residue mismatch" — three fatal console entries from one
 * upstream numbering error.
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

describe("isCanonicalIsoformId", () => {
  it("accepts the bare accession and the -1 isoform, and rejects other isoforms", () => {
    expect(isCanonicalIsoformId("Q9Y305", "Q9Y305")).toBe(true);
    expect(isCanonicalIsoformId("Q9Y305-1", "Q9Y305")).toBe(true);
    expect(isCanonicalIsoformId("Q9Y305-4", "Q9Y305")).toBe(false);
    expect(isCanonicalIsoformId("Q9Y305-2", "Q9Y305")).toBe(false);
  });
});

describe("isCanonicallyNumbered", () => {
  it("reports unknown (undefined) when the provider supplied no isoform metadata", () => {
    expect(isCanonicallyNumbered({ hgvsp: "p.Lys281Asn" }, "Q9Y305")).toBeUndefined();
    expect(isCanonicallyNumbered({ uniprot_isoform: [] }, "Q9Y305")).toBeUndefined();
  });

  it("distinguishes canonical from non-canonical numbering", () => {
    expect(isCanonicallyNumbered(MANE_CONSEQUENCE, "Q9Y305")).toBe(false);
    expect(isCanonicallyNumbered(CANONICAL_CONSEQUENCE, "Q9Y305")).toBe(true);
  });
});

describe("substitutionSignature", () => {
  it("ignores the position, so the same change matches across numbering systems", () => {
    expect(substitutionSignature("ENSP00000368605.5:p.Lys281Asn")).toBe("p.lysasn");
    expect(substitutionSignature("p.Lys272Asn")).toBe("p.lysasn");
    expect(substitutionSignature("ENSP00000336580.7:p.Lys272Asn")).toBe(
      substitutionSignature(MANE_CONSEQUENCE.hgvsp)
    );
  });

  it("separates different substitutions and survives no-change notation", () => {
    expect(substitutionSignature("p.Lys272Glu")).not.toBe(substitutionSignature("p.Lys272Asn"));
    expect(substitutionSignature("p.(=)")).toBe("p.=");
    expect(substitutionSignature(undefined)).toBeUndefined();
  });
});

describe("reconcileIsoformNumbering", () => {
  it("keeps the selection when there is no accession to reconcile against", () => {
    // VariantValidator returns neither UniProt nor isoform metadata.
    const result = reconcileIsoformNumbering(MANE_CONSEQUENCE, [MANE_CONSEQUENCE], undefined);
    expect(result.action).toBe("keep");
    expect(result.consequence).toBe(MANE_CONSEQUENCE);
  });

  it("keeps a canonically-numbered selection unchanged", () => {
    const result = reconcileIsoformNumbering(CANONICAL_CONSEQUENCE, [CANONICAL_CONSEQUENCE], "Q9Y305");
    expect(result.action).toBe("keep");
    expect(result.consequence).toBe(CANONICAL_CONSEQUENCE);
  });

  it("keeps the selection when isoform metadata is absent (unknown is not evidence)", () => {
    const noMetadata = { ...MANE_CONSEQUENCE, uniprot_isoform: undefined };
    const result = reconcileIsoformNumbering(noMetadata, [noMetadata], "Q9Y305");
    expect(result.action).toBe("keep");
  });

  it("remaps a non-canonically-numbered selection onto the canonical-numbered sibling", () => {
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, CANONICAL_CONSEQUENCE],
      "Q9Y305"
    );

    expect(result.action).toBe("remap");
    expect(result.consequence).toBe(CANONICAL_CONSEQUENCE);
    if (result.action === "remap") {
      expect(result.fromIsoform).toBe("Q9Y305-4");
      expect(result.toIsoform).toBe("Q9Y305-1");
    }
  });

  it("refuses when no canonically-numbered sibling exists", () => {
    const result = reconcileIsoformNumbering(MANE_CONSEQUENCE, [MANE_CONSEQUENCE], "Q9Y305");
    expect(result.action).toBe("unresolved");
    if (result.action === "unresolved") {
      expect(result.isoform).toBe("Q9Y305-4");
      expect(result.reason).toContain("no canonically-numbered transcript");
    }
  });

  it("refuses to remap onto a sibling reporting a DIFFERENT substitution", () => {
    // A same-position-different-change sibling must never be substituted in: that would
    // analyse a different variant than the one the user asked about.
    const differentChange = { ...CANONICAL_CONSEQUENCE, hgvsp: "p.Lys272Glu", amino_acids: "K/E" };
    const result = reconcileIsoformNumbering(
      MANE_CONSEQUENCE,
      [MANE_CONSEQUENCE, differentChange],
      "Q9Y305"
    );
    expect(result.action).toBe("unresolved");
  });

  it("prefers the Ensembl canonical transcript among several canonical-numbered siblings", () => {
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
    expect(result.action).toBe("remap");
    expect(result.consequence.transcript_id).toBe("ENST00000336430");
  });
});

describe("buildIsoformRemapWarning", () => {
  it("names both notations and both isoforms", () => {
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
});
