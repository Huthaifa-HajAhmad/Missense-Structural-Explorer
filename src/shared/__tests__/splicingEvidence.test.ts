import { describe, it, expect } from "vitest";
import { deriveSplicingEvidence } from "../splicingEvidence.ts";
import { THRESHOLDS } from "../thresholds/constants.ts";
import { evaluateSplicePredictor } from "../thresholds/evaluators.ts";
import type { AnalysisResult } from "../contracts.ts";

/**
 * Regression suite for the shared splicing derivation.
 *
 * This module is the single source of display labels, severity bands and ACMG rule
 * outcomes for BOTH the RNA Splicing tab and its inspector sidebar. The bugs these
 * tests pin were all real:
 *
 *   - a KPI/prose label reading "Preserved" for a position no predictor scored
 *   - a panel chip that was green no matter how disruptive the variant was
 *   - "all four channels below threshold" asserted from four null channels
 *   - the tab and the sidebar disagreeing because they passed different inputs
 *
 * A table-driven test here is cheap; every one of those defects was a labelling bug
 * that a single assertion would have caught.
 */

/** Minimal AnalysisResult carrying only the conservation evidence under test. */
function makeResult(conservation: Record<string, any>): AnalysisResult {
  return { conservationData: conservation } as unknown as AnalysisResult;
}

const MODERATE = THRESHOLDS.spliceai.pathogenicModerate; // 0.20
const CRITICAL_BP = THRESHOLDS.spliceai.proximityCriticalBp; // 5
const CONSENSUS_BP = THRESHOLDS.spliceai.consensusFlankDistance; // 12

describe("deriveSplicingEvidence — coverage absence vs. measured result", () => {
  it("returns null only when there is no result", () => {
    expect(deriveSplicingEvidence(null)).toBeNull();
    expect(deriveSplicingEvidence(undefined)).toBeNull();
  });

  it("flags coverage absence when neither predictor scored the position", () => {
    // The MACO1 p.Glu433Lys shape: 16 bp out, no SpliceAI, no dbscSNV.
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 16, isNearSpliceSite: false, junctionType: "donor", regionType: "exonic" },
        spliceai: null,
        dbscsnv: null
      })
    )!;

    expect(m.isPredictorCoverageAbsent).toBe(true);
    expect(m.isSplicingDisrupted).toBe(false);
    // The evaluator must agree that this is indeterminate, not benign.
    expect(m.verdict).toBe("unavailable");
    expect(m.verdictLabel).toBe("Unavailable / Unmapped");
  });

  it("does NOT report coverage absence when SpliceAI returned a score", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 },
        dbscsnv: null
      })
    )!;

    expect(m.isPredictorCoverageAbsent).toBe(false);
    expect(m.dsSeverity).toBe("low");
  });

  it("treats an all-null channel object as no measurement, not as a benign call", () => {
    // dbNSFP often yields the SpliceAI object with every channel null.
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: { ds_ag: null, ds_al: null, ds_dg: null, ds_dl: null, max_ds: null },
        dbscsnv: null
      })
    )!;

    expect(m.isPredictorCoverageAbsent).toBe(true);
    expect(m.dsSeverity).toBe("unannotated");
    expect(m.verdict).toBe("unavailable");
  });
});

describe("deriveSplicingEvidence — isSplicingDisrupted (the green-chip regression)", () => {
  it("is true for a high SpliceAI delta, however far from the junction", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 40, isNearSpliceSite: false },
        spliceai: { ds_ag: 0.95, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.95 },
        dbscsnv: null
      })
    )!;

    expect(m.isSplicingDisrupted).toBe(true);
    expect(m.dsSeverity).toBe("high");
    expect(m.verdict).toBe("pathogenic");
  });

  it("is true at exactly the moderate threshold, and false just below it", () => {
    const at = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 40, isNearSpliceSite: false },
        spliceai: { ds_ag: MODERATE, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: MODERATE },
        dbscsnv: null
      })
    )!;
    expect(at.isSplicingDisrupted).toBe(true);

    const below = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 40, isNearSpliceSite: false },
        spliceai: { ds_ag: MODERATE - 0.01, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: MODERATE - 0.01 },
        dbscsnv: null
      })
    )!;
    expect(below.isSplicingDisrupted).toBe(false);
  });

  it("is true for an altering dbscSNV ensemble even with a low SpliceAI delta", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 30, isNearSpliceSite: false },
        spliceai: { ds_ag: 0.01, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.01 },
        dbscsnv: { ada_score: 0.9, rf_score: 0.2 }
      })
    )!;

    expect(m.isDbscAltering).toBe(true);
    expect(m.isSplicingDisrupted).toBe(true);
  });

  it("is true on junction proximity, and false well outside it", () => {
    const near = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 2, isNearSpliceSite: true },
        spliceai: null,
        dbscsnv: null
      })
    )!;
    expect(near.isSplicingDisrupted).toBe(true);
    expect(near.proximitySeverity).toBe("critical");

    const far = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: CONSENSUS_BP + 1, isNearSpliceSite: false },
        spliceai: { ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0 },
        dbscsnv: null
      })
    )!;
    expect(far.isSplicingDisrupted).toBe(false);
    expect(far.proximitySeverity).toBe("outside");
  });

  it("NEVER reports disruption without a positive signal (guards the green chip)", () => {
    // Whatever combination of absent data is fed in, the predicate must stay false so
    // the UI can never paint a red KPI beside a green "no disruption" chip.
    const cases = [
      { spliceProximity: null, spliceai: null, dbscsnv: null },
      { spliceProximity: { distance: 300, isNearSpliceSite: false }, spliceai: null, dbscsnv: null },
      { spliceProximity: { distance: 16, isNearSpliceSite: false }, spliceai: null, dbscsnv: null }
    ];

    for (const conservation of cases) {
      const m = deriveSplicingEvidence(makeResult(conservation))!;
      expect(m.isSplicingDisrupted).toBe(false);
      expect(m.dsSeverity === "high" || m.dsSeverity === "moderate").toBe(false);
    }
  });
});

