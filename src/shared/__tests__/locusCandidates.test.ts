import { describe, expect, it } from "vitest";
import {
  fallbackCause, fallbackLocusShortLabel, locusFailureKind, locusRecoveryAction, locusResolutionSchema,
  type AlleleCandidate,
} from "../locusResolution";

const lifted = (alt: string): AlleleCandidate => ({ grch37Id: `4-1806119-G-${alt}`, id: `4-1804392-G-${alt}`, canonicalBy: "ensembl-lift", retryable: false });

const result = (candidates: AlleleCandidate[]) => ({
  predictorData: {
    gnomadVariantId: null,
    gnomadVariantAssembly: null,
    locusResolution: locusResolutionSchema.parse({
      route: "fallback", canonicalBy: null, retryable: candidates.some(c => c.retryable),
      failureKind: "multiple-candidates", candidates, steps: [],
    }),
  },
});

describe("multiple candidate alleles", () => {
  it("is its own state on the wire, carrying every candidate", () => {
    const parsed = result([lifted("A"), lifted("C")]);
    expect(locusFailureKind(parsed)).toBe("multiple-candidates");
    expect(parsed.predictorData.locusResolution.candidates).toHaveLength(2);
  });

  it("asks for nothing when every candidate has a verified GRCh38 position", () => {
    expect(locusRecoveryAction(result([lifted("A"), lifted("C")]))).toBeNull();
  });

  it("offers a re-run when a candidate's lift failed transiently, and asks for the allele otherwise", () => {
    const transient = { ...lifted("C"), id: null, canonicalBy: null, retryable: true };
    expect(locusRecoveryAction(result([lifted("A"), transient]))).toBe("retry");
    expect(locusRecoveryAction(result([lifted("A"), { ...transient, retryable: false }]))).toBe("provide-allele");
  });

  it("explains single-allele sources without asking for input or claiming an allele was chosen", () => {
    const cause = fallbackCause(null, false, "multiple-candidates");
    expect(cause).toMatch(/more than one nucleotide allele/);
    expect(cause).toMatch(/no allele was selected/);
    expect(cause).not.toMatch(/Provide/);
    expect(fallbackLocusShortLabel(null, "multiple-candidates")).toBe("Several candidate alleles");
  });
});

describe("candidate readings on the wire", () => {
  it("keeps per-allele gnomAD readings and the locus candidates through the response schemas", async () => {
    const { analyzeVariantResponseSchema, predictorDataSchema } = await import("../contracts");
    const readings = [
      { id: "4-1804392-G-A", grch37Id: "4-1806119-G-A", outcome: "not-found", frequency: null },
      { id: null, grch37Id: "4-1806119-G-C", outcome: "not-lifted", frequency: null, detail: "no verified GRCh38 position" },
    ];
    const gnomad = analyzeVariantResponseSchema.shape.gnomadFrequency.parse({
      maxAF: null, genomeAF: null, exomeAF: null, nHomozygous: null, dataset: "gnomad_r4", candidates: readings,
    });
    expect(gnomad?.candidates).toEqual(readings);
    const pred = predictorDataSchema.parse({ amPathogenicity: null, amClass: null, caddPhred: null, ...result([lifted("A"), lifted("C")]).predictorData });
    expect(pred.locusResolution?.candidates).toHaveLength(2);
  });
});
