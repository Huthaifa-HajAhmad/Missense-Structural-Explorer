import { describe, expect, it } from "vitest";
import { isIntrinsicallyAmbiguousProteinChange as ambiguous } from "../proteinAlleleIdentity";

describe("conservative NCBI Table 1 ambiguity proof", () => {
  it.each(["Q867H", "p.Gln867His", "p.(Gln867His)", "NM_005072.5:p.Gln867His", "K272N", "N12K", "E12D", "H12Q", "M12I"])("proves multiple single-base alternatives for %s", (notation) => {
    expect(ambiguous(notation, "SLC12A4")).toBe(true);
  });
  it.each(["D116G", "Q867Q", "M1I", "Q0H", "Q9007199254740992H", "c.2601G>T", "p.X867H", "not-a-variant"])("does not invent proof for %s", (notation) => {
    expect(ambiguous(notation)).toBe(false);
  });
  it("does not assert the standard nuclear code for mitochondrial genes", () => {
    expect(ambiguous("Q867H", " MT-ND1 ")).toBe(false);
  });
});
