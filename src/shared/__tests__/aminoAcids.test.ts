import { describe, expect, it } from "vitest";
import {
  AMINO_ACID_1_TO_3,
  AMINO_ACID_1_TO_3_TITLE,
  AMINO_ACID_3_TO_1,
  AMINO_ACID_FULL_NAME,
} from "../aminoAcids";

describe("amino-acid tables", () => {
  const codes = Object.keys(AMINO_ACID_1_TO_3).sort();

  it("cover the same twenty residues in every one-letter table", () => {
    expect(codes).toHaveLength(20);
    expect(Object.keys(AMINO_ACID_1_TO_3_TITLE).sort()).toEqual(codes);
    expect(Object.keys(AMINO_ACID_FULL_NAME).sort()).toEqual(codes);
  });

  it("agree with each other and round-trip through the three-letter table", () => {
    for (const code of codes) {
      const upper = AMINO_ACID_1_TO_3[code];
      expect(AMINO_ACID_1_TO_3_TITLE[code].toUpperCase()).toBe(upper);
      expect(AMINO_ACID_FULL_NAME[code]).toMatch(/^[A-Z][a-z]{4,}$/);
      expect(AMINO_ACID_3_TO_1[upper]).toBe(code);
      expect(AMINO_ACID_3_TO_1[AMINO_ACID_1_TO_3_TITLE[code]]).toBe(code);
    }
  });
});
