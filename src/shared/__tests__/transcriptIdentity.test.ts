import { describe, expect, it } from "vitest";
import { refSeqFor, sameTranscript, transcriptIdentity } from "../transcriptIdentity.ts";

/**
 * ABCG1 p.Gly358Arg (2026-11-25): translation modelled the canonical transcript ENST00000361802 (no
 * MANE RefSeq of its own), while VEP's predictor record named the MANE transcript ENST00000398449 /
 * NM_016818.3. Filling each field separately put NM_016818.3 beside ENST00000361802 — two different
 * transcripts shown as one.
 */
const modelled = { transcriptId: "ENST00000361802", isManeSelect: false, isCanonical: true };
const vepMane = { transcriptId: "ENST00000398449", maneRefSeqId: "NM_016818.3", isManeSelect: true, isCanonical: false };

describe("transcriptIdentity", () => {
  it("never puts one transcript's RefSeq id beside another transcript", () => {
    expect(transcriptIdentity(modelled, vepMane)).toEqual({
      transcriptId: "ENST00000361802",
      maneRefSeqId: undefined,
      isManeSelect: false,
      isManePlusClinical: undefined,
      isCanonical: true,
    });
  });

  it("drops the borrowed RefSeq id from a result saved before this rule", () => {
    const saved = { ...modelled, maneRefSeqId: "NM_016818.3" };
    expect(transcriptIdentity(saved, vepMane).maneRefSeqId).toBeUndefined();
  });

  it("fills missing fields from the second record when it is the same transcript", () => {
    const bare = { transcriptId: "ENST00000398449.8" };
    expect(transcriptIdentity(bare, vepMane)).toMatchObject({
      transcriptId: "ENST00000398449.8",
      maneRefSeqId: "NM_016818.3",
      isManeSelect: true,
    });
  });

  it("keeps a RefSeq id the first record holds without a transcript id", () => {
    expect(transcriptIdentity({ maneRefSeqId: "NM_003905.4", transcriptId: null }, null).maneRefSeqId).toBe("NM_003905.4");
  });

  it("uses the second record whole when the first names no transcript", () => {
    expect(transcriptIdentity({}, vepMane)).toMatchObject({ transcriptId: "ENST00000398449", maneRefSeqId: "NM_016818.3", isManeSelect: true });
    expect(transcriptIdentity(null, null).transcriptId).toBeUndefined();
  });
});

describe("sameTranscript and refSeqFor", () => {
  it("compares transcript ids without their version", () => {
    expect(sameTranscript("ENST00000398449.8", "ENST00000398449")).toBe(true);
    expect(sameTranscript("ENST00000398449", "ENST00000361802")).toBe(false);
    expect(sameTranscript(null, "ENST00000361802")).toBe(false);
  });

  it("finds the RefSeq id of the named transcript only", () => {
    const remapFrom = { transcriptId: "ENST00000398449", maneRefSeqId: "NM_016818.3" };
    expect(refSeqFor("ENST00000398449", [modelled, remapFrom])).toBe("NM_016818.3");
    expect(refSeqFor("ENST00000361802", [modelled, remapFrom])).toBeUndefined();
  });

  it("uses a RefSeq id whose record names no transcript, since it cannot contradict one", () => {
    expect(refSeqFor("ENST00000369878.9", [{ maneRefSeqId: "NM_017649.5" }])).toBe("NM_017649.5");
    expect(refSeqFor(null, [{ transcriptId: "ENST00000398449", maneRefSeqId: "NM_016818.3" }])).toBe("NM_016818.3");
  });
});
