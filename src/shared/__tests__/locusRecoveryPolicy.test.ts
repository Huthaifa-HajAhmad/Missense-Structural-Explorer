import { describe, expect, it } from "vitest";
import {
  LOCUS_POLICY_VERSION,
  fallbackLocusSentence,
  isRetryableFallbackLocus,
  locusFailureKind,
  locusRecoveryAction,
  locusResolutionSchema,
  type LocusResolution,
} from "../locusResolution";
import { isBuildDegradedResult, predictorDataSchema, conservationDataSchema, analyzeVariantResponseSchema } from "../contracts";

const trail = (overrides: Partial<LocusResolution> = {}): LocusResolution => ({
  route: "fallback", canonicalBy: null, retryable: false,
  policyVersion: LOCUS_POLICY_VERSION, steps: [], ...overrides,
});
const run = (resolution: LocusResolution) => ({
  predictorData: { gnomadVariantId: null, gnomadVariantAssembly: null, locusResolution: resolution },
});

describe("locus recovery policy — humans and agents receive the same remedy", () => {
  it("accepts legacy payloads without adding an invented reason", () => {
    const legacy = { route: "fallback", canonicalBy: null, retryable: false, steps: [] };
    const parsed = locusResolutionSchema.parse(legacy);
    expect(parsed.failureKind).toBeUndefined();
    expect(locusRecoveryAction(run(parsed))).toBeNull();
  });

  it("preserves typed failure fields through the public predictor contract", () => {
    const resolution = trail({ failureKind: "ambiguous-allele" });
    const parsed = predictorDataSchema.parse({ available: true, amPathogenicity: null, amClass: null, caddPhred: null, locusResolution: resolution });
    expect(parsed.locusResolution).toEqual(resolution);
  });

  it("requires the nucleotide allele even when unrelated provider attempts timed out", () => {
    const result = run(trail({ failureKind: "ambiguous-allele", retryable: true }));
    expect(locusFailureKind(result)).toBe("ambiguous-allele");
    expect(locusRecoveryAction(result)).toBe("provide-allele");
    expect(isRetryableFallbackLocus(result)).toBe(false);
    const sentence = fallbackLocusSentence("gnomAD r4", null, { failureKind: "ambiguous-allele", retryable: true });
    expect(sentence).toMatch(/more than one nucleotide allele/);
    expect(sentence).not.toMatch(/re-run|provider|lookup failure/i);
  });

  it("recognizes definitive ambiguity in the original PR #23 trail", () => {
    const result = run(trail({ policyVersion: undefined, retryable: true, steps: [
      { step: "vep-hgvs", outcome: "failed", detail: "Could not uniquely determine nucleotide change" },
      { step: "myvariant", outcome: "failed", detail: "2 distinct loci match this notation; refused as ambiguous" },
    ] }));
    expect(locusRecoveryAction(result)).toBe("provide-allele");
    expect(isRetryableFallbackLocus(result)).toBe(false);
  });

  it("offers retry only for a recorded transient outcome", () => {
    expect(locusRecoveryAction(run(trail({ failureKind: "transient-provider", retryable: true })))).toBe("retry");
    expect(locusRecoveryAction(run(trail({ failureKind: "not-found" })))).toBeNull();
    expect(locusRecoveryAction(run(trail({ failureKind: "incomplete-evidence" })))).toBe("provide-allele");
  });

  it("never asks for input on a verified canonical answer", () => {
    expect(locusRecoveryAction(run(trail({ canonicalBy: "vep", failureKind: "ambiguous-allele" })))).toBeNull();
  });

  it("preserves source-level input remedies through API schema parsing", () => {
    const parsed = conservationDataSchema.parse({ revel: null, gerp: null, phylop: null, consurf: null, assemblyRefusals: [{
      source: "popEVE", reason: "Original nucleotide allele required", retryable: false,
      failureKind: "ambiguous-allele", inputRequired: true,
    }] });
    expect(parsed.assemblyRefusals?.[0].inputRequired).toBe(true);
    expect(parsed.assemblyRefusals?.[0].failureKind).toBe("ambiguous-allele");
  });
});

describe("fallback cache policy migration", () => {
  it("invalidates an old apparently canonical fallback once", () => {
    expect(isBuildDegradedResult(run(trail({ canonicalBy: "dbnsfp-grch38", policyVersion: undefined })))).toBe(true);
  });

  it("migrates pre-trail fallback payloads without discarding healthy VEP caches", () => {
    expect(isBuildDegradedResult({ predictorData: { source: "MyVariant.info & dbNSFP (VEP Fallback)", gnomadVariantAssembly: "GRCh38" } })).toBe(true);
    expect(isBuildDegradedResult({ predictorData: { source: "Ensembl VEP API", gnomadVariantAssembly: "GRCh38" } })).toBe(false);
  });

  it("preserves current definitive input requirements without endless re-querying", () => {
    expect(isBuildDegradedResult(run(trail({ failureKind: "ambiguous-allele" })))).toBe(false);
  });

  it("rejects current transient null-locus bundles", () => {
    expect(isBuildDegradedResult(run(trail({ failureKind: "transient-provider", retryable: true })))).toBe(true);
  });

  it("preserves healthy VEP results written before this policy version", () => {
    expect(isBuildDegradedResult(run({ ...trail(), route: "vep-hgvs", canonicalBy: "vep", policyVersion: undefined }))).toBe(false);
  });

  it("refreshes old intrinsic-ambiguous protein VEP alleles but preserves verified coordinate routes", () => {
    const result = { metadata: { gene: "SLC12A4", variant: "Q867H" }, predictorData: {
      gnomadVariantId: "16-67946177-C-G", gnomadVariantAssembly: "GRCh38" as const,
      locusResolution: { ...trail(), route: "vep-hgvs" as const, canonicalBy: "vep" as const }
    } };
    expect(isBuildDegradedResult(result)).toBe(true);
    expect(isBuildDegradedResult({ ...result, predictorData: { ...result.predictorData, locusResolution: { ...result.predictorData.locusResolution, route: "vep-coordinate" } } })).toBe(false);
    expect(isBuildDegradedResult({ ...result, predictorData: { ...result.predictorData, gnomadVariantId: null, caddPhred: null } })).toBe(false);
    expect(isBuildDegradedResult({ ...result, metadata: { gene: "NAE1", variant: "D116G" } })).toBe(false);
  });

  it.each([
    { aouFrequency: { aouAC: 1, aouAN: 1000 } },
    { conservationData: { aouFrequency: { aouAC: 1, aouAN: 1000 } } },
    { gnomadFrequency: { dataset: "gnomad_r4_local" } }
  ])("migrates legacy protein-selected population bundles only once: %j", (population) => {
    expect(isBuildDegradedResult(population)).toBe(true);
    expect(isBuildDegradedResult({ ...population, metadata: { populationPolicyVersion: LOCUS_POLICY_VERSION } })).toBe(false);
    expect(isBuildDegradedResult({ gnomadFrequency: { dataset: "gnomad_r4" } })).toBe(false);
  });

  it("preserves the additive population-binding version through metadata schema parsing", () => {
    const base = { gene: "SLC12A4", variant: "Q867H", uniprotId: "Q9UP95", residueIndex: 867, wildType: "Q", mutant: "H" };
    expect(analyzeVariantResponseSchema.shape.metadata.parse(base).populationPolicyVersion).toBeUndefined();
    expect(analyzeVariantResponseSchema.shape.metadata.parse({ ...base, populationPolicyVersion: LOCUS_POLICY_VERSION }).populationPolicyVersion).toBe(LOCUS_POLICY_VERSION);
  });
});
