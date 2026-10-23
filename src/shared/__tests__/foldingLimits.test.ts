import { describe, it, expect } from "vitest";
import {
  ESM_ATLAS_PUBLIC_MAX_AA,
  JAPANFOLD_ESMFOLD2_MAX_AA,
  STABILITY_ESMFOLD_ENGINE_MAX_AA,
  deNovoFoldingLimitExceededMessage,
  describeDeNovoCapacityNotice,
  describeDeNovoFoldTimeout,
  esmAtlasFallbackExceededMessage,
  formatResidueCount,
  isFoldingLengthLimitError,
  isFoldingTimeoutError,
  parseReportedSequenceLength,
  readProteinLength,
  resolveDeNovoFoldingCapacity,
  stabilityEsmFoldEngineLimitMessage,
} from "../foldingLimits";

/**
 * These tests exist because the numbers and the sentences that quote them used to live in different
 * files, and drifted.
 *
 * The defect they pin, in one line: the structure inspector told a reader that a >400 aa protein was
 * being routed to a "Sovereign JapanFold inference engine configured in Settings" — an engine and a
 * setting that exist nowhere in this repository — beneath a red card saying the same fold had failed,
 * while the canvas beside it reported the protein as 51 aa long. Three panels, three stories, one run.
 */

describe("the de novo folding ceilings", () => {
  it("keeps the three ceilings ordered and distinct", () => {
    // Not a nesting relationship — three different code paths own them, and the ordering is what makes
    // quoting the wrong one detectable. 768 in a sentence about Tier-1 is the original bug.
    expect(ESM_ATLAS_PUBLIC_MAX_AA).toBeLessThan(STABILITY_ESMFOLD_ENGINE_MAX_AA);
    expect(STABILITY_ESMFOLD_ENGINE_MAX_AA).toBeLessThan(JAPANFOLD_ESMFOLD2_MAX_AA);
  });

  it("formats residue counts without depending on the ICU build", () => {
    expect(formatResidueCount(400)).toBe("400");
    expect(formatResidueCount(711)).toBe("711");
    expect(formatResidueCount(1024)).toBe("1,024");
    expect(formatResidueCount(12345)).toBe("12,345");
  });

  it("resolves capacity at both boundaries, inclusive", () => {
    const atPublicCeiling = resolveDeNovoFoldingCapacity(ESM_ATLAS_PUBLIC_MAX_AA);
    expect(atPublicCeiling.tier1Available).toBe(true);
    expect(atPublicCeiling.publicFallbackAvailable).toBe(true);

    const pastPublicCeiling = resolveDeNovoFoldingCapacity(ESM_ATLAS_PUBLIC_MAX_AA + 1);
    expect(pastPublicCeiling.tier1Available).toBe(true);
    expect(pastPublicCeiling.publicFallbackAvailable).toBe(false);

    const atTier1Ceiling = resolveDeNovoFoldingCapacity(JAPANFOLD_ESMFOLD2_MAX_AA);
    expect(atTier1Ceiling.tier1Available).toBe(true);

    const pastTier1Ceiling = resolveDeNovoFoldingCapacity(JAPANFOLD_ESMFOLD2_MAX_AA + 1);
    expect(pastTier1Ceiling.tier1Available).toBe(false);
    expect(pastTier1Ceiling.publicFallbackAvailable).toBe(false);
  });
});

describe("the server messages", () => {
  /**
   * Frozen deliberately. These strings are a 422 contract: `server/routes/structure.test.ts` asserts
   * them by substring and the client parses the residue count back out of them. Deriving the numbers
   * from the constants above is safe; changing the WORDING is a contract change and must fail here
   * first, where the reason is written down.
   */
  it("keeps the exact wording the 422 contract and the client parser depend on", () => {
    expect(deNovoFoldingLimitExceededMessage(711)).toBe(
      "Sequence length (711 aa) exceeds the de novo folding limits (1,024 aa for Tier-1 JapanFold ESMFold-2, and 400 aa for public ESM Atlas). De novo folding for proteins > 1,024 aa requires an EvolutionaryScale/Biohub API token or local GPU execution."
    );
    expect(esmAtlasFallbackExceededMessage(711)).toBe(
      "Sequence length (711 aa) exceeds the public ESM Atlas folding limit (400 aa). Tier-1 JapanFold ESMFold-2 was unavailable. De novo folding for proteins > 400 aa requires an EvolutionaryScale/Biohub API token or local GPU execution."
    );
    expect(stabilityEsmFoldEngineLimitMessage(900)).toBe(
      "Protein sequence length (900) exceeds the maximum allowed limit of 768 residues for ESMFold."
    );
  });

  it("quotes the constants rather than restating them", () => {
    const pastTier1 = deNovoFoldingLimitExceededMessage(JAPANFOLD_ESMFOLD2_MAX_AA + 1);
    expect(pastTier1).toContain(formatResidueCount(JAPANFOLD_ESMFOLD2_MAX_AA));
    expect(pastTier1).toContain(String(ESM_ATLAS_PUBLIC_MAX_AA));

    const pastAtlas = esmAtlasFallbackExceededMessage(711);
    expect(pastAtlas).toContain(`${ESM_ATLAS_PUBLIC_MAX_AA} aa`);
  });
});

