import { describe, expect, it } from "vitest";
import type { PredictorData } from "../../../../src/shared/contracts.ts";
import { verifiedPopulationCoordinate } from "./allele-identity.ts";

const healthy = { available: true, gnomadVariantId: "1-100-C-A", gnomadVariantAssembly: "GRCh38", source: "Ensembl VEP API" } as PredictorData;
describe("verified cohort allele identity", () => {
  it("preserves healthy legacy VEP and policy2 canonical fallback", () => {
    expect(verifiedPopulationCoordinate(healthy)).toEqual({ chrom: "1", pos: 100, ref: "C", alt: "A", assembly: "GRCh38" });
    expect(verifiedPopulationCoordinate({ ...healthy, source: "MyVariant fallback", locusResolution: {
      route: "fallback", canonicalBy: "dbnsfp-grch38", retryable: false, policyVersion: 2, steps: [],
    } })).not.toBeNull();
  });
  it.each(["MyVariant", "dbNSFP", "VEP Fallback"])("rejects legacy source-labelled %s without a verified trail", source => {
    expect(verifiedPopulationCoordinate({ ...healthy, source })).toBeNull();
  });
  it.each(["1-100junk-C-A", "1-100.5-C-A", "1-Infinity-C-A", "1-100-N-A", "1-100-C-C", "bad-100-C-A"])("rejects malformed genomic ID %s", gnomadVariantId => {
    expect(verifiedPopulationCoordinate({ ...healthy, gnomadVariantId })).toBeNull();
  });
  it.each(["ambiguous-allele", "incomplete-evidence", "invalid-notation"] as const)("rejects contradictory canonical trails carrying %s", failureKind => {
    expect(verifiedPopulationCoordinate({ ...healthy, locusResolution: {
      route: "fallback", canonicalBy: "dbnsfp-grch38", retryable: false, policyVersion: 2, failureKind, steps: [],
    } })).toBeNull();
  });
});
