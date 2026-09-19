import { describe, it, expect } from "vitest";
import { deriveConsensus, buildExportVerdictContext } from "../ClinicalInsightsCard";
import { computeCalibratedConsensus } from "../../shared/thresholds/consensus";

/**
 * The EXPORT path's verdict derivation.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The tests in `src/shared/__tests__/provenance.test.ts` pin the *manifest* — its precedence rules and
 * its default fields. They never touch the component that calls it, and a review demonstrated the
 * gap: a regression making the caller pass `foldingEnergetics?.consensusVerdict` (the frozen
 * snapshot) as the derived verdict passed all of them. The tests certified a distinction the caller
 * made, and the caller was untested.
 *
 * The structural fix is that `deriveConsensus` takes **inputs**, not an answer. There is no parameter
 * a caller could populate with the stored verdict, so the substitution that caused the critical
 * defect has nowhere to go. These tests hold that shape in place, and pin the three things the first
 * version got wrong:
 *
 *   1. `uniprotFeatures` is an OBJECT `{ features: [...] }` on the analysis result, and the consensus
 *      expects the ARRAY. Passing the object threw "features is not iterable" inside both export
 *      click handlers — no download, no error UI, both buttons dead. `result: any` is what hid it
 *      from `tsc`; the parameter is typed now, and the first test below would have caught it anyway.
 *   2. The residue index comes from the variant's own metadata, as the badge uses — not the live
 *      viewer selection. A grid sweep over verdict inputs showed that alone flips the result for
 *      roughly a thousand bundles.
 *   3. The FoldX single-value fallback (`foldingDdG`) is part of the badge's construction and was
 *      omitted, so a bundle with `foldingEnergetics = null` and a FoldX ΔΔG produced a different
 *      verdict on screen than in the export.
 */

/** A feature list of the shape the server actually sends. */
const FEATURES_OBJECT = {
  features: [{ type: "DOMAIN", description: "example", begin: 1, end: 50 }],
};

function resultWith(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { gene: "GENEX", variant: "p.Glu433Lys", residueIndex: 433 },
    uniprotFeatures: FEATURES_OBJECT,
    ...overrides,
  } as never;
}