describe("the notice a reader sees", () => {
  it("says nothing when both tiers accept the sequence", () => {
    expect(describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(400))).toBeNull();
    expect(describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(120))).toBeNull();
  });

  it("is informational, and names the number, when only the fallback is gone", () => {
    const notice = describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(711));
    expect(notice).not.toBeNull();
    expect(notice!.tone).toBe("info");
    // The old branch omitted its own count, which is exactly why its disagreement with the canvas
    // (which said 51 aa) was invisible.
    expect(notice!.body).toContain("711 aa");
    expect(notice!.body).toContain("1,024");
    expect(notice!.body).toContain("400");
  });

  it("is a warning, and names the number, when no de novo model is possible", () => {
    const notice = describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(1500));
    expect(notice).not.toBeNull();
    expect(notice!.tone).toBe("warning");
    expect(notice!.body).toContain("1,500 aa");
  });

  it("stops promising AlphaFold coordinates when the length proves there are none", () => {
    // PKD1 is 4,302 aa: past AlphaFold DB's 2,700 aa ceiling as well as both folding ceilings. The
    // shipped copy told the reader "AlphaFold2 coordinates are the full-length option" — a model the
    // database can never publish for this protein.
    const notice = describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(4302), {
      alphafoldModelAvailable: false,
    });
    expect(notice).not.toBeNull();
    expect(notice!.tone).toBe("warning");
    expect(notice!.body).toContain("4,302 aa");
    expect(notice!.body).toContain("2,700");
    expect(notice!.body).toContain("no full-length predicted coordinates");
    expect(notice!.body).not.toMatch(/AlphaFold2 coordinates are the full-length option/);
  });

  it("keeps the longstanding sentence when AlphaFold availability was not established", () => {
    // `null` is not `false`: only a length that proves exclusion may change the copy.
    for (const options of [{}, { alphafoldModelAvailable: null }]) {
      const notice = describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(1500), options);
      expect(notice!.body).toContain("AlphaFold2 coordinates are the full-length option.");
      expect(notice!.body).not.toContain("no full-length predicted coordinates");
    }
    // A protein within the ceiling keeps it too, because AlphaFold DB may still hold its model.
    const within = describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(1500), {
      alphafoldModelAvailable: true,
    });
    expect(within!.body).toContain("AlphaFold2 coordinates are the full-length option.");
  });

  it("never claims a configuration the repository does not have", () => {
    // THE REGRESSION. The shipped copy read "Sovereign JapanFold inference engine configured in
    // Settings is used for de novo folding" — no such engine, no such setting, and the fold had
    // failed. Every branch is checked, because the claim only has to reappear in one of them.
    for (const residues of [401, 711, 768, 1024, 1025, 1500]) {
      const notice = describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(residues));
      expect(notice, `no notice for ${residues}`).not.toBeNull();
      const text = `${notice!.title} ${notice!.body}`;
      expect(text, `${residues} aa notice claims a Settings engine`).not.toMatch(/settings/i);
      expect(text, `${residues} aa notice claims sovereignty`).not.toMatch(/sovereign/i);
      expect(text, `${residues} aa notice claims a routing rule`).not.toMatch(/is used for de novo folding/i);
    }
  });

  it("gets the capability direction right: past 400 aa deletes a fallback, it does not unlock an engine", () => {
    const notice = describeDeNovoCapacityNotice(resolveDeNovoFoldingCapacity(711));
    expect(notice!.body).toMatch(/fallback is unavailable/i);
    expect(notice!.body).toMatch(/no fallback for this length/i);
  });
});

