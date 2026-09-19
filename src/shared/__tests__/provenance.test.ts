import { describe, it, expect } from "vitest";
import { generateProvenanceManifest } from "../provenance";

/**
 * The exported manifest must not contradict the screen, and must not hide a partial run.
 *
 * Two defects, both introduced by changing how the verdict is carried:
 *
 *   1. `foldingEnergetics.consensusVerdict` is a snapshot from when the server committed the FoldX
 *      job. Remote engines keep resolving for up to ten minutes after that and the on-screen badge
 *      recomputes as they do, so a manifest built from the stored field could state a verdict the
 *      screen contradicts — measured: foldx +0.5 and rasp +0.6 at commit time gave "Low Misfolding
 *      Risk (Neutral Stability)", and a ThermoMPNN result arriving later put "High Misfolding Risk
 *      (Destabilizing Consensus)" on screen while the export still said Low.
 *
 *   2. The provisionality marker used to live INSIDE the verdict as a " (Preliminary - pending: …)"
 *      suffix. Removing it was right — free text in a verdict cannot be compared or typed — but
 *      nothing replaced it, so for a while an export stated an incomplete run's verdict with no
 *      caveat at all.
 *
 * A stored verdict is a fact about the past; a manifest is a claim about this variant.
 */

const STALE = "Low Misfolding Risk (Neutral Stability)";
const LIVE = "High Misfolding Risk (Destabilizing Consensus)";

const analysisResult = { metadata: { gene: "GENEX", variant: "p.Ala1Val" } } as never;

describe("generateProvenanceManifest — verdict summary", () => {
  it("prefers the verdict derived from the final state over the stored snapshot", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: STALE } as never,
      { derivedVerdict: LIVE }
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBe(LIVE);
  });

  it("falls back to the stored verdict when no derived value is available", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: STALE } as never
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBe(STALE);
  });

  it("reports null rather than inventing a verdict when there is none", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      null,
      { derivedVerdict: null }
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBeNull();
  });

  it("carries the provisionality caveat as its own fields, not inside the verdict", () => {
    // The caveat must be readable, and the verdict itself must stay a closed-set value.
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: LIVE, evidenceComplete: false, pendingTools: ["DynaMut2", "DDMut"] } as never
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBe(LIVE);
    expect(manifest.verdictSummary.stabilityVerdict).not.toContain("Preliminary");
    expect(manifest.verdictSummary.stabilityEvidenceComplete).toBe(false);
    expect(manifest.verdictSummary.pendingEngines).toEqual(["DynaMut2", "DDMut"]);
  });

  it("takes the caller's provisionality when supplied, in preference to the stored bundle", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: STALE, evidenceComplete: false, pendingTools: ["RaSP"] } as never,
      { derivedVerdict: LIVE, evidenceComplete: true, pendingTools: [] }
    );

    expect(manifest.verdictSummary.stabilityEvidenceComplete).toBe(true);
    expect(manifest.verdictSummary.pendingEngines).toEqual([]);
  });

  it("defaults to no pending engines when nothing is known", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      null
    );

    expect(manifest.verdictSummary.stabilityEvidenceComplete).toBeNull();
    expect(manifest.verdictSummary.pendingEngines).toEqual([]);
  });

  it("treats a supplied context as authoritative, including a NULL verdict", () => {
    /**
     * F3. The `??` chain made `derivedVerdict: null` indistinguishable from "no context supplied", so a
     * run with no result to derive from fell through to the STORED snapshot — the export stating a
     * verdict the screen had no basis for. Reachable: variantCache persists bundles with
     * `analysisResult: undefined` while keeping `foldingEnergetics`.
     */
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: STALE } as never,
      { derivedVerdict: null }
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBeNull();
  });

  it("still uses the stored verdict for a caller that supplies no context", () => {
    // The fallback's original purpose, pinned so the rule above cannot be "fixed" by deleting it.
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: STALE } as never
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBe(STALE);
  });

  it("does not half-apply a context: the caveat follows the same rule", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: STALE, evidenceComplete: false, pendingTools: ["DynaMut2"] } as never,
      { derivedVerdict: null, evidenceComplete: null, pendingTools: [] }
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBeNull();
    expect(manifest.verdictSummary.stabilityEvidenceComplete).toBeNull();
    expect(manifest.verdictSummary.pendingEngines).toEqual([]);
  });

  it("still carries the rest of the manifest", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      { acmgWeighting: "standard" },
      null,
      { derivedVerdict: LIVE }
    );

    expect(manifest.queryCoordinate.gene).toBe("GENEX");
    expect(manifest.queryCoordinate.variant).toBe("p.Ala1Val");
    expect(manifest.queryCoordinate.acmgWeighting).toBe("standard");
    expect(manifest.manifestVersion).toBe("1.0.0");
  });
});
