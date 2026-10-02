import { describe, expect, it } from "vitest";
import { buildFrequencyEvidence, summariseReadings, aouSourceLabel } from "../frequencyEvidence";
import { resolveSourceAvailability } from "../evidenceAvailability";
import { getWorkflowStageStatus } from "../workflowStatus";
import type { LocusFailureKind } from "../locusResolution";

const locus = (retryable: boolean, failureKind?: LocusFailureKind) => ({
  predictorData: {
    gnomadVariantAssembly: "GRCh37" as const,
    locusResolution: {
      route: "fallback" as const, canonicalBy: null, retryable, failureKind,
      steps: [{ step: "vep-hgvs" as const, outcome: "failed" as const,
        detail: failureKind === "ambiguous-allele" ? "Could not uniquely determine nucleotide change for Q867H" : "No matching allele" }],
    },
  },
});

const evidence = (retryable: boolean, failureKind?: LocusFailureKind) => buildFrequencyEvidence({
  assembly: "GRCh37", locus: locus(retryable, failureKind),
  serviceStatus: { gnomadFrequency: "not_found" }, engineCriteria: [],
});

describe("locus outcome reconciliation", () => {
  it("Q867H ambiguity requires the original allele without a provider fault or retry", () => {
    const reading = evidence(false, "ambiguous-allele");
    expect(reading.recoveryAction).toBe("provide-allele");
    expect(reading.retryable).toBe(false);
    expect(reading.hasProviderFault).toBe(false);
    expect(reading.criterion.code).toBe("withheld");
    for (const row of reading.observations.filter(o => o.id.startsWith("gnomad"))) {
      expect(row.availability).toMatchObject({ state: "no-result", action: "provide-allele", userActionable: true });
    }
    expect(summariseReadings(reading.observations)?.kind).not.toBe("none-observed");
    expect(getWorkflowStageStatus("evidence", locus(false, "ambiguous-allele") as any).desc).toMatch(/original.*variant/i);
  });

  it("legacy ambiguity text has the same recovery policy", () => {
    const old = locus(false, "ambiguous-allele");
    delete old.predictorData.locusResolution.failureKind;
    const reading = buildFrequencyEvidence({ assembly: "GRCh37", locus: old });
    expect(reading.recoveryAction).toBe("provide-allele");
    expect(reading.hasProviderFault).toBe(false);
  });

  it("generic definitive and typed not-found outcomes offer no retry and assert no outage", () => {
    for (const kind of [undefined, "not-found"] as const) {
      const reading = evidence(false, kind);
      expect(reading.recoveryAction).toBeNull();
      expect(reading.retryable).toBe(false);
      expect(reading.hasProviderFault).toBe(false);
      expect(reading.observations[0].availability).toMatchObject({ state: "no-result", action: null });
      expect(getWorkflowStageStatus("evidence", locus(false, kind) as any).desc).not.toMatch(/retry|lookup failure|did not complete/i);
    }
  });

  it("temporary lookup failures remain retryable provider faults", () => {
    const reading = evidence(true, "transient-provider");
    expect(reading.recoveryAction).toBe("retry");
    expect(reading.retryable).toBe(true);
    expect(reading.hasProviderFault).toBe(true);
  });

  it("available numeric values and recorded ACMG decisions survive ambiguity", () => {
    const reading = buildFrequencyEvidence({
      assembly: "GRCh37", locus: locus(false, "ambiguous-allele"),
      gnomadFrequency: { genomeAF: 0, genomeAC: 0, genomeAN: 100, maxAF: 0 } as any,
      engineCriteria: [{ code: "BS1" }],
    });
    expect(reading.observations.find(o => o.id === "gnomad-genomes")).toMatchObject({ af: 0, ac: 0, an: 100, availability: { state: "available", action: null } });
    expect(reading.applied.code).toBe("BS1");
  });

  it("coordinate-based source refusals use typed input requirements and preserve value/pending precedence", () => {
    for (const source of ["alphagenome", "gpn-star", "popEVE", "splice-proximity"] as const) {
      const refusals = [{ source, reason: `${source} was not queried: original allele needed.`, retryable: false, inputRequired: true, failureKind: "ambiguous-allele" as const }];
      expect(resolveSourceAvailability({ source, refusals })).toMatchObject({ state: "no-result", action: "provide-allele" });
      expect(resolveSourceAvailability({ source, refusals, value: 0 })).toMatchObject({ state: "available", action: null });
      expect(resolveSourceAvailability({ source, refusals, status: "pending" })).toMatchObject({ state: "pending", action: null });
      expect(resolveSourceAvailability({ source, refusals, pending: true })).toMatchObject({ state: "pending", action: null });
      expect(resolveSourceAvailability({ source, refusals: [{ source, reason: "No verified allele", retryable: false }], configured: false })).toMatchObject({ state: "no-result", action: null });
      expect(resolveSourceAvailability({ source, refusals: [{ source, reason: "Build not served" }] })).toMatchObject({ state: "not-covered", action: null });
    }
  });
});


