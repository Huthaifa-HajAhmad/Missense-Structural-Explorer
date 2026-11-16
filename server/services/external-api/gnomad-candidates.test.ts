import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PredictorData } from "../../../src/shared/contracts.ts";
import { LOCUS_POLICY_VERSION, type AlleleCandidate } from "../../../src/shared/locusResolution.ts";

const fetchFrequency = vi.hoisted(() => vi.fn());
vi.mock("./gnomad.ts", () => ({ fetchGnomadVariantFrequency: fetchFrequency }));

import { alleleCandidatesToQuery, fetchCandidateFrequencies } from "./gnomad-candidates.ts";

const lifted = (alt: string): AlleleCandidate => ({ grch37Id: `4-1806119-G-${alt}`, id: `4-1804392-G-${alt}`, canonicalBy: "ensembl-lift", retryable: false });
const record = { maxAF: 0.00001, groupMaxAF: 0.00002, genomeAF: null, exomeAF: 0.00001, genomeAC: null, exomeAC: 2, genomeAN: null, exomeAN: 200000, nHomozygous: 0, dataset: "gnomad_r4" };

const pred = (candidates: AlleleCandidate[], overrides: Partial<NonNullable<PredictorData["locusResolution"]>> = {}): PredictorData => ({
  amPathogenicity: 0.9, amClass: null, caddPhred: null, gnomadVariantId: null, gnomadVariantAssembly: null,
  locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", policyVersion: LOCUS_POLICY_VERSION, steps: [], candidates, ...overrides },
});

beforeEach(() => { fetchFrequency.mockReset(); });

describe("alleleCandidatesToQuery", () => {
  it("returns the candidates of a current multiple-candidate trail", () => {
    expect(alleleCandidatesToQuery(pred([lifted("A"), lifted("C")]))).toHaveLength(2);
  });

  it("returns null for any other trail, and for an older policy generation", () => {
    expect(alleleCandidatesToQuery(pred([lifted("A"), lifted("C")], { failureKind: "ambiguous-allele" }))).toBeNull();
    expect(alleleCandidatesToQuery(pred([lifted("A"), lifted("C")], { policyVersion: LOCUS_POLICY_VERSION - 1 }))).toBeNull();
    expect(alleleCandidatesToQuery(null)).toBeNull();
  });
});

describe("fetchCandidateFrequencies", () => {
  it("queries gnomAD once per lifted candidate, on GRCh38, and reads 'not found' as its own outcome", async () => {
    fetchFrequency.mockImplementation(async (id: string) => id.endsWith("-A") ? record : null);
    const readings = await fetchCandidateFrequencies([lifted("A"), lifted("C")], { deadlineAt: 1 });
    expect(fetchFrequency).toHaveBeenCalledTimes(2);
    expect(fetchFrequency).toHaveBeenCalledWith("4-1804392-G-A", expect.objectContaining({ assembly: "GRCh38", deadlineAt: 1 }));
    expect(readings).toEqual([
      { id: "4-1804392-G-A", grch37Id: "4-1806119-G-A", outcome: "found", frequency: record },
      { id: "4-1804392-G-C", grch37Id: "4-1806119-G-C", outcome: "not-found", frequency: null },
    ]);
  });

  it("names a candidate whose query failed, and never queries one that was not lifted", async () => {
    fetchFrequency.mockRejectedValue(new Error("gnomAD timed out"));
    const unlifted: AlleleCandidate = { grch37Id: "4-1806119-G-T", id: null, canonicalBy: null, retryable: false };
    const readings = await fetchCandidateFrequencies([lifted("C"), unlifted], {});
    expect(fetchFrequency).toHaveBeenCalledTimes(1);
    expect(readings[0]).toMatchObject({ outcome: "failed", detail: expect.stringContaining("gnomAD timed out") });
    expect(readings[1]).toMatchObject({ outcome: "not-lifted", id: null, detail: expect.stringContaining("GRCh38") });
  });
});
