import { describe, expect, it } from "vitest";
import { dbnsfpGeneTerm, geneSymbolAliases, normalizeGeneSymbol, sameGene } from "./gene-symbols.ts";

describe("gene symbols — GBA was renamed GBA1", () => {
  it("uses the current symbol, whichever name is given", () => {
    expect(normalizeGeneSymbol(" gba ")).toBe("GBA1");
    expect(normalizeGeneSymbol("GBA1")).toBe("GBA1");
    expect(normalizeGeneSymbol("tp53")).toBe("TP53");
  });

  it("lists the current symbol first, then the retired one a source may still hold", () => {
    expect(geneSymbolAliases("GBA")).toEqual(["GBA1", "GBA"]);
    expect(geneSymbolAliases("TP53")).toEqual(["TP53"]);
  });

  it("compares the two names as one gene, and nothing else", () => {
    expect(sameGene("GBA", "gba1")).toBe(true);
    expect(sameGene("GBA", "GBAP1")).toBe(false);
    expect(sameGene("TP53", "TP63")).toBe(false);
  });

  it("asks dbNSFP under every name, and plainly for a gene with one name", () => {
    expect(dbnsfpGeneTerm("GBA1")).toBe("dbnsfp.genename:(GBA1 OR GBA)");
    expect(dbnsfpGeneTerm("TP53")).toBe("dbnsfp.genename:TP53");
  });
});
