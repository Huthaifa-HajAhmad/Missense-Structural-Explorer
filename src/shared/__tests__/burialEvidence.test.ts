import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BURIAL_RSA_BANDS,
  PACKING_NEIGHBOUR_BANDS,
  classifyBurialRsa,
  classifyPackingDensity,
  deriveBurialEvidence
} from "../burialEvidence";

/**
 * The panel printed a burial word computed with one set of RSA cutoffs and explained it
 * with another. These tests pin the single definition, and pin the two surfaces that
 * cannot import it directly (the Python SASA sidecar and the metric-explanation registry)
 * to the same numbers.
 */
describe("burial band classification", () => {
  it("bands relative solvent accessibility on the shared cutoffs", () => {
    expect(BURIAL_RSA_BANDS).toEqual({ coreMax: 0.15, surfaceMin: 0.35 });

    expect(classifyBurialRsa(0)).toBe("core");
    expect(classifyBurialRsa(0.05)).toBe("core");
    // The core band is inclusive at its upper bound; one step past it is boundary.
    expect(classifyBurialRsa(BURIAL_RSA_BANDS.coreMax)).toBe("core");
    expect(classifyBurialRsa(0.151)).toBe("boundary");
    expect(classifyBurialRsa(0.34)).toBe("boundary");
    expect(classifyBurialRsa(BURIAL_RSA_BANDS.surfaceMin)).toBe("surface");
    expect(classifyBurialRsa(0.9)).toBe("surface");
    // Absent is not a band.
    expect(classifyBurialRsa(null)).toBeNull();
    expect(classifyBurialRsa(undefined)).toBeNull();
    expect(classifyBurialRsa(Number.NaN)).toBeNull();
  });

  it("bands packing density on the shared cutoffs", () => {
    expect(PACKING_NEIGHBOUR_BANDS).toEqual({ coreMin: 15, surfaceMax: 7, radiusAngstrom: 10 });

    expect(classifyPackingDensity(24)).toBe("core");
    expect(classifyPackingDensity(PACKING_NEIGHBOUR_BANDS.coreMin)).toBe("core");
    expect(classifyPackingDensity(14)).toBe("boundary");
    expect(classifyPackingDensity(8)).toBe("boundary");
    expect(classifyPackingDensity(PACKING_NEIGHBOUR_BANDS.surfaceMax)).toBe("surface");
    expect(classifyPackingDensity(0)).toBe("surface");
    expect(classifyPackingDensity(null)).toBeNull();
  });
});

describe("deriveBurialEvidence", () => {
  it("names the measured accessibility as the basis when RSA is reported", () => {
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 14, rsa: 0.2 });

    expect(evidence.status).toBe("boundary");
    expect(evidence.basis).toBe("solvent-accessibility");
    expect(evidence.indicators.rsa.isBasis).toBe(true);
    expect(evidence.indicators.packing.isBasis).toBe(false);
    expect(evidence.indicators.rsa.valueLabel).toBe("20.0%");
    expect(evidence.indicators.rsa.band).toBe("boundary");
    expect(evidence.indicators.packing.valueLabel).toBe("14");
    // No caveat: the word rests on a measurement, not on a proxy.
    expect(evidence.caveat).toBeNull();
    expect(evidence.disagreement).toBeNull();
  });

  it("says the word is a packing estimate when the accessibility step did not run", () => {
    // The common production case: the SASA sidecar fails, so the engine falls back to
    // counting Cα neighbours — and the old panel presented that as measured burial.
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 14 });

    expect(evidence.basis).toBe("residue-packing");
    expect(evidence.basisLabel).toBe("Estimated from packing");
    expect(evidence.indicators.packing.isBasis).toBe(true);
    expect(evidence.indicators.rsa.valueLabel).toBeNull();
    expect(evidence.indicators.rsa.band).toBeNull();
    expect(evidence.caveat).toMatch(/proxy for burial rather than a measurement/i);
  });

  it("reports a disagreement between the two indicators instead of hiding it", () => {
    const evidence = deriveBurialEvidence({ burialStatus: "surface", neighbourCount: 20, rsa: 0.6 });

    expect(evidence.indicators.rsa.band).toBe("surface");
    expect(evidence.indicators.packing.band).toBe("core");
    expect(evidence.disagreement).toMatch(/point different ways/i);
    expect(evidence.disagreement).toMatch(/accessibility measurement/i);
    // The reported word still wins: it is the one the engine actually measured.
    expect(evidence.status).toBe("surface");
  });

  it("flags the engine's own not-found default as a disagreement", () => {
    // `predictStructuralDisruption` returns burialStatus "boundary" with neighborCount 0
    // when the residue is missing from the model. Zero neighbours is a surface reading,
    // so the pair cannot be presented as two agreeing indicators.
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 0 });

    expect(evidence.indicators.packing.band).toBe("surface");
    expect(evidence.disagreement).not.toBeNull();
  });

  it("states absence as absence rather than defaulting to a word", () => {
    const evidence = deriveBurialEvidence({});

    expect(evidence.status).toBe("undetermined");
    expect(evidence.basis).toBe("none");
    expect(evidence.caveat).toMatch(/missing evidence, not evidence/i);
    expect(evidence.indicators.rsa.valueLabel).toBeNull();
    expect(evidence.indicators.packing.valueLabel).toBeNull();
  });

  it("does not invent a word from a value the engine did not band", () => {
    // A payload that reports the classification but no measurement cannot band anything.
    const evidence = deriveBurialEvidence({ burialStatus: "core" });

    expect(evidence.status).toBe("core");
    expect(evidence.basis).toBe("none");
    expect(evidence.indicators.rsa.band).toBeNull();
    expect(evidence.indicators.packing.band).toBeNull();
  });

  it("carries meter ticks in each indicator's own units", () => {
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 14, rsa: 0.2 });

    expect(evidence.indicators.rsa.domainMax).toBe(100);
    expect(evidence.indicators.rsa.ticks.map(t => t.label)).toEqual(["15%", "35%"]);
    expect(evidence.indicators.rsa.marker).toBeCloseTo(20);
    expect(evidence.indicators.packing.ticks.map(t => t.label)).toEqual(["7", "15"]);
    expect(evidence.indicators.packing.marker).toBe(14);
  });
});

/**
 * The surface that cannot read `BURIAL_RSA_BANDS` at runtime.
 *
 * The defect this whole module exists to fix was a *threshold* disagreement, so a test
 * that only checks the constant would not catch a recurrence: this reads the other
 * implementation and fails if it bands the same value differently. The metric-explanation
 * registry is pinned alongside it, in the component suite, because a shared module may not
 * import from outside `src/shared`.
 */
describe("burial band single-source guard", () => {
  it("keeps the Python SASA sidecar on the shared RSA cutoffs", () => {
    const source = readFileSync(new URL("../../../tools/sasa_eval.py", import.meta.url), "utf8");

    expect(source).toContain("BURIAL_RSA_CORE_MAX = 0.15");
    expect(source).toContain("BURIAL_RSA_SURFACE_MIN = 0.35");
    // The pair that made one RSA value read as "boundary" in the badge and "core" in prose.
    expect(source).not.toMatch(/rsa\s*<\s*0\.05/);
    expect(source).not.toMatch(/rsa\s*>\s*0\.25/);
  });
});
