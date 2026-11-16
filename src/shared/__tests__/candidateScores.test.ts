import { describe, expect, it } from "vitest";
import { candidateCaddNote } from "../candidateScores";
import { buildPredictorEvidence } from "../predictorEvidence";
import type { AlleleCandidate } from "../locusResolution";

const candidate = (alt: string, caddPhred: number | null, caddSource: string | null = "ProtVar"): AlleleCandidate =>
  ({ grch37Id: null, id: `4-1804392-G-${alt}`, canonicalBy: "protvar", retryable: false, caddPhred, caddSource });

describe("candidateCaddNote", () => {
  it("names each candidate allele's own CADD and its source, and says CADD does not vote", () => {
    expect(candidateCaddNote([candidate("C", 24.5), candidate("A", 25.7, "dbNSFP 5.3a (local)")])).toBe(
      "Each candidate allele has its own CADD: G>C 24.5 from ProtVar; G>A 25.7 from dbNSFP 5.3a (local). No single allele was selected, so CADD does not vote.",
    );
  });

  it("names a candidate without a score, and says nothing for a run without candidates", () => {
    expect(candidateCaddNote([candidate("C", 24.5), candidate("A", null, null)])).toMatch(/G>A not reported/);
    expect(candidateCaddNote(undefined)).toBeNull();
  });
});

describe("Predictors tab CADD reading on a candidate run", () => {
  it("shows no single score and carries every allele's CADD in its note", () => {
    const evidence = buildPredictorEvidence({ result: {
      predictorData: {
        amPathogenicity: 0.9, amClass: "likely_pathogenic", caddPhred: null, gnomadVariantId: null, gnomadVariantAssembly: null,
        locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [], candidates: [candidate("C", 24.5), candidate("A", 25.7)] },
      },
    } as any });
    const cadd = evidence.readings.find(r => r.key === "cadd")!;
    expect(cadd.score).toBeNull();
    expect(cadd.note).toMatch(/G>C 24\.5 from ProtVar; G>A 25\.7 from ProtVar/);
  });
});
