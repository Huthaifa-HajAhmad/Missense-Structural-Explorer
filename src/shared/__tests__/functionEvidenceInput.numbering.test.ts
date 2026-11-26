import { describe, expect, it } from "vitest";
import { functionEvidenceInputFrom } from "../functionEvidenceInput.ts";
import type { AnalysisResult } from "../contracts.ts";

/**
 * The Function tab's trace says "Residue renumbered onto canonical" for a `remapped` basis. A remap that
 * kept the residue number (ABCG1 Gly358 on P45844-4 and on P45844-1) is an isoform switch, so the trace
 * must read it as numbered on canonical, not renumbered.
 */
const result = (to: string) =>
  ({
    metadata: { gene: "ABCG1", variant: to, uniprotId: "P45844", residueIndex: 358 },
    numberingBasis: "remapped",
    numberingRemap: {
      from: { hgvsp: "ENSP00000381467.3:p.Gly358Arg", isoform: "P45844-4" },
      to: { hgvsp: `ENSP00000354995.2:${to}`, isoform: "P45844-1" },
    },
  } as unknown as AnalysisResult);

describe("function evidence numbering basis", () => {
  it("reads a same-number isoform switch as canonical numbering", () => {
    expect(functionEvidenceInputFrom(result("p.Gly358Arg")).numberingBasis).toBe("canonical");
  });

  it("keeps a real renumbering as remapped", () => {
    expect(functionEvidenceInputFrom(result("p.Gly346Arg")).numberingBasis).toBe("remapped");
  });
});