describe("deriveSplicingEvidence — labels agree with the evaluator", () => {
  it("verdictLabel always tracks evaluateSplicePredictor on the same inputs", () => {
    const scenarios: Array<Record<string, any>> = [
      { spliceProximity: null, spliceai: null, dbscsnv: null },
      {
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: { ds_ag: 0.95, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.95 },
        dbscsnv: null
      },
      {
        spliceProximity: { distance: 2, isNearSpliceSite: true },
        spliceai: { ds_ag: 0.01, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.01 },
        dbscsnv: null
      },
      {
        spliceProximity: { distance: 20, isNearSpliceSite: false },
        spliceai: { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0.01, ds_dl: 0.01, max_ds: 0.01 },
        dbscsnv: null
      },
      {
        spliceProximity: { distance: 20, isNearSpliceSite: false },
        spliceai: null,
        dbscsnv: { ada_score: 0.9, rf_score: 0.9 }
      }
    ];

    for (const c of scenarios) {
      const m = deriveSplicingEvidence(makeResult(c))!;
      const expected = evaluateSplicePredictor(c.spliceProximity, c.spliceai, c.dbscsnv);
      expect(m.verdict).toBe(expected);

      const expectedLabel =
        expected === "pathogenic"
          ? "Pathogenic Supporting (PP3)"
          : expected === "benign"
          ? "Benign Supporting (BP4)"
          : expected === "unavailable"
          ? "Unavailable / Unmapped"
          : "VUS / Indeterminate";
      expect(m.verdictLabel).toBe(expectedLabel);
    }
  });

  it("coverage absence is exactly the evaluator's 'unavailable' verdict", () => {
    const cases: Array<Record<string, any>> = [
      { spliceProximity: { distance: 16, isNearSpliceSite: false }, spliceai: null, dbscsnv: null },
      { spliceProximity: null, spliceai: null, dbscsnv: null },
      {
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: { ds_ag: null, ds_al: null, ds_dg: null, ds_dl: null, max_ds: null },
        dbscsnv: null
      }
    ];

    for (const c of cases) {
      const m = deriveSplicingEvidence(makeResult(c))!;
      expect(m.isPredictorCoverageAbsent).toBe(m.verdict === "unavailable");
    }
  });
});

describe("deriveSplicingEvidence — ACMG rule outcomes", () => {
  it("marks rules N/A (null) rather than 'not met' when a predictor has no score", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: null,
        dbscsnv: null
      })
    )!;

    // No score => not applicable, which is clinically different from "not met".
    const spliceAiRow = m.pathogenicRules.find(r => r.label.startsWith("SpliceAI"))!;
    expect(spliceAiRow.met).toBeNull();

    const distanceRow = m.pathogenicRules.find(r => r.label.startsWith("Proximity"))!;
    expect(distanceRow.met).toBe(false);

    for (const r of m.benignRules) {
      expect(r.met).toBeNull();
    }
  });

  it("reports the proximity rule as met inside the critical band", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: CRITICAL_BP, isNearSpliceSite: true },
        spliceai: null,
        dbscsnv: null
      })
    )!;

    const distanceRow = m.pathogenicRules.find(r => r.label.startsWith("Proximity"))!;
    expect(distanceRow.met).toBe(true);
  });

  it("exposes no rulesMet bookkeeping (dead surface removed)", () => {
    const m = deriveSplicingEvidence(makeResult({}))!;
    expect((m as any).rulesMet).toBeUndefined();
  });
});

