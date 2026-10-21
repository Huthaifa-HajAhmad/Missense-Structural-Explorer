import { describe, expect, it } from "vitest";
import { composeQuickEntry, quickEntryMatches, readQuickEntry } from "../quickEntry";

describe("readQuickEntry", () => {
  it("splits a gene and a protein change", () => {
    expect(readQuickEntry("NAE1 p.Asp116Gly")).toMatchObject({ gene: "NAE1", variant: "p.Asp116Gly", genomic: "", recognised: true });
  });

  it("accepts a GENE: prefix and the one-letter form, upper-casing the symbol", () => {
    expect(readQuickEntry("tp53:p.Arg248Trp")).toMatchObject({ gene: "TP53", variant: "p.Arg248Trp", recognised: true });
    expect(readQuickEntry("TP53 R248W")).toMatchObject({ gene: "TP53", variant: "R248W", recognised: true });
  });

  it("routes coordinates and database ids to the genomic field with no gene", () => {
    expect(readQuickEntry("20-23365054-G-A")).toMatchObject({ gene: "", genomic: "20-23365054-G-A", variant: "", recognised: true });
    expect(readQuickEntry("rs28934576")).toMatchObject({ genomic: "rs28934576", recognised: true });
  });

  it("does not mistake a transcript accession prefix for a gene", () => {
    const read = readQuickEntry("NM_000546.6:c.742C>T");
    expect(read.gene).toBe("");
    expect(read.variant).toBe("NM_000546.6:c.742C>T");
  });

  it("takes a trailing UniProt accession", () => {
    expect(readQuickEntry("NAE1 p.Asp116Gly Q13564")).toMatchObject({ gene: "NAE1", variant: "p.Asp116Gly", uniprot: "Q13564" });
  });

  it("keeps a bare gene, and unplaceable text, visible without claiming recognition", () => {
    expect(readQuickEntry("NAE1")).toMatchObject({ gene: "NAE1", variant: "", recognised: false });
    expect(readQuickEntry("NAE1 p.As")).toMatchObject({ gene: "NAE1", variant: "p.As", recognised: false });
    expect(readQuickEntry("!!")).toMatchObject({ variant: "!!", recognised: false });
    expect(readQuickEntry("   ").recognised).toBe(false);
  });
});

describe("composeQuickEntry / quickEntryMatches", () => {
  it("prefers the coordinate, otherwise joins gene and notation", () => {
    expect(composeQuickEntry({ gene: "NAE1", variant: "p.Asp116Gly", genomic: "" })).toBe("NAE1 p.Asp116Gly");
    expect(composeQuickEntry({ gene: "NAE1", variant: "", genomic: "20-1-A-G" })).toBe("20-1-A-G");
  });

  it("lets a half-typed line stand, so a trailing space is not eaten", () => {
    expect(quickEntryMatches("NAE1 ", { gene: "NAE1", variant: "", genomic: "" })).toBe(true);
    expect(quickEntryMatches("NAE1 p.Asp116Gly", { gene: "CNNM2", variant: "p.Ser489Cys", genomic: "" })).toBe(false);
  });
});
