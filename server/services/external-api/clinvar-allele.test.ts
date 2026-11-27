import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchClinVarData } from "./clinvar.ts";
import { clearAllCaches } from "../infra/cache.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";
import { buildClinvarKey } from "../infra/cache-keys.ts";

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

it("withholds PS1 on an unresolved protein-only query with multiple coding alleles (TP53 p.Lys132Asn)", async () => {
  const tp53 = (cdna: string, spdi: string) => ({
    title: `NM_000546.6(TP53):${cdna} (p.Lys132Asn)`,
    genes: [{ symbol: "TP53" }],
    variation_set: [{ canonical_spdi: spdi }],
    germline_classification: { description: "Pathogenic", review_status: "reviewed by expert panel", trait_set: [] },
    allele_freq_set: [],
  });
  // Protein-only query with no verified DNA coordinate or c. notation: cannot assert a different DNA allele.
  mockRecords({
    "12366": tp53("c.396G>C", "NC_000017.11:7675215:C:G"),
    "12367": tp53("c.396G>T", "NC_000017.11:7675215:C:A"),
  });
  const ambiguous = await fetchClinVarData("TP53", "p.Lys132Asn");
  expect(ambiguous.hasOtherPathogenicVariantSameAA).toBe(false);

  // Explicit c.396G>C query with verified alternate pathogenic c.396G>T still sets PS1 comparator flag.
  clearAllCaches(true);
  mockRecords({
    "12366": tp53("c.396G>C", "NC_000017.11:7675215:C:G"),
    "12367": tp53("c.396G>T", "NC_000017.11:7675215:C:A"),
  });
  const resolved = await fetchClinVarData("TP53", "p.Lys132Asn", {
    originalNotation: "NM_000546.6:c.396G>C",
    coordinate: { chrom: "17", pos: 7675216, ref: "C", alt: "G", assembly: "GRCh38" },
  });
  expect(resolved.uid).toBe("12366");
  expect(resolved.hasOtherPathogenicVariantSameAA).toBe(true);
});

it("selects the exact transcript-qualified coding allele in reversed provider order without a genomic coordinate", async () => {
  const tp53 = (cdna: string, tx = "NM_000546.6") => ({
    title: `${tx}(TP53):${cdna} (p.Lys132Asn)`,
    genes: [{ symbol: "TP53" }],
    variation_set: [],
    germline_classification: { description: "Pathogenic", review_status: "reviewed by expert panel", trait_set: [] },
    allele_freq_set: [],
  });
  // Provider returns alternate c.396G>T first (higher ID sorted first), queried c.396G>C second.
  mockRecords({
    "12367": tp53("c.396G>T"),
    "12366": tp53("c.396G>C"),
  });
  const res = await fetchClinVarData("TP53", "p.Lys132Asn", { originalNotation: "NM_000546.6:c.396G>C" });
  expect(res.uid).toBe("12366");
  expect(res.hasOtherPathogenicVariantSameAA).toBe(true);

  // An explicit coding allele that matches no record must not fall back to another allele at index 0.
  clearAllCaches(true);
  mockRecords({ "12367": tp53("c.396G>T") });
  const unmatched = await fetchClinVarData("TP53", "p.Lys132Asn", { originalNotation: "NM_000546.6:c.396G>C" });
  expect(unmatched.uid).toBeNull();
  expect(unmatched.hasOtherPathogenicVariantSameAA).toBe(false);

  // Two coding notations on different transcripts without distinct SPDIs cannot establish PS1.
  clearAllCaches(true);
  mockRecords({
    "12367": tp53("c.396G>T", "NM_001126112.3"),
    "12366": tp53("c.396G>C", "NM_000546.6"),
  });
  const diffTx = await fetchClinVarData("TP53", "p.Lys132Asn", { originalNotation: "NM_000546.6:c.396G>C" });
  expect(diffTx.uid).toBe("12366");
  expect(diffTx.hasOtherPathogenicVariantSameAA).toBe(false);

  // Explicitly versioned transcript query must not silently bind to a different transcript version.
  clearAllCaches(true);
  mockRecords({ "12366": tp53("c.396G>C", "NM_000546.5") });
  const wrongVersion = await fetchClinVarData("TP53", "p.Lys132Asn", { originalNotation: "NM_000546.6:c.396G>C" });
  expect(wrongVersion.uid).toBeNull();
  expect(wrongVersion.hasOtherPathogenicVariantSameAA).toBe(false);

  // A comparator with no transcript accession and no genomic SPDI cannot establish PS1.
  clearAllCaches(true);
  mockRecords({
    "12367": {
      title: "TP53:c.396G>T (p.Lys132Asn)",
      genes: [{ symbol: "TP53" }],
      variation_set: [],
      germline_classification: { description: "Pathogenic", review_status: "reviewed by expert panel", trait_set: [] },
      allele_freq_set: [],
    },
    "12366": tp53("c.396G>C", "NM_000546.6"),
  });
  const missingTxComparator = await fetchClinVarData("TP53", "p.Lys132Asn", { originalNotation: "NM_000546.6:c.396G>C" });
  expect(missingTxComparator.uid).toBe("12366");
  expect(missingTxComparator.hasOtherPathogenicVariantSameAA).toBe(false);

  // Two unversioned transcript accessions (e.g. NM_000546 without .version) and no SPDIs cannot establish PS1.
  clearAllCaches(true);
  mockRecords({
    "12367": tp53("c.396G>T", "NM_000546"),
    "12366": tp53("c.396G>C", "NM_000546"),
  });
  const unversionedTx = await fetchClinVarData("TP53", "p.Lys132Asn", { originalNotation: "NM_000546:c.396G>C" });
  expect(unversionedTx.uid).toBe("12366");
  expect(unversionedTx.hasOtherPathogenicVariantSameAA).toBe(false);
});

it("retires pre-upgrade allele1 ClinVar SQLite cache rows carrying unverified PS1 (upgrade check)", async () => {
  const newKey = buildClinvarKey("TP53", "p.Lys132Asn");
  expect(newKey).toContain("_allele2_");
  const legacyKey = newKey.replace("_allele2_", "_allele1_");
  const db = AnalysisDatabase.getInstance();
  db.saveExternalCache(legacyKey, {
    classification: "Pathogenic",
    lastEvaluated: "2024-01-01",
    reviewStatus: "reviewed by expert panel",
    alleleFrequencies: [],
    trait: "Li-Fraumeni syndrome",
    uid: "12366",
    hasOtherPathogenicVariantSameAA: true,
  }, "clinvar", 86400);

  const tp53 = (cdna: string, spdi: string) => ({
    title: `NM_000546.6(TP53):${cdna} (p.Lys132Asn)`,
    genes: [{ symbol: "TP53" }],
    variation_set: [{ canonical_spdi: spdi }],
    germline_classification: { description: "Pathogenic", review_status: "reviewed by expert panel", trait_set: [] },
    allele_freq_set: [],
  });
  mockRecords({
    "12366": tp53("c.396G>C", "NC_000017.11:7675215:C:G"),
    "12367": tp53("c.396G>T", "NC_000017.11:7675215:C:A"),
  });

  const upgraded = await fetchClinVarData("TP53", "p.Lys132Asn");
  expect(upgraded.hasOtherPathogenicVariantSameAA).toBe(false);
});
