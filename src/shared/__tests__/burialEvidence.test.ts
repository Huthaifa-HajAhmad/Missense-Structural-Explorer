import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BURIAL_RSA_BANDS,
  PACKING_NEIGHBOUR_BANDS,
  classifyBurialRsa,
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

  it("keeps no packing cut-points: the Cα count never decides a word", () => {
    // ≥ 15 core / ≤ 7 surface had no source and called most exposed residues boundary
    // (2OCJ chain A: 34 of 48 residues with ≥ 35% RSA). The owner chose, 2026-09-29, to give
    // burial only from measured accessibility.
    expect(PACKING_NEIGHBOUR_BANDS).toEqual({ radiusAngstrom: 10 });
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

  it("says burial was not measured when the accessibility step did not run", () => {
    // The common production case: the SASA sidecar fails. The count is a reading, not a word.
    const evidence = deriveBurialEvidence({ neighbourCount: 9 });

    expect(evidence.status).toBe("undetermined");
    expect(evidence.label).toBe("Not measured");
    expect(evidence.basis).toBe("none");
    expect(evidence.indicators.packing.valueLabel).toBe("9");
    expect(evidence.indicators.packing.band).toBeNull();
    expect(evidence.indicators.packing.isBasis).toBe(false);
    expect(evidence.caveat).toMatch(/missing evidence/i);
    expect(evidence.staleWord).toBeNull();
  });

  it("names a stored packing word as stale instead of showing it as a finding", () => {
    // A payload from the previous engine carries "boundary" from the packing fallback.
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 9 });

    expect(evidence.status).toBe("undetermined");
    expect(evidence.staleWord).toMatch(/earlier engine estimated from packing/i);
    expect(evidence.disagreement).toBeNull();
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

  it("treats the engine's old not-found default as unmeasured, not as boundary", () => {
    // The engine used to return burialStatus "boundary" with neighborCount 0 when the residue
    // was missing from the model. With no accessibility that is not a finding.
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 0 });

    expect(evidence.status).toBe("undetermined");
    expect(evidence.basis).toBe("none");
    expect(evidence.basisLabel).toBe("Not measured");
    expect(evidence.staleWord).not.toBeNull();
  });

  it("keeps the accessibility sentence for a word the measurement decided", () => {
    const measured = deriveBurialEvidence({ burialStatus: "core", rsa: 0.05 });

    expect(measured.basis).toBe("solvent-accessibility");
    expect(measured.detail).toMatch(/little or no solvent contact/i);

    // ...and the measured boundary sentence no longer claims a pocket: an RSA band does not
    // establish one — the pocket predictor is a different measurement, reported elsewhere.
    const boundary = deriveBurialEvidence({ burialStatus: "boundary", rsa: 0.2 });

    expect(boundary.basis).toBe("solvent-accessibility");
    expect(boundary.detail).toMatch(/partly buried/i);
    expect(boundary.detail).not.toMatch(/pocket/i);
  });

  it("stretches the meter domain to contain the value instead of saturating", () => {
    // 41 Cα neighbours and RSA > 100% both occur in real structures; a bar that saturates at
    // its edge beside a value label that says otherwise is a picture contradicting its label.
    const dense = deriveBurialEvidence({ burialStatus: "core", neighbourCount: 41, rsa: 1.4 });

    expect(dense.indicators.packing.domainMax).toBeGreaterThanOrEqual(41);
    expect(dense.indicators.packing.marker).toBe(41);
    expect(dense.indicators.rsa.domainMax).toBeGreaterThanOrEqual(140);
    // The RSA marks stay where the classifier's cut-points are; packing has none.
    expect(dense.indicators.packing.ticks).toEqual([]);
    expect(dense.indicators.rsa.ticks.map(t => t.value)).toEqual([15, 35]);
  });

  it("bands a measured accessibility even when the payload carries no word", () => {
    const evidence = deriveBurialEvidence({ rsa: 0.2 });

    expect(evidence.status).toBe("boundary");
    expect(evidence.basis).toBe("solvent-accessibility");
    expect(evidence.indicators.rsa.isBasis).toBe(true);
  });

  it("states absence as absence rather than defaulting to a word", () => {
    const evidence = deriveBurialEvidence({});

    expect(evidence.status).toBe("undetermined");
    expect(evidence.basis).toBe("none");
    expect(evidence.caveat).toMatch(/missing evidence, not evidence/i);
    expect(evidence.indicators.rsa.valueLabel).toBeNull();
    expect(evidence.indicators.packing.valueLabel).toBeNull();
  });

  it("does not show a word that no measurement stands behind", () => {
    const evidence = deriveBurialEvidence({ burialStatus: "core" });

    expect(evidence.status).toBe("undetermined");
    expect(evidence.basis).toBe("none");
    expect(evidence.indicators.rsa.band).toBeNull();
    expect(evidence.indicators.packing.band).toBeNull();
  });

  it("carries meter ticks in each indicator's own units", () => {
    const evidence = deriveBurialEvidence({ burialStatus: "boundary", neighbourCount: 14, rsa: 0.2 });

    expect(evidence.indicators.rsa.domainMax).toBe(100);
    expect(evidence.indicators.rsa.ticks.map(t => t.label)).toEqual(["15%", "35%"]);
    expect(evidence.indicators.rsa.marker).toBeCloseTo(20);
    expect(evidence.indicators.packing.ticks).toEqual([]);
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
