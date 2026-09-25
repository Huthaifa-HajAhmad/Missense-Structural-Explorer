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

  it("flags a word that disagrees with the accessibility value beside it", () => {
    /*
     * The stale-payload case, and the one the first version of this module missed: a bundle
     * written before the shared bands existed carries a word computed under 5%/25% next to an
     * RSA the panel bands under 15%/35%. `rsa: 0.30` reads as boundary while the badge says
     * surface, and no indicator-vs-indicator comparison can see it — both indicators agree.
     */
    const evidence = deriveBurialEvidence({ burialStatus: "surface", rsa: 0.30, neighbourCount: 10 });

    expect(evidence.indicators.rsa.band).toBe("boundary");
    expect(evidence.disagreement).toMatch(/does not match the accessibility measurement/i);
    expect(evidence.disagreement).toMatch(/stale result/i);
    // Nothing decided the word in a way this panel can reproduce.
    expect(evidence.basis).toBe("none");
    expect(evidence.indicators.rsa.isBasis).toBe(false);
  });

  it("flags the engine's own not-found default as a disagreement, without claiming a basis", () => {
    // `predictStructuralDisruption` returns burialStatus "boundary" with neighborCount 0
    // when the residue is missing from the model. Zero neighbours is a surface reading, so the
    // pair cannot be presented as two agreeing indicators — and the panel must not then claim
    // the word was "decided by Cα packing density" while its own packing card reads SURFACE.
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 0 });

    expect(evidence.indicators.packing.band).toBe("surface");
    expect(evidence.disagreement).not.toBeNull();
    expect(evidence.basis).toBe("none");
    expect(evidence.basisLabel).toBe("Not measured");
    expect(evidence.basisDetail).toMatch(/not reproducible/i);
    expect(evidence.indicators.packing.isBasis).toBe(false);
  });

  it("marks a packing-derived word as an estimate in its own sentence", () => {
    const evidence = deriveBurialEvidence({ burialStatus: "core", neighbourCount: 20 });

    expect(evidence.basis).toBe("residue-packing");
    expect(evidence.detail).toMatch(/Estimated from packing density/i);
  });

  it("stretches the meter domain to contain the value instead of saturating", () => {
    // 41 Cα neighbours and RSA > 100% both occur in real structures; a bar that saturates at
    // its edge beside a value label that says otherwise is a picture contradicting its label.
    const dense = deriveBurialEvidence({ burialStatus: "core", neighbourCount: 41, rsa: 1.4 });

    expect(dense.indicators.packing.domainMax).toBeGreaterThanOrEqual(41);
    expect(dense.indicators.packing.marker).toBe(41);
    expect(dense.indicators.rsa.domainMax).toBeGreaterThanOrEqual(140);
    // The thresholds stay where the classifier's cutoffs are, whatever the domain.
    expect(dense.indicators.packing.ticks.map(t => t.value)).toEqual([7, 15]);
    expect(dense.indicators.rsa.ticks.map(t => t.value)).toEqual([15, 35]);
  });

  it("does not claim a basis when only a measurement is reported and no word is", () => {
    // The schema permits `rsa` without `burialStatus`; nothing decided a word, so nothing can
    // be named as its basis even though a measurement exists.
    const evidence = deriveBurialEvidence({ rsa: 0.2 });

    expect(evidence.status).toBe("undetermined");
    expect(evidence.basis).toBe("none");
    expect(evidence.indicators.rsa.isBasis).toBe(false);
    expect(evidence.basisDetail).toMatch(/not reproducible/i);
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

  it("pins the sidecar's comparison *direction*, not just its literals", () => {
    /*
     * The first version of this guard only asserted the two constants and the absence of the
     * old literals, which passes for `if rsa < BURIAL_RSA_CORE_MAX` (exclusive) — a boundary
     * change that makes the sidecar and the classifier disagree at exactly 0.15 and 0.35.
     * Asserting the comparisons is what makes the guard able to fail.
     */
    const source = readFileSync(new URL("../../../tools/sasa_eval.py", import.meta.url), "utf8");

    expect(source).toMatch(/if\s+rsa\s*<=\s*BURIAL_RSA_CORE_MAX\s*:/);
    expect(source).toMatch(/elif\s+rsa\s*>=\s*BURIAL_RSA_SURFACE_MIN\s*:/);
  });

  it("bands the value the sidecar actually emits", () => {
    // The sidecar ships `round(rsa, 4)`; if it bands a more precise value, a true 0.15004 is
    // "core" there and "boundary" in the panel — a silent 5e-5 disagreement window.
    const source = readFileSync(new URL("../../../tools/sasa_eval.py", import.meta.url), "utf8");

    expect(source).toMatch(/rsa\s*=\s*round\(sasa\s*\/\s*max_sasa,\s*4\)/);
    // ...and the emission must not re-round a different value into the payload.
    expect(source).not.toMatch(/"rsa":\s*round\(/);
  });
});
