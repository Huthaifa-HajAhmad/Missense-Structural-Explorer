import { describe, expect, it } from "vitest";
import { fetchGnomadGeneConstraint } from "./gnomad-gene-constraint.ts";

describe("fetchGnomadGeneConstraint — a gene the bundled release holds under its retired symbol", () => {
  it("finds GBA1 in the v4.1.2 table, which still names it GBA", async () => {
    for (const symbol of ["GBA1", "GBA"]) {
      const constraint = await fetchGnomadGeneConstraint(symbol);
      expect(constraint?.provenance).toMatchObject({ transcriptId: "ENST00000368373", selection: "mane-select" });
    }
  });
});
