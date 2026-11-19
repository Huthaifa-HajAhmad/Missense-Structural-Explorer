import { describe, expect, it } from "vitest";
import type { PredictorData } from "../../../../src/shared/contracts.ts";
import { verifiedCandidateCoordinates, verifiedPopulationCoordinate } from "./allele-identity.ts";
import { LOCUS_POLICY_VERSION } from "../../../../src/shared/locusResolution.ts";

const healthy = { available: true, gnomadVariantId: "1-100-C-A", gnomadVariantAssembly: "GRCh38", source: "Ensembl VEP API" } as PredictorData;
describe("verified cohort allele identity", () => {
  it("preserves healthy legacy VEP and a current-policy canonical fallback, not an older policy's", () => {
    expect(verifiedPopulationCoordinate(healthy)).toEqual({ chrom: "1", pos: 100, ref: "C", alt: "A", assembly: "GRCh38" });
    const fallback = (policyVersion: number) => ({ ...healthy, source: "MyVariant fallback", locusResolution: {
      route: "fallback" as const, canonicalBy: "dbnsfp-grch38" as const, retryable: false, policyVersion, steps: [],
    } });
    expect(verifiedPopulationCoordinate(fallback(LOCUS_POLICY_VERSION))).not.toBeNull();
    expect(verifiedPopulationCoordinate(fallback(LOCUS_POLICY_VERSION - 1))).toBeNull();
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

describe("verified candidate alleles", () => {
  const lifted = (id: string | null) => ({ id, grch37Id: null, canonicalBy: id ? "protvar" as const : null, retryable: false });
  it("reads every candidate's GRCh38 coordinate, keeping each allele", () => {
    expect(verifiedCandidateCoordinates([lifted("4-1804392-G-A"), lifted("4-1804392-G-C")])).toEqual([
      { chrom: "4", pos: 1804392, ref: "G", alt: "A", assembly: "GRCh38" },
      { chrom: "4", pos: 1804392, ref: "G", alt: "C", assembly: "GRCh38" },
    ]);
  });
  it("gives none when any candidate has no verified GRCh38 position", () => {
    expect(verifiedCandidateCoordinates([lifted("4-1804392-G-A"), lifted(null)])).toBeNull();
  });
  it.each(["4-1804392junk-G-A", "4-1804392-N-A", "4-1804392-G-G", "4-1804392-GG-A"])("gives none for the malformed id %s", id => {
    expect(verifiedCandidateCoordinates([lifted("4-1804392-G-C"), lifted(id)])).toBeNull();
  });
  it.each(["4:1804392:G:C", "4-1804392-G>C"])("reads the id %s the way the single-allele path does", id => {
    expect(verifiedCandidateCoordinates([lifted(id)])).toEqual([{ chrom: "4", pos: 1804392, ref: "G", alt: "C", assembly: "GRCh38" }]);
  });
  it("gives none for an empty list", () => {
    expect(verifiedCandidateCoordinates([])).toBeNull();
  });
});
