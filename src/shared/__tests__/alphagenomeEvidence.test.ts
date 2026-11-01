/**
 * alphagenomeEvidence.test.ts — the rank-decade helper that replaced the saturation heatmap's and the
 * Landscape inspector's app-defined PP3/BP4 bands for the AVI (doc/ALPHAGENOME_TAB_REVIEW.md, second pass).
 */
import { describe, expect, it } from "vitest";
import { aviFinding, aviRankBand, buildAlphaGenomeEvidence, fmtPercent, fmtPercentAbove, rankHeadline, rankSentence } from "../alphagenomeEvidence";

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

describe("the rank in words", () => {
  it("formats a percentage with a floor, never in exponent form", () => {
    expect(fmtPercent(0.229)).toBe("0.23%");
    expect(fmtPercent(0.0079)).toBe("0.0079%");
    expect(fmtPercent(0.00032)).toBe("<0.001%");
    expect(fmtPercent(0)).toBe("<0.001%");
    expect(fmtPercent(3.47)).toBe("3.5%");
    expect(fmtPercent(31.6)).toBe("32%");
    expect(fmtPercent(100)).toBe("100%");
  });

  it("calls a rank in the top half 'Top X%' and anything lower 'Below the middle'", () => {
    expect(rankHeadline(0.229)).toBe("Top 0.23%");
    expect(rankHeadline(50)).toBe("Top 50%");
    expect(rankHeadline(50.1)).toBe("Below the middle");
    expect(rankHeadline(100)).toBe("Below the middle");
  });

  it("states the share that scores at least as high, which reads the same for every rank", () => {
    expect(rankSentence(0.229)).toBe("0.23% of possible single-letter DNA changes score at least this high");
    expect(rankSentence(100)).toBe("100% of possible single-letter DNA changes score at least this high");
  });

  it("gives '1 in N' only for a rank in the top half", () => {
    const oneIn = (phred: number, topPercentile?: number) =>
      buildAlphaGenomeEvidence({ result: { conservationData: { alphagenome: { status: "live", aviPhred: phred, topPercentile } } } }).oneIn;
    expect(oneIn(26.4, 0.229)).toBe(437);
    expect(oneIn(3, 50)).toBe(2);
    expect(oneIn(1, 79.4)).toBeNull();
    expect(oneIn(0, 100)).toBeNull();
  });
});

describe("aviFinding", () => {
  const finding = (featureAttributions: Record<string, number>) =>
    aviFinding(buildAlphaGenomeEvidence({ result: { conservationData: { alphagenome: { status: "live", aviPhred: 20, featureAttributions } } } }));

  it("says 'input' for one group and lists three groups with commas and one 'and'", () => {
    expect(finding({ AlphaMissense: 0.8, Splicing: 0.1 })?.headline).toBe("Largest input: AlphaMissense.");
    // Conservation 0.3, AlphaMissense 0.2, variant type 0.1 (an indicator) outweigh splicing 0.2.
    expect(finding({ Cactus: 0.3, AlphaMissense: 0.2, "Insertion": 0.1, Splicing: 0.2 })?.headline).toBe(
      "Largest inputs: conservation, AlphaMissense and variant type."
    );
  });

  it("totals only the groups it names", () => {
    // 0.004 of 1.0 is under the 0.5% cut-off, so the named share is 0.8, not 1 - newShare.
    const detail = finding({ AlphaMissense: 0.8, "Insertion": 0.004, Splicing: 0.196 })?.detail ?? "";
    expect(detail).toMatch(/^80% of the total input contribution comes from AlphaMissense \(80%\)\./);
  });

  it("says once what the percentages mean, in either branch", () => {
    const note = "Percentages compare the absolute size of each contribution, ignoring whether it raises or lowers the score. They are not disease-risk percentages.";
    for (const attributions of [{ AlphaMissense: 0.8, Splicing: 0.2 }, { Splicing: 0.8, AlphaMissense: 0.2 }]) {
      const detail = finding(attributions)?.detail ?? "";
      expect(detail).toContain(note);
      expect(detail.split(note)).toHaveLength(2);
    }
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