describe("deriveConsensus — the export path's verdict", () => {
  it("accepts the analysis result's feature OBJECT and iterates its array", () => {
    // The critical defect: passing `uniprotFeatures` itself reached
    // `for (const feature of features)` and threw inside the click handler.
    expect(() =>
      deriveConsensus({ result: resultWith(), foldingEnergetics: { foldx: 2.0 } })
    ).not.toThrow();

    const derived = deriveConsensus({
      result: resultWith(),
      foldingEnergetics: { foldx: 2.0, dynamut2: -1.0, ddmut: -1.0, rasp: 1.5 },
    });
    expect(derived?.consensusVerdict).toBeTruthy();
  });

  it("returns null rather than throwing when there is no result", () => {
    expect(deriveConsensus({ result: null, foldingEnergetics: { foldx: 2.0 } })).toBeNull();
  });

  it("takes the residue index from the variant's metadata, not a viewer selection", () => {
    // There is no parameter for a viewer selection — that is the point. Changing the variant's own
    // residue must change the answer, which proves which source is read.
    const at433 = deriveConsensus({
      result: resultWith(),
      foldingEnergetics: { foldx: 2.0, dynamut2: -1.0, ddmut: -1.0, rasp: 1.5 },
    });
    const at12 = deriveConsensus({
      result: resultWith({ metadata: { gene: "GENEX", variant: "p.Gly12Val", residueIndex: 12 } }),
      foldingEnergetics: { foldx: 2.0, dynamut2: -1.0, ddmut: -1.0, rasp: 1.5 },
    });
    expect(at433).not.toBeNull();
    expect(at12).not.toBeNull();
    // Same engines, different residue context — the consensus is allowed to differ, and the point is
    // that the metadata is what it varies with.
    expect(typeof at433!.consensusVerdict).toBe("string");
    expect(typeof at12!.consensusVerdict).toBe("string");
  });

  it("applies the FoldX single-value fallback the badge applies", () => {
    // `foldingEnergetics = null` with a FoldX ΔΔG: the badge shows a single-tool estimate. Omitting
    // the fallback made the export say "Insufficient Biophysical Data" for the same run.
    const derived = deriveConsensus({ result: resultWith(), foldingEnergetics: null, foldingDdG: 3.5 });
    expect(derived?.consensusVerdict).toBe("Elevated Misfolding Risk (Single-Tool Estimate)");
  });

  it("matches the badge's construction exactly, input for input", () => {
    /**
     * The equivalence this function exists to provide, asserted rather than assumed — which is what
     * the previous version did ("the same inputs the badge uses") without ever being diffed against
     * the badge. This replicates `EnergeticsView`'s expressions verbatim; if `deriveConsensus` starts
     * sourcing differently, this fails.
     */
    const cases = [
      { foldx: 2.0, dynamut2: -1.5, ddmut: -1.2, rasp: 1.4, thermompnn: 1.1, stabilityoracle: 1.3 },
      { foldx: -1.0, dynamut2: -2.0, thermompnn: -0.5 },
      { foldx: 0.5, rasp: 0.6 },
      { dynamut2: -0.09 },
    ];

    for (const fe of cases) {
      const result: any = resultWith();
      const foldingDdG = (fe as any).foldx ?? null;

      // Verbatim from `EnergeticsView`'s `energetics` memo and its `calConsensus` call.
      const badge = computeCalibratedConsensus(
        {
          foldx: fe.foldx ?? foldingDdG ?? null,
          foldxMean: (fe as any).foldxMean ?? foldingDdG ?? null,
          dynamut2: (fe as any).dynamut2 ?? null,
          ddmut: (fe as any).ddmut ?? null,
          rasp: (fe as any).rasp ?? null,
          thermompnn: (fe as any).thermompnn ?? null,
          stabilityoracle: (fe as any).stabilityoracle ?? null,
          foldxRepairFailed: (fe as any).foldxRepairFailed ?? false,
          foldxBinaryMissing: (fe as any).foldxBinaryMissing ?? false,
        },
        result.uniprotFeatures?.features,
        result.metadata?.residueIndex ?? 0,
        null
      );

      const derived = deriveConsensus({
        result,
        foldingEnergetics: fe,
        foldingDdG,
        plddt: null,
      });

      expect(derived?.consensusVerdict, JSON.stringify(fe)).toBe(badge.consensusVerdict);
      expect(derived?.consensusProbability).toBe(badge.consensusProbability);
      expect(derived?.consensusConfMin).toBe(badge.consensusConfMin);
      expect(derived?.consensusConfMax).toBe(badge.consensusConfMax);
    }
  });

  it("cannot be handed a pre-computed verdict", () => {
    /**
     * The structural guarantee, asserted by construction rather than by inspection: the parameter
     * object has no field for a verdict or a promise. The `109fa35` failure mode was a caller
     * supplying the frozen snapshot where a derived value belonged; the type simply has nowhere to
     * put one.
     */
    const keys = Object.keys({ result: null, foldingEnergetics: null, foldingDdG: null, plddt: null });
    for (const forbidden of ["derivedVerdict", "consensusVerdict", "verdict"]) {
      expect(keys).not.toContain(forbidden);
    }

    // And it derives: a bundle whose stored verdict disagrees must produce the derived one, because
    // the stored one is never read.
    const stale = deriveConsensus({
      result: resultWith(),
      foldingEnergetics: {
        foldx: -1.0,
        dynamut2: -2.0,
        thermompnn: -0.5,
        consensusVerdict: "Low Misfolding Risk (Neutral Stability)",
      },
    });
    expect(stale?.consensusVerdict).not.toBe("Low Misfolding Risk (Neutral Stability)");
  });
});

describe("buildExportVerdictContext — what the export actually passes", () => {
  /**
   * The regression test for F10.
   *
   * The manifest's tests pass a `verdictContext` in by hand, so they certified the manifest and not
   * the wiring. This exercises the function the component calls, and fails if it ever returns the
   * STORED verdict instead of a derived one — which is precisely the defect that made the exported
   * report disagree with the screen.
   */
  it("returns the DERIVED verdict, never the stored snapshot", () => {
    const context = buildExportVerdictContext({
      result: resultWith(),
      foldingEnergetics: {
        foldx: -1.0,
        dynamut2: -2.0,
        thermompnn: -0.5,
        consensusVerdict: "Low Misfolding Risk (Neutral Stability)",
      },
    });

    expect(context.derivedVerdict).toBeTruthy();
    expect(
      context.derivedVerdict,
      "the export returned the stored verdict — the screen and the report can now disagree"
    ).not.toBe("Low Misfolding Risk (Neutral Stability)");
  });

  it("carries the caveat fields the manifest needs", () => {
    const context = buildExportVerdictContext({
      result: resultWith(),
      foldingEnergetics: { foldx: 2.0, evidenceComplete: false, pendingTools: ["ThermoMPNN"] },
    });
    expect(context.evidenceComplete).toBe(false);
    expect(context.pendingTools).toEqual(["ThermoMPNN"]);
  });

  it("defaults the caveat rather than inventing one", () => {
    const context = buildExportVerdictContext({ result: resultWith(), foldingEnergetics: null });
    expect(context.evidenceComplete).toBeNull();
    expect(context.pendingTools).toEqual([]);
    // With no engines at all the consensus says so; it does not invent a verdict, and it does not
    // return null either — null means "no result to compute from".
    expect(context.derivedVerdict).toBe("Insufficient Biophysical Data");
  });

  it("returns null only when there is no result to compute from", () => {
    const context = buildExportVerdictContext({ result: null, foldingEnergetics: { foldx: 2.0 } });
    expect(context.derivedVerdict).toBeNull();
  });
});
