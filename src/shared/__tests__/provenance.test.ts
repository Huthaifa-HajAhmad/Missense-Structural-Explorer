import { describe, it, expect } from "vitest";
import { generateProvenanceManifest } from "../provenance";

/**
 * The exported manifest must not contradict the screen.
 *
 * `foldingEnergetics.consensusVerdict` is a snapshot from when the server committed the FoldX job.
 * Remote engines keep resolving for up to ten minutes after that, and the on-screen badge recomputes
 * as they do — so a manifest built from the stored field could state a verdict the screen
 * contradicts. Measured: foldx +0.5 and rasp +0.6 at commit time gave "Low Misfolding Risk (Neutral
 * Stability)", and a ThermoMPNN result arriving later put "High Misfolding Risk (Destabilizing
 * Consensus)" on screen while the export still said Low.
 *
 * A stored verdict is a fact about the past; a manifest is a claim about this variant.
 */

const STALE = "Low Misfolding Risk (Neutral Stability)";
const LIVE = "High Misfolding Risk (Destabilizing Consensus)";

const analysisResult = { metadata: { gene: "GENEX", variant: "p.Ala1Val" } } as never;

describe("generateProvenanceManifest — stability verdict", () => {
  it("prefers the verdict derived from the final state over the stored snapshot", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      undefined,
      { consensusVerdict: STALE } as never,
      LIVE
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
      null
    );

    expect(manifest.verdictSummary.stabilityVerdict).toBeNull();
  });

  it("still carries the rest of the manifest", () => {
    const manifest = generateProvenanceManifest(
      "GENEX",
      "p.Ala1Val",
      "P00001",
      analysisResult,
      { acmgWeighting: "standard" },
      null,
      LIVE
    );

    expect(manifest.queryCoordinate.gene).toBe("GENEX");
    expect(manifest.queryCoordinate.variant).toBe("p.Ala1Val");
    expect(manifest.queryCoordinate.acmgWeighting).toBe("standard");
    expect(manifest.manifestVersion).toBe("1.0.0");
  });
});
