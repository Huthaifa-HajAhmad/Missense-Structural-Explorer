/**
 * alphagenomeEvidence.test.ts — the rank-decade helper that replaced the saturation heatmap's and the
 * Landscape inspector's app-defined PP3/BP4 bands for the AVI (doc/ALPHAGENOME_TAB_REVIEW.md, second pass).
 */
import { describe, expect, it } from "vitest";
import { aviRankBand, buildAlphaGenomeEvidence, fmtPercentAbove } from "../alphagenomeEvidence";

describe("fmtPercentAbove", () => {
  it("states the rank as the share of SNVs it outranks, without asking the reader to invert it", () => {
    expect(fmtPercentAbove(0.23)).toBe("99.77%");
    expect(fmtPercentAbove(10)).toBe("90%");
    expect(fmtPercentAbove(0.001)).toBe("99.999%");
    // A 0 or absent top-percent never produces a negative or over-100 claim.
    expect(fmtPercentAbove(0)).toBe("100%");
    expect(fmtPercentAbove(100)).toBe("0%");
  });
});

describe("aviRankBand", () => {
  it("reads the Phred's own decades: 10 = top 10%, 20 = top 1%, 30 = top 0.1%", () => {
    expect(aviRankBand(9.9)?.label).toBe("below the top 10%");
    expect(aviRankBand(10)?.label).toBe("top 10%");
    expect(aviRankBand(24.6)?.label).toBe("top 1%");
    expect(aviRankBand(35)?.label).toBe("top 0.1%");
    expect(aviRankBand(41)?.level).toBe(4);
  });

  it("gives no band to an absent or invalid score, and never an ACMG word", () => {
    expect(aviRankBand(null)).toBeNull();
    expect(aviRankBand(undefined)).toBeNull();
    expect(aviRankBand(Number.NaN)).toBeNull();
    expect(aviRankBand(-1)).toBeNull();
    for (const p of [0, 5, 8, 15, 25, 35, 50]) expect(aviRankBand(p)?.label).not.toMatch(/PP3|BP4|benign|pathogenic/i);
  });
});

describe("the score split by origin", () => {
  it("puts the ten molecular predictions under 'new' and everything else under 'reused'", () => {
    const ev = buildAlphaGenomeEvidence({
      result: { conservationData: { alphagenome: { status: "live", aviPhred: 24.6, featureAttributions: { Splicing: 0.25, AlphaMissense: 0.25, Cactus: 0.5 } } } },
    });
    expect(ev.origins?.map(o => o.origin)).toEqual(["new", "reused"]);
    expect(ev.newShare).toBeCloseTo(0.25);
    expect(ev.origins?.[1].share).toBeCloseTo(0.75);
    expect(ev.largestMolecular?.id).toBe("MERGED_SPLICING");
  });

  it("has no split when no feature vector arrived (absent is not zero)", () => {
    const ev = buildAlphaGenomeEvidence({ result: { conservationData: { alphagenome: { status: "live", aviPhred: 22, featureAttributions: null } } } });
    expect(ev.origins).toBeNull();
    expect(ev.newShare).toBeNull();
  });
});
