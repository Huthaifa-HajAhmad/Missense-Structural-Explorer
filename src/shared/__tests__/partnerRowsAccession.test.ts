import { describe, expect, it } from "vitest";
import { collectPartnerRows } from "../interfaces/partnerRows";
import type { ObservedView } from "../interfaces/types";

/** HLA-A accessions share one partner-gene row. */
const solvedPartner = (accession: string, pdbEntries: string[]) => ({
  accession, name: "HLA class I histocompatibility antigen, A alpha chain", gene: "HLA-A", organism: null,
  homomeric: false, artefact: null, context: "native", residues: [175], support: [1], pdbEntries,
  modelledEntries: pdbEntries, variantAtInterface: true, variantEntries: pdbEntries.slice(0, 1),
  label: "HLA-A", key: `solved:${accession}:native`, n: pdbEntries.length, total: pdbEntries.length, k: 1, maxSupport: 1,
}) as unknown as ObservedView;

describe("Partner genes merge solved accessions (B5)", () => {
  it("unions entries and retains contacts from every accession", () => {
    const store = collectPartnerRows({
      gene: "TP53", uniprotId: "P04637", rec: { kind: "monomer", partners: [] } as never, statements: [], subunitText: null,
      observed: [solvedPartner("A0A140T913", ["6vqo", "6vr1"]), solvedPartner("P04439", ["6vr1", "7xyz"])],
      intact: [], sites: [], ppi: null,
    });
    const rows = [...store.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0].observed).toMatchObject({ pdbEntries: ["6vqo", "6vr1", "7xyz"], total: 3, n: 3, k: 2 });
    expect(rows[0].variantAtObservedInterface).toBe(true);
  });
});


it("keeps peptide contacts outside the native observations", async () => {
  const { readObserved } = await import("../interfaces/observed");
  const peptide = { ...solvedPartner("P04439", ["6vqo"]), context: "peptide" };
  const native = solvedPartner("A0A140T913", ["7xyz"]);
  const observed = readObserved({ experimental: { status: "ok", peptideChecked: true, partners: [peptide, native] } } as never, {} as never, "TP53", false);
  expect(observed.partners.flatMap(p => p.pdbEntries)).toEqual(["7xyz"]);
  expect(observed.peptides.flatMap(p => p.pdbEntries)).toEqual(["6vqo"]);
});