describe("what a timeout licenses us to say", () => {
  it("does not assert provider load as fact", () => {
    // The unhedged originals: "timed out due to high GPU cluster load" and "High-throughput cloud GPUs
    // are experiencing high queue depth". The error that reaches the UI is a client watchdog abort and
    // carries no information about the provider at all.
    for (const text of [
      describeDeNovoFoldTimeout({ verbosity: "brief" }),
      describeDeNovoFoldTimeout({ residues: 711, verbosity: "detailed" }),
    ]) {
      expect(text).not.toMatch(/high[- ]throughput cloud GPUs are experiencing/i);
      expect(text).not.toMatch(/timed out due to high GPU cluster load/i);
      expect(text).toMatch(/usual cause/i);
    }
  });

  it("names the sequence only when its length is known", () => {
    expect(describeDeNovoFoldTimeout({ residues: 711, verbosity: "detailed" })).toContain("711 aa sequence");
    expect(describeDeNovoFoldTimeout({ residues: 1500, verbosity: "detailed" })).toContain("1,500 aa sequence");
    // Brief is the inspector card, which sits beside the canvas and must not restate a length it may
    // not have.
    expect(describeDeNovoFoldTimeout({ verbosity: "brief" })).not.toMatch(/\b\d[\d,]* aa sequence/);
    expect(describeDeNovoFoldTimeout({ residues: 711, verbosity: "detailed" })).not.toBe(
      describeDeNovoFoldTimeout({ residues: 711, verbosity: "brief" })
    );
  });
});

describe("reading a failure", () => {
  it("parses only the shapes our own builders produce", () => {
    expect(parseReportedSequenceLength(deNovoFoldingLimitExceededMessage(711))).toBe(711);
    expect(parseReportedSequenceLength(esmAtlasFallbackExceededMessage(1500))).toBe(1500);
    expect(parseReportedSequenceLength(stabilityEsmFoldEngineLimitMessage(900))).toBe(900);
  });

  it("refuses to mine a number out of text that is not about length", () => {
    // The loose `/(\d+)\s*aa/i` this replaces would happily read a scan window or a millisecond count
    // out of an unrelated message — the class of bug behind "Protein Length: 51 aa".
    expect(parseReportedSequenceLength("Request timed out after 240000ms")).toBeNull();
    expect(parseReportedSequenceLength("JapanFold inference timed out or returned pending state")).toBeNull();
    expect(parseReportedSequenceLength("ESM Atlas returned HTTP 413 (Payload Too Large).")).toBeNull();
    expect(parseReportedSequenceLength(null)).toBeNull();
    expect(parseReportedSequenceLength(undefined)).toBeNull();
    expect(parseReportedSequenceLength("")).toBeNull();
  });

  it("classifies length limits and timeouts without overlapping", () => {
    const limits = [
      deNovoFoldingLimitExceededMessage(711),
      esmAtlasFallbackExceededMessage(711),
      stabilityEsmFoldEngineLimitMessage(900),
    ];
    for (const message of limits) {
      expect(isFoldingLengthLimitError(message), message).toBe(true);
      expect(isFoldingTimeoutError(message), message).toBe(false);
    }

    const timeouts = [
      "Request timed out after 240000ms",
      "Network request timed out after 60000ms",
      "JapanFold inference timed out or returned pending state",
      "TimeoutError",
    ];
    for (const message of timeouts) {
      expect(isFoldingTimeoutError(message), message).toBe(true);
      expect(isFoldingLengthLimitError(message), message).toBe(false);
    }

    expect(isFoldingLengthLimitError(null)).toBe(false);
    expect(isFoldingTimeoutError(null)).toBe(false);
  });
});

describe("reading the protein length", () => {
  it("prefers the mutant translation, then the canonical sequence", () => {
    expect(readProteinLength({ mutatedSequence: "M".repeat(711), sequence: "M".repeat(700) })).toEqual({
      residues: 711,
      source: "mutatedSequence",
    });
    expect(readProteinLength({ sequence: "M".repeat(700) })).toEqual({
      residues: 700,
      source: "sequence",
    });
  });

  it("treats absent, null and empty sequences as unknown rather than as zero", () => {
    // `0` would render as "Protein Length: 0 aa" and read as a measurement.
    for (const metadata of [null, undefined, {}, { mutatedSequence: null }, { mutatedSequence: "" }, { sequence: "" }]) {
      expect(readProteinLength(metadata as any)).toEqual({ residues: null, source: "unavailable" });
    }
  });
});
