import { describe, it, expect } from "vitest";
import {
  ALPHAFOLD_ABSENCE_HEADER,
  ALPHAFOLD_ABSENCE_REASONS,
  ALPHAFOLD_DB_MAX_MODELLED_AA,
  alphafoldDbCoverage,
  formatResidueCount,
  isAlphaFoldAbsenceReason,
  readProteinLength,
} from "../alphafoldAvailability";

/**
 * AlphaFold DB's ceiling is a rule about the protein, not about a lookup.
 *
 * These tests exist because the app used to ask the database for models it can never publish — PKD1
 * (P98161, 4,302 aa) — and then reported the honest 404 as a degraded network call, while the rail
 * beside it offered "switch to AlphaFold" coordinates that do not exist.
 */

describe("the AlphaFold DB single-chain ceiling", () => {
  it("is the published 2,700 aa bound, stated once", () => {
    expect(ALPHAFOLD_DB_MAX_MODELLED_AA).toBe(2700);
  });

  it("includes the ceiling and excludes everything past it", () => {
    // The FAQ's wording is "up to 2,700"; a protein of exactly 2,700 aa is within the rule.
    expect(alphafoldDbCoverage(ALPHAFOLD_DB_MAX_MODELLED_AA)).toBe("within-limit");
    expect(alphafoldDbCoverage(ALPHAFOLD_DB_MAX_MODELLED_AA + 1)).toBe("beyond-limit");
    // PKD1, the variant this module was written for.
    expect(alphafoldDbCoverage(4302)).toBe("beyond-limit");
  });

  it("does not decide an unknown length either way", () => {
    // A missing length must not become "there is no model" — that would be an invented absence.
    for (const value of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(alphafoldDbCoverage(value as number | null | undefined), String(value)).toBe("unknown");
    }
  });
});

describe("the absence marker", () => {
  it("accepts only the reasons the app can prove without asking the database", () => {
    expect(isAlphaFoldAbsenceReason("beyond-length-limit")).toBe(true);
    // An upstream outage is not a property of the protein.
    expect(isAlphaFoldAbsenceReason("upstream-error")).toBe(false);
    expect(isAlphaFoldAbsenceReason(null)).toBe(false);
    expect(isAlphaFoldAbsenceReason(undefined)).toBe(false);
    expect(isAlphaFoldAbsenceReason("")).toBe(false);
  });

  it("fixes the header name and the reason vocabulary in one place", () => {
    expect(ALPHAFOLD_ABSENCE_HEADER).toBe("X-Alphafold-Absence");
    expect(ALPHAFOLD_ABSENCE_REASONS).toEqual(["beyond-length-limit"]);
  });
});

describe("formatting a residue count", () => {
  it("formats residue counts without depending on the ICU build", () => {
    expect(formatResidueCount(400)).toBe("400");
    expect(formatResidueCount(711)).toBe("711");
    expect(formatResidueCount(1024)).toBe("1,024");
    expect(formatResidueCount(12345)).toBe("12,345");
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