describe("All of Us queried state and source lineage", () => {
  const empty = (aouLookup?: any) => buildFrequencyEvidence({
    assembly: "GRCh37", locus: locus(false, "ambiguous-allele"), aouLookup,
    serviceStatus: { gnomadFrequency: "unsupported-build" },
  });
  const aou = (reading: ReturnType<typeof buildFrequencyEvidence>) => reading.observations.find(o => o.id === "all-of-us")!;

  it("Q867H with all-null evidence and no lookup says no source could be queried", () => {
    const reading = empty();
    expect(summariseReadings(reading.observations)).toEqual({
      kind: "none-queried", text: "No source could be queried for this allele, so population frequency was not assessed.",
    });
    expect(aou(reading)).toMatchObject({ queried: false, dataset: "All of Us (source not reported)", availability: { state: "no-result", action: "provide-allele" } });
    expect(aou(reading).availability.reason).toMatch(/original.*cDNA variant/);
    expect(aou(reading).availability.reason).not.toMatch(/local.*table/);
  });

  it("does not count an uninstalled empty source as answered", () => {
    const reading = buildFrequencyEvidence({ aouLookup: { localTable: "not-installed", remoteDbnsfp: "not-reported" } });
    expect(aou(reading).queried).toBe(false);
    expect(aou(reading).dataset).toBe("All of Us (local table not installed)");
  });

  it("does not count an unreported empty source as answered", () => {
    const reading = buildFrequencyEvidence({ aouLookup: null });
    expect(aou(reading).queried).toBe(false);
    expect(aou(reading).dataset).toBe("All of Us (source not reported)");
  });

  it("explicit local absence is an answered source rather than an invented unknown", () => {
    const reading = buildFrequencyEvidence({
      assembly: "GRCh38", serviceStatus: { gnomadFrequency: "not_found" },
      aouLookup: { localTable: "absent", remoteDbnsfp: "not-reported" },
    });
    expect(aou(reading)).toMatchObject({ queried: true, dataset: "All of Us (local frequency table (no entry))" });
    expect(summariseReadings(reading.observations)).toEqual({ kind: "none-observed", text: "No source reported this allele." });
  });

  it("numeric AF zero outranks absence and does not fabricate local provenance", () => {
    const reading = buildFrequencyEvidence({
      assembly: "GRCh37", locus: locus(false, "ambiguous-allele"),
      aouFrequency: { aouAC: 0, aouAN: 100, aouHet: 0, aouHom: 0 }, aouLookup: null,
    });
    expect(aou(reading)).toMatchObject({ af: 0, ac: 0, an: 100, queried: true, dataset: "All of Us (source not reported)", availability: { state: "available", action: null } });
    expect(summariseReadings(reading.observations)).toBeNull();
    expect(reading.criterion.code).toBe("withheld");
  });

  it("explicit remote proof names dbNSFP rather than a local table", () => {
    const lookup = { localTable: "not-installed", remoteDbnsfp: "found" } as const;
    const reading = buildFrequencyEvidence({ aouLookup: lookup, aouFrequency: { aouAC: 1, aouAN: 100, aouHet: 1, aouHom: 0 } });
    expect(aou(reading).dataset).toBe(`All of Us (${aouSourceLabel(lookup)})`);
    expect(aouSourceLabel(lookup)).toBe("remote dbNSFP");
    expect(aou(reading).queried).toBe(true);
  });

  it.each(["failed", "timed-out"] as const)("keeps explicit %s lookup failures actionable even beside an allele requirement", (localTable) => {
    const reading = empty({ localTable, remoteDbnsfp: "not-reported" });
    expect(aou(reading).availability).toMatchObject({ state: "upstream-error", action: "retry" });
    expect(aou(reading).availability.reason).toMatch(/re-run to retry/);
    expect(reading.hasProviderFault).toBe(true);
  });
});
