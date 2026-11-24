import { describe, expect, it } from "vitest";
import { VerifiedResidue, type Residue } from "./verifiedResidue";

const residue = (proof: Residue["proof"]): Residue => ({
  accession: "Q9Y305",
  position: 55,
  wildType: "R",
  mutant: "A",
  proof,
});

describe("VerifiedResidue", () => {
  it("is made only from a residue whose numbering was proven", () => {
    for (const proof of ["genomic", "declared-protein", "canonical-vs-mane", "user-confirmed"] as const) {
      expect(VerifiedResidue.of(residue(proof))?.residue.proof).toBe(proof);
    }
  });

  it("refuses an unverified residue, so code that needs a proven position cannot get one", () => {
    expect(VerifiedResidue.of({ ...residue("unverified"), reason: "UniProt did not answer" })).toBeNull();
  });

  it("does not accept an object that only copies its fields", () => {
    const real = VerifiedResidue.of(residue("genomic"));
    const copy = { ...real, residue: residue("genomic") };
    expect(VerifiedResidue.is(real)).toBe(true);
    expect(VerifiedResidue.is(copy)).toBe(false);
  });
});
