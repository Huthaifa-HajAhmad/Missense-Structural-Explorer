import { describe, it, expect } from "vitest";

import { stripAccessionPrefix, variantNumberingView } from "../numbering";

/**
 * One policy for "reported vs modelled", because a surface that shows only one of the two is wrong in a
 * different way: canonical-only makes a clinician re-map their lab's notation by hand, reported-only
 * hides the basis the numbers were computed on.
 *
 * Real case (the one that prompted this): a coordinate resolves to MANE `NM_001037171.2:p.Lys281Asn`
 * (isoform Q9Y305-4) and is modelled as `p.Lys272Asn` on canonical Q9Y305.
 */
const ACOT9_REMAP = {
  reason: "MANE numbering remapped onto the canonical isoform",
  from: {
    hgvsp: "ENSP00000368605.5:p.Lys281Asn",
    transcriptId: "ENST00000379303",
    isoform: "Q9Y305-4",
    maneRefSeqId: "NM_001037171.2",
  },
  to: { hgvsp: "ENSP00000336580.7:p.Lys272Asn", transcriptId: "ENST00000336430", isoform: "Q9Y305-1" },
};

describe("variantNumberingView", () => {
  it("leads with the reported (lab/MANE) notation and keeps the modelled basis", () => {
    const view = variantNumberingView({
      variant: "p.Lys272Asn",
      uniprotId: "Q9Y305",
      numberingRemap: ACOT9_REMAP,
    });

    expect(view.remapped).toBe(true);
    expect(view.display).toBe("p.Lys281Asn");
    // Prefix stripped, and re-runnable for THIS platform (a bare p.Lys281Asn would be ambiguous).
    expect(view.reported).toBe("p.Lys281Asn");
    expect(view.reportedQualified).toBe("Q9Y305-4:p.Lys281Asn");
    expect(view.modelled).toBe("p.Lys272Asn");
    expect(view.reportedRefSeqId).toBe("NM_001037171.2");
    expect(view.basisNote).toContain("Reported as p.Lys281Asn on Q9Y305-4");
    expect(view.basisNote).toContain("modelled as p.Lys272Asn on canonical Q9Y305");
  });

  it("falls back to the accession when the provider named no isoform", () => {
    const view = variantNumberingView({
      variant: "p.Lys272Asn",
      uniprotId: "Q9Y305",
      numberingRemap: {
        reason: "mapped",
        from: { hgvsp: "NP_001032248.1:p.Lys281Asn", accession: "NP_001032248.1", maneRefSeqId: "NM_001037171.2" },
      },
    });

    expect(view.display).toBe("p.Lys281Asn");
    expect(view.reportedQualified).toBe("NP_001032248.1:p.Lys281Asn");
    expect(view.reportedBasisId).toBe("NP_001032248.1");
  });

  it("does NOT invent a discrepancy when the reported notation is the modelled one", () => {
    // Providers echo the same notation in both fields. Showing that as "reported vs modelled" would
    // claim a conversion that never happened.
    const view = variantNumberingView({
      variant: "p.Lys272Asn",
      uniprotId: "Q9Y305",
      numberingRemap: { reason: "same", from: { hgvsp: "ENSP00000336580.7:p.Lys272Asn", isoform: "Q9Y305-1" } },
    });

    expect(view.remapped).toBe(false);
    expect(view.display).toBe("p.Lys272Asn");
    expect(view.reported).toBeNull();
    expect(view.reportedQualified).toBeNull();
    expect(view.basisNote).toBeNull();
  });

  it("has nothing to say when there was no remap at all", () => {
    const view = variantNumberingView({ variant: "p.Arg408Trp", uniprotId: "P00439" });

    expect(view.remapped).toBe(false);
    expect(view.display).toBe("p.Arg408Trp");
    expect(view.modelled).toBe("p.Arg408Trp");
    expect(view.basisNote).toBeNull();
  });
});

describe("stripAccessionPrefix", () => {
  it("removes a protein prefix and leaves a bare notation alone", () => {
    expect(stripAccessionPrefix("ENSP00000368605.5:p.Lys281Asn")).toBe("p.Lys281Asn");
    expect(stripAccessionPrefix("NP_001032248.1:p.Lys281Asn")).toBe("p.Lys281Asn");
    expect(stripAccessionPrefix("p.Lys272Asn")).toBe("p.Lys272Asn");
    expect(stripAccessionPrefix(undefined)).toBeNull();
    expect(stripAccessionPrefix("   ")).toBeNull();
  });
});
