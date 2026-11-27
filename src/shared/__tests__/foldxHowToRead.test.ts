import { describe, expect, it } from "vitest";
import { FOLDX_HOW_TO_READ } from "../foldxRepairMode";

describe("FoldX reading guide", () => {
  it("tells the reader that only one protein chain is modelled", () => {
    // Live hard cases: TP53 on 1TSR was scored without its DNA, haemoglobin on chain B alone.
    expect(FOLDX_HOW_TO_READ("kcal/mol")).toContain("FoldX here models one protein chain: partner chains, DNA and ligands are left out, so effects on binding are not measured.");
  });
});
