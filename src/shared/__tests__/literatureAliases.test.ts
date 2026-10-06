import { describe, expect, it } from "vitest";
import { verifiedAliasQuery } from "../literatureAliases";
const alias = { notation: "NM_000277.3:c.1222C>T", gene: "PAH", proteinVariant: "p.Arg408Trp", uniprotId: "P00439", source: "ensembl-vep" as const };
describe("provider-bound literature aliases", () => {
  it("searches the qualified HGVS and cDNA spelling from the resolved allele", () => {
    expect(verifiedAliasQuery("PAH", "R408W", "P00439", [alias])).toBe('PAH AND ("NM_000277.3:c.1222C>T" OR "c.1222C>T")');
  });
  it("rejects stale gene, accession and alternate-residue context", () => {
    for (const changed of [{ gene: "RGS9" }, { uniprotId: "Q13564" }, { proteinVariant: "R408Q" }]) {
      expect(verifiedAliasQuery("PAH", "R408W", "P00439", [{ ...alias, ...changed }])).toBeNull();
    }
  });
  it("does not invent a reverse nucleotide mapping or accept arbitrary query syntax", () => {
    expect(verifiedAliasQuery("PAH", "R408W", "P00439", [])).toBeNull();
    expect(verifiedAliasQuery("PAH", "R408W", "P00439", [{ ...alias, notation: 'c.1222C>T OR cancer' }])).toBeNull();
  });
});
