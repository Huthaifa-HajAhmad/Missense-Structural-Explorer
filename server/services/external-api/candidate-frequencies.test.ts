import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PredictorData } from "../../../src/shared/contracts.ts";
import { LOCUS_POLICY_VERSION, type AlleleCandidate } from "../../../src/shared/locusResolution.ts";

const fetchFrequency = vi.hoisted(() => vi.fn());
const fetchLocal = vi.hoisted(() => vi.fn());
vi.mock("./gnomad.ts", () => ({ fetchGnomadVariantFrequency: fetchFrequency }));
vi.mock("../prediction/landscape.ts", () => ({ fetchLocalPopulationFrequencies: fetchLocal }));

import { alleleCandidatesToQuery, fetchCandidateFrequencies } from "./candidate-frequencies.ts";

const lifted = (alt: string): AlleleCandidate => ({ grch37Id: `4-1806119-G-${alt}`, id: `4-1804392-G-${alt}`, canonicalBy: "ensembl-lift", retryable: false });
const record = { maxAF: 0.00001, groupMaxAF: 0.00002, genomeAF: null, exomeAF: 0.00001, genomeAC: null, exomeAC: 2, genomeAN: null, exomeAN: 200000, nHomozygous: 0, dataset: "gnomad_r4" };

const pred = (candidates: AlleleCandidate[], overrides: Partial<NonNullable<PredictorData["locusResolution"]>> = {}): PredictorData => ({
  amPathogenicity: 0.9, amClass: null, caddPhred: null, gnomadVariantId: null, gnomadVariantAssembly: null,
  locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", policyVersion: LOCUS_POLICY_VERSION, steps: [], candidates, ...overrides },
});

beforeEach(() => { fetchFrequency.mockReset(); fetchLocal.mockReset(); });

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
      { id: "4-1804392-G-A", grch37Id: "4-1806119-G-A", outcome: "found", frequency: record, allOfUs: { localTable: "not-installed", frequency: null } },
      { id: "4-1804392-G-C", grch37Id: "4-1806119-G-C", outcome: "not-found", frequency: null, allOfUs: { localTable: "not-installed", frequency: null } },
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

describe("All of Us for each candidate allele", () => {
  const local = { gene: "FGFR3", pos: 380, variant: "p.Gly380Arg" };

  it("reads the local All of Us counts for each lifted candidate's exact GRCh38 allele", async () => {
    fetchFrequency.mockResolvedValue(null);
    const counts = { aouAC: 2, aouAN: 400000, aouHet: 2, aouHom: 0 };
    fetchLocal.mockImplementation(async (_g: string, _p: number, _v: string, coord: { alt: string }) => coord.alt === "A" ? { gnomad: null, aou: counts } : { gnomad: null, aou: null });
    const readings = await fetchCandidateFrequencies([lifted("A"), lifted("C")], {}, local);
    expect(fetchLocal).toHaveBeenCalledWith("FGFR3", 380, "p.Gly380Arg", { chrom: "4", pos: 1804392, ref: "G", alt: "A", assembly: "GRCh38" });
    expect(readings.map(r => r.allOfUs)).toEqual([
      { localTable: "found", frequency: counts },
      { localTable: "absent", frequency: null },
    ]);
  });

  it("says the table is not installed instead of reporting an absence, and records a failed read", async () => {
    fetchFrequency.mockResolvedValue(null);
    expect((await fetchCandidateFrequencies([lifted("A")], {}, null))[0].allOfUs).toEqual({ localTable: "not-installed", frequency: null });
    fetchLocal.mockRejectedValue(new Error("disk"));
    expect((await fetchCandidateFrequencies([lifted("A")], {}, local))[0].allOfUs).toEqual({ localTable: "failed", frequency: null });
  });
});
