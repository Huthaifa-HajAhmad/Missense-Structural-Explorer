import { describe, it, expect } from "vitest";
import { deriveNarrativeAuthorship } from "../narrativeAuthorship";

/**
 * One answer to "did a model write the prose on screen".
 *
 * Three surfaces answered it three ways (`ClinicalInsightsCard` from the fallback verdict,
 * `NarrativeProvenanceRow` from the payload's `source` field when present, `ClinicalReportBar` from
 * `!isFallback`), and the route stamps `source` only when `insights` is truthy — so a response whose
 * insights failed to parse carries prose with no field at all and each surface decided differently.
 *
 * The asymmetry the tests below pin: presenting rule-based prose as a model's OVERSTATES its
 * provenance, while the reverse understates it. Only the first is a claim a curator would act on
 * differently, so degradation wins over the payload field.
 */

describe("deriveNarrativeAuthorship", () => {
  it("reports a model's prose when the route says so", () => {
    expect(
      deriveNarrativeAuthorship({ analysis: "A narrative.", isDegraded: false, declaredSource: "ai_inference" })
    ).toBe("ai");
  });

  it("reports rule-based prose when the route says so", () => {
    expect(
      deriveNarrativeAuthorship({ analysis: "Assembled from database evidence.", isDegraded: false, declaredSource: "rule_based" })
    ).toBe("rule-based");
  });

  it("lets degradation override a payload that claims a model wrote it", () => {
    // The direction that matters. A stale or wrongly-stamped `source` must not make rule-based prose
    // read as a model's interpretation of the patient's variant.
    expect(
      deriveNarrativeAuthorship({ analysis: "Rule-based report.", isDegraded: true, declaredSource: "ai_inference" })
    ).toBe("rule-based");
    expect(
      deriveNarrativeAuthorship({ analysis: "Rule-based report.", isDegraded: true, declaredSource: "rule_based" })
    ).toBe("rule-based");
  });

  it("falls back to the prose itself when the payload carries no provenance field", () => {
    // The zod/JSON-parse failure path: prose exists, no `source` was ever stamped.
    expect(deriveNarrativeAuthorship({ analysis: "A narrative.", isDegraded: false })).toBe("ai");
    expect(deriveNarrativeAuthorship({ analysis: "A narrative.", isDegraded: false, declaredSource: null })).toBe("ai");
  });

  it("reports no narrative when there is neither prose nor degradation", () => {
    for (const analysis of ["", "   ", null, undefined]) {
      expect(deriveNarrativeAuthorship({ analysis, isDegraded: false }), String(analysis)).toBe("none");
    }
  });

  it("reports rule-based for a degraded run even before any prose is set", () => {
    // `narrativeService`'s catch installs the fallback prose and the degraded flags together, so this
    // is the ordering-safe answer rather than an edge case.
    expect(deriveNarrativeAuthorship({ analysis: "", isDegraded: true })).toBe("rule-based");
  });

  it("ignores a source value it does not recognise", () => {
    // A future or corrupted value must not be read as either claim.
    expect(
      deriveNarrativeAuthorship({ analysis: "A narrative.", isDegraded: false, declaredSource: "something_else" })
    ).toBe("ai");
    expect(deriveNarrativeAuthorship({ analysis: "", isDegraded: false, declaredSource: "something_else" })).toBe("none");
  });
});