describe("deriveSplicingEvidence — AlphaGenome attribution keying", () => {
  it("reads the REST-bridge raw key", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        alphagenome: { featureAttributions: { fi_MERGED_SPLICING: 0.42 }, topModality: "DNase" }
      })
    )!;
    expect(m.splicingAttribution).toBeCloseTo(0.42, 5);
  });

  it("reads the gRPC display name ('Splicing'), not just the raw key", () => {
    // AVI_FEATURE_DISPLAY_MAP maps MERGED_SPLICING -> "Splicing"; reading only the
    // raw key discarded a real attribution and rendered a false "N/A".
    const m = deriveSplicingEvidence(
      makeResult({
        alphagenome: { featureAttributions: { Splicing: 0.31 }, topModality: "DNase" }
      })
    )!;
    expect(m.splicingAttribution).toBeCloseTo(0.31, 5);
    expect(m.isSplicingDominant).toBe(true);
  });

  it("does not misattribute a non-splicing modality as a splicing score", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        alphagenome: {
          status: "live",
          featureAttributions: { DNase: 0.9 },
          topModality: "DNase",
          topFeatureImportance: 0.9
        }
      })
    )!;
    expect(m.splicingAttribution).toBeNull();
    expect(m.isSplicingDominant).toBe(false);
    expect(m.hasAlphaGenome).toBe(true);
  });

  it("reports hasAlphaGenome=false when the provider returned a standby/error object", () => {
    // The bridge returns a FULL object with status "unavailable" for key-required
    // standby and for provider errors. Keying off object presence made the
    // "Standby / Unconfigured" UI branch unreachable and let the card assert the
    // model had looked and found nothing.
    for (const message of ["AlphaGenome Atlas: Key Required / Standby", "AlphaGenome endpoint not configured"]) {
      const m = deriveSplicingEvidence(
        makeResult({
          alphagenome: { status: "unavailable", message, featureAttributions: null, topModality: null }
        })
      )!;
      expect(m.hasAlphaGenome).toBe(false);
      expect(m.alphagenomeStatus).toBe("unavailable");
      expect(m.splicingAttribution).toBeNull();
    }
  });

  it("does not call splicing the primary driver on a near-zero attribution", () => {
    // gRPC picks topModality by max |value| with MERGED_SPLICING at index 0, so an
    // all-near-zero vector yields topModality "Splicing" at 0.0%.
    const m = deriveSplicingEvidence(
      makeResult({
        alphagenome: { status: "live", featureAttributions: { Splicing: 0 }, topModality: "Splicing" }
      })
    )!;
    expect(m.splicingAttribution).toBe(0);
    expect(m.isSplicingDominant).toBe(false);
  });

  it("treats a negative attribution of sufficient magnitude as dominant", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        alphagenome: { status: "live", featureAttributions: { Splicing: -0.31 }, topModality: "DNase" }
      })
    )!;
    expect(m.splicingAttribution).toBeCloseTo(-0.31, 5);
    expect(m.isSplicingDominant).toBe(true);
  });
});

/**
 * Pass-through tests for the SpliceAI provenance and delta positions.
 *
 * Both were produced by the client and typed in `contracts.ts` but discarded here, so neither
 * pane could render them: the panels instead hardcoded a tool version and a reporting window
 * ("±10,000 bp flanking") that are wrong for the frozen precomputed source, and could not say
 * WHERE a shift lands — which is the whole reason `dp` exists. Discord here is what let the
 * hardcoded claims go unchallenged.
 */
describe("deriveSplicingEvidence — SpliceAI provenance and delta positions", () => {
  it("carries dp through so a reader can see where the shift lands", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: {
          ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0.004, max_ds: 0.004,
          dp: { ds_ag: -142, ds_al: -172, ds_dg: 19, ds_dl: 123 }
        },
        dbscsnv: null
      })
    )!;

    // A large |dp| with a small delta is the signature of a variant far from any junction —
    // the delta score alone cannot convey that.
    expect(m.spliceai?.dp?.ds_dl).toBe(123);
    expect(m.spliceai?.dp?.ds_ag).toBe(-142);
  });

  it("carries provenance through, including the reporting window the score was made under", () => {
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: {
          ds_ag: 0, ds_al: 0, ds_dg: 0, ds_dl: 0.004, max_ds: 0.004,
          provenance: {
            source: "broad-lookup",
            distanceBp: 500,
            masked: 1,
            computedLive: true,
            annotationSet: "MANE Select"
          }
        },
        dbscsnv: null
      })
    )!;

    expect(m.spliceaiProvenance?.source).toBe("broad-lookup");
    // 500, not 10,000: the panel previously displayed the model's INPUT context as though it
    // were the window the number was produced under.
    expect(m.spliceaiProvenance?.distanceBp).toBe(500);
    expect(m.spliceaiProvenance?.masked).toBe(1);
  });

  it("reports provenance as absent when the source did not state one", () => {
    // The precomputed dbNSFP / Genos paths stamp no provenance, so absence is a real state.
    // A renderer must say "not stated" rather than assume a live model run.
    const m = deriveSplicingEvidence(
      makeResult({
        spliceProximity: { distance: 16, isNearSpliceSite: false },
        spliceai: { ds_ag: 0.9, ds_al: 0, ds_dg: 0, ds_dl: 0, max_ds: 0.9 },
        dbscsnv: null
      })
    )!;

    // The derivation hoists max_ds out of the channel object onto the model.
    expect(m.maxDs).toBeCloseTo(0.9, 5);
    expect(m.spliceaiProvenance).toBeNull();
  });
});
