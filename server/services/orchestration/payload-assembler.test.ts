import { describe, it, expect } from "vitest";

import { assembleCoreResponsePayload } from "../payload-assembler";

/**
 * The UI's analysis runs through the STREAM endpoint, whose chunks are built by this assembler.
 *
 * Numbering provenance was added only to the non-stream route, so an unverifiable numbering was
 * disclosed on the route the client does not use and silent on the one it does — the disclosure
 * existed and reached nobody. These assertions pin the payload the client actually reads.
 */
const coreData = {
  ruleBasedInsights: null,
  clinvar: null,
  predictorData: { transcriptId: "ENST1", isManeSelect: true },
  conservationData: null,
  stringInteractions: null,
  disruptionPredictor: { level: "unknown" },
  gnomadConstraint: null,
  uniprotFeatures: null,
  gnomadFrequency: null,
  aouFrequency: null,
  esm2: null,
} as any;

const context = (over: Record<string, unknown>) =>
  ({
    gene: "ACOT9",
    variant: "p.Arg64Ala",
    uniprotId: "Q9Y305",
    residueIndex: "64",
    wildType: "Arg",
    mutant: "Ala",
    sequence: "M".repeat(100),
    pos: 64,
    wt1Letter: "R",
    mut1Letter: "A",
    ...over,
  }) as any;

describe("assembleCoreResponsePayload — numbering disclosure", () => {
  it("carries the verified state, the unverified reason and the reader's decision", () => {
    const verified = assembleCoreResponsePayload(coreData, context({ numberingVerified: true }));
    expect(verified.numberingVerified).toBe(true);
    expect(verified.numberingUnverifiedReason).toBeUndefined();

    const unverified = assembleCoreResponsePayload(
      coreData,
      context({ numberingVerified: false, numberingWarning: "the isoform model could not be reached" })
    );
    expect(unverified.numberingVerified).toBe(false);
    expect(unverified.numberingUnverifiedReason).toContain("isoform model");

    const chosen = assembleCoreResponsePayload(
      coreData,
      context({ numberingVerified: true, numberingDisambiguated: true })
    );
    expect(chosen.numberingDisambiguated).toBe(true);
  });

  it("says nothing when the route established nothing", () => {
    const payload = assembleCoreResponsePayload(coreData, context({}));
    expect(payload.numberingVerified).toBeUndefined();
    expect(payload.numberingDisambiguated).toBeUndefined();
    expect(payload.numberingUnverifiedReason).toBeUndefined();
  });
});
