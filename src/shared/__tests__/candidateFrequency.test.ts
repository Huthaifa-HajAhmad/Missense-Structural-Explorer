/**
 * The population rule for protein-only input whose change can come from several nucleotide alleles.
 * The person carries ONE of the candidates and we do not know which, so a criterion holds only when
 * it holds for every candidate. Frequencies are never summed: each cut-point is per allele.
 */
import { describe, expect, it } from "vitest";
import { candidatesMeetBs2, decideCandidateFrequency } from "../candidateFrequency";
import type { GnomadCandidateReading } from "../contracts";

const CUT = { standAloneBenign: 0.05, tooCommonForDisorder: 0.01, pm2Ceiling: 0.0001 };

const found = (id: string, groupMaxAF: number, extra: Record<string, unknown> = {}): GnomadCandidateReading => ({
  id, grch37Id: id.replace("-1804392-", "-1806119-"), outcome: "found",
  frequency: { maxAF: groupMaxAF, groupMaxAF, genomeAF: groupMaxAF, exomeAF: null, genomeAC: 1, exomeAC: null, genomeAN: 100, exomeAN: null, nHomozygous: 0, dataset: "gnomad_r4", ...extra },
});
const absent = (id: string): GnomadCandidateReading => ({ id, grch37Id: id, outcome: "not-found", frequency: null });

describe("decideCandidateFrequency", () => {
  it("applies PM2 when every candidate is at or below the ceiling, counting absence as zero", () => {
    const verdict = decideCandidateFrequency([found("4-1804392-G-A", 0.00002), absent("4-1804392-G-C")], CUT);
    expect(verdict).toMatchObject({ kind: "agree", decision: "PM2" });
    expect(verdict.readings.map(r => r.decision)).toEqual(["PM2", "PM2"]);
  });

  it("applies BS1 only when every candidate is above the cut-point, each read on its own FAF95", () => {
    const verdict = decideCandidateFrequency([
      found("4-1804392-G-A", 0.03, { faf95: 0.02 }),
      found("4-1804392-G-C", 0.04, { faf95: 0.015 }),
    ], CUT);
    expect(verdict).toMatchObject({ kind: "agree", decision: "BS1" });
  });

  it("applies no criterion when the candidates fall on different sides of a cut-point", () => {
    const verdict = decideCandidateFrequency([found("4-1804392-G-A", 0.03, { faf95: 0.02 }), absent("4-1804392-G-C")], CUT);
    expect(verdict.kind).toBe("mixed");
    expect(verdict.readings.map(r => r.decision)).toEqual(["BS1", "PM2"]);
  });

  it("does not sum frequencies: two candidates each below BS1 stay below it", () => {
    const verdict = decideCandidateFrequency([found("4-1804392-G-A", 0.006), found("4-1804392-G-C", 0.006)], CUT);
    expect(verdict).toMatchObject({ kind: "agree", decision: "none" });
  });

  it("withholds and names the candidate whose lift or query failed", () => {
    const failed: GnomadCandidateReading = { id: "4-1804392-G-C", grch37Id: "4-1806119-G-C", outcome: "failed", frequency: null, detail: "gnomAD timed out" };
    const unlifted: GnomadCandidateReading = { id: null, grch37Id: "4-1806119-G-T", outcome: "not-lifted", frequency: null };
    const verdict = decideCandidateFrequency([absent("4-1804392-G-A"), failed, unlifted], CUT);
    expect(verdict.kind).toBe("failed");
    if (verdict.kind !== "failed") return;
    expect(verdict.failed.map(c => c.grch37Id)).toEqual(["4-1806119-G-C", "4-1806119-G-T"]);
  });

  it("withholds a found candidate that carries no usable frequency", () => {
    const empty: GnomadCandidateReading = { ...found("4-1804392-G-A", 0), frequency: { ...found("x", 0).frequency!, maxAF: null, groupMaxAF: null } };
    expect(decideCandidateFrequency([empty, absent("4-1804392-G-C")], CUT).kind).toBe("failed");
  });
});

describe("candidatesMeetBs2", () => {
  it("holds only when every candidate has at least two homozygotes", () => {
    const hom = (id: string, n: number) => found(id, 0.02, { nHomozygous: n });
    expect(candidatesMeetBs2([hom("4-1-G-A", 3), hom("4-1-G-C", 2)])).toBe(true);
    expect(candidatesMeetBs2([hom("4-1-G-A", 3), hom("4-1-G-C", 1)])).toBe(false);
    expect(candidatesMeetBs2([hom("4-1-G-A", 3), absent("4-1-G-C")])).toBe(false);
    expect(candidatesMeetBs2([])).toBe(false);
  });
});
