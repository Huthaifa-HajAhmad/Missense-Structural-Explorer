import { describe, it, expect } from "vitest";
import { isGenomicOrCdnaNotation } from "../useAnalysisPipeline";

describe("isGenomicOrCdnaNotation Detection Unit Tests", () => {
  it("should detect HGVS genomic coordinate formats with chr prefix", () => {
    expect(isGenomicOrCdnaNotation("chr7:g.140753336A>T")).toBe(true);
    expect(isGenomicOrCdnaNotation("Chr20:g.23365248G>T")).toBe(true);
    expect(isGenomicOrCdnaNotation("chrX:g.123456C>G")).toBe(true);
    expect(isGenomicOrCdnaNotation("chrMT:g.7581T>C")).toBe(true);
  });

  it("should detect genomic coordinate formats without chr prefix", () => {
    expect(isGenomicOrCdnaNotation("7:g.140753336A>T")).toBe(true);
    expect(isGenomicOrCdnaNotation("20:g.23365248G>T")).toBe(true);
    expect(isGenomicOrCdnaNotation("X:g.123456C>G")).toBe(true);
    expect(isGenomicOrCdnaNotation("20:23365054")).toBe(true);
    expect(isGenomicOrCdnaNotation("g.140753336A>T")).toBe(true);
  });

  it("should detect un-prefixed and prefixed dashed genomic coordinates", () => {
    expect(isGenomicOrCdnaNotation("20-23365054-G-A")).toBe(true);
    expect(isGenomicOrCdnaNotation("chr20-23365054-G-A")).toBe(true);
    expect(isGenomicOrCdnaNotation("7-140753336-A-T")).toBe(true);
    expect(isGenomicOrCdnaNotation("X-123456-C-T")).toBe(true);
  });

  it("should detect cDNA notations with and without accession prefix", () => {
    expect(isGenomicOrCdnaNotation("NM_004333.6:c.1799T>A")).toBe(true);
    expect(isGenomicOrCdnaNotation("ENST00000288602.11:c.1799T>A")).toBe(true);
    expect(isGenomicOrCdnaNotation("c.1799T>A")).toBe(true);
  });

  it("should NOT flag standard protein missense or amino acid variants as genomic/cDNA", () => {
    expect(isGenomicOrCdnaNotation("p.Val600Glu")).toBe(false);
    expect(isGenomicOrCdnaNotation("Val600Glu")).toBe(false);
    expect(isGenomicOrCdnaNotation("V600E")).toBe(false);
    expect(isGenomicOrCdnaNotation("p.Arg215Trp")).toBe(false);
    expect(isGenomicOrCdnaNotation("R215W")).toBe(false);
    expect(isGenomicOrCdnaNotation("p.Gly380Arg")).toBe(false);
  });
});
