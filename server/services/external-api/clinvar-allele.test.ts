import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchClinVarData } from "./clinvar.ts";
import { clearAllCaches } from "../infra/cache.ts";

beforeEach(() => clearAllCaches(true));
afterEach(() => vi.restoreAllMocks());

const coordinate = { chrom: "4", pos: 1804392, ref: "G", alt: "A", assembly: "GRCh38" };
const entry = (cdna: string, spdi?: string, classification = "Pathogenic") => ({
  title: "NM_000142.5(FGFR3):" + cdna + " (p.Gly380Arg)",
  genes: [{ symbol: "FGFR3" }],
  variation_set: spdi ? [{ canonical_spdi: spdi }] : [],
  germline_classification: { description: classification, review_status: "x", trait_set: [] },
  allele_freq_set: [],
});

function mockRecords(records: Record<string, ReturnType<typeof entry>>) {
  const ids = Object.keys(records).sort((a, b) => Number(b) - Number(a));
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(new Response(JSON.stringify({ esearchresult: { idlist: ids } })));
  spy.mockResolvedValueOnce(new Response(JSON.stringify({ result: { uids: ids, ...records } })));
  spy.mockResolvedValue(new Response("", { status: 404 }));
}

it("selects the verified allele even when the first protein match has no coordinates", async () => {
  mockRecords({
    "16328": entry("c.1138G>C"),
    "16327": entry("c.1138G>A", "NC_000004.12:1804391:G:A"),
  });
  const result = await fetchClinVarData("FGFR3", "p.Gly380Arg", { coordinate });
  expect(result.uid).toBe("16327");
});

it("withholds an allele-specific assertion when no record verifies the coordinate", async () => {
  mockRecords({ "16328": entry("c.1138G>C") });
  const result = await fetchClinVarData("FGFR3", "p.Gly380Arg", { coordinate });
  expect(result.uid).toBeNull();
});

it("keeps a protein-only lookup usable when no coordinate was provided", async () => {
  mockRecords({ "16328": entry("c.1138G>C") });
  const result = await fetchClinVarData("FGFR3", "p.Gly380Arg");
  expect(result.uid).toBe("16328");
});

it("retains pathogenic alternate-allele evidence for the same amino-acid change", async () => {
  mockRecords({
    "16328": entry("c.1138G>C", "NC_000004.12:1804391:G:C"),
    "16327": entry("c.1138G>A", "NC_000004.12:1804391:G:A"),
  });
  const result = await fetchClinVarData("FGFR3", "p.Gly380Arg", { coordinate });
  expect(result.uid).toBe("16327");
  expect(result.hasOtherPathogenicVariantSameAA).toBe(true);
});

it("excludes conflicting alternate records from PS1 comparisons", async () => {
  mockRecords({
    "16328": entry("c.1138G>C", "NC_000004.12:1804391:G:C", "Conflicting classifications of pathogenicity"),
    "16327": entry("c.1138G>A", "NC_000004.12:1804391:G:A"),
  });
  const result = await fetchClinVarData("FGFR3", "p.Gly380Arg", { coordinate });
  expect(result.uid).toBe("16327");
  expect(result.hasOtherPathogenicVariantSameAA).toBe(false);
});
