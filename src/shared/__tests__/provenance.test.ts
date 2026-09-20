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

/**
 * "p.Lys281Asn" is only a variant GIVEN a protein, so the manifest must state which numbering the
 * residue numbers belong to — otherwise a report cannot be re-derived or safely compared with one
 * produced from a different protein.
 */
describe("generateProvenanceManifest — numbering provenance", () => {
  it("cites the input basis and the conversion for an accession-qualified notation", () => {
    const manifest = generateProvenanceManifest(
      "ACOT9",
      "p.Lys272Asn",
      "Q9Y305",
      {
        uniprotIsoform: "Q9Y305-1",
        numberingBasis: "remapped",
        numberingVerified: true,
        numberingRemap: {
          reason: "MANE Select numbering mapped onto the canonical isoform",
          from: {
            hgvsp: "p.Lys281Asn",
            isoform: "Q9Y305-4",
            accession: "NP_001032248.1",
            transcriptId: "NM_001037171.2",
          },
          to: { hgvsp: "p.Lys272Asn", isoform: "Q9Y305-1" },
        },
      } as never
    );

    expect(manifest.numberingProvenance.basis).toBe("remapped");
    expect(manifest.numberingProvenance.remap?.fromAccession).toBe("NP_001032248.1");
    expect(manifest.numberingProvenance.remap?.fromIsoform).toBe("Q9Y305-4");
    expect(manifest.numberingProvenance.remap?.fromHgvsp).toBe("p.Lys281Asn");
    expect(manifest.numberingProvenance.remap?.toHgvsp).toBe("p.Lys272Asn");
    expect(manifest.numberingProvenance.declaredByInput).toBe(true);
    expect(manifest.numberingProvenance.verified).toBe(true);
  });

  it("carries the unverified state and its reason, and derives it from the basis when absent", () => {
    const unverified = generateProvenanceManifest(
      "ACOT9",
      "p.Arg55Ala",
      "Q9Y305",
      {
        numberingBasis: "unverified",
        numberingUnverifiedReason: "the isoform model could not be reached",
      } as never
    );
    expect(unverified.numberingProvenance.verified).toBe(false);
    expect(unverified.numberingProvenance.unverifiedReason).toContain("isoform model");
    expect(unverified.numberingProvenance.declaredByInput).toBe(false);

    // A canonical basis with no explicit flag is proven numbering, not unknown.
    const canonical = generateProvenanceManifest("ACOT9", "p.Arg55Ala", "Q9Y305", {
      numberingBasis: "canonical",
    } as never);
    expect(canonical.numberingProvenance.verified).toBe(true);
  });

  it("says nothing it cannot support when no numbering information exists", () => {
    const manifest = generateProvenanceManifest("GENEX", "p.Ala1Val", "P00001", analysisResult);
    expect(manifest.numberingProvenance.basis).toBeNull();
    expect(manifest.numberingProvenance.verified).toBeNull();
    expect(manifest.numberingProvenance.remap).toBeNull();
  });
});

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
