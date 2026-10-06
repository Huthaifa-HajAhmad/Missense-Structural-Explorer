import { describe, it, expect } from "vitest";
import { buildLiteratureSummary, canonicalLiteratureSummary, literatureSummaryPrompt } from "../literatureSummary";
const paper = (id: string, abstract: string, year: number | null = 2026, similarity: number | null = null) => ({ id, title: "PAH study", abstract, authors: "Author A", journal: "Journal", year, similarity });
describe("screening-selected narrative literature", () => {
  it("prioritizes exact-variant assays without embeddings over highly similar gene papers and deduplicates", () => {
    const hit = paper("hit", "PAH p.Arg408Trp activity was reduced in vitro.");
    const selected = buildLiteratureSummary("PAH", "p.Arg408Trp", [paper("gene", "PAH activity was tested.", 2026, .99), hit, hit]);
    expect(selected.citations.map(c => c.id)).toEqual(["hit", "gene"]);
    expect(selected.withoutEmbeddings).toBe(1);
  });
  it("caps selection, skips absent abstracts, and breaks within-tier ties by similarity, year and ID", () => {
    const selected = buildLiteratureSummary("PAH", "p.Arg408Trp", [paper("empty", ""), ...Array.from({length: 8}, (_, i) => paper(String(i), "PAH activity was measured.", 2020 + i, i / 10))]);
    expect(selected.citations).toHaveLength(5);
    expect(selected.citations.map(c => c.id)).toEqual(["7", "6", "5", "4", "3"]);
    const missing = buildLiteratureSummary("PAH", "p.Arg408Trp", [paper("b", "PAH activity.", null), paper("a", "PAH activity.", 2025)]);
    expect(missing.citations.map(c => c.id)).toEqual(["a", "b"]);
  });
  it("retains curated full-text relationships and excludes volatile retrieval times from identity", () => {
    const link = { provider: "uniprot" as const, featureId: "VAR_001", accession: "P00439", variant: "R408W", variantDescription: "Variant", evidenceCode: "ECO:0000269", pmid: "123", source: "PubMed", sourceUrl: "https://www.uniprot.org/uniprotkb/P00439/entry", retrievedAt: "2026-10-05T00:00:00Z" };
    const curated = {...paper("123", "Activity of the purified enzyme was reduced."), title:"Enzyme study", curatedLinks:[link]};
    const first = buildLiteratureSummary("PAH", "p.Arg408Trp", [curated, paper("gene", "PAH activity.",2026,.99)]);
    expect(first.citations[0].id).toBe("123");
    expect(first.citations[0].screening.tier).toBe(1);
    expect(literatureSummaryPrompt(first)).toContain("VAR_001");
    const later=buildLiteratureSummary("PAH", "p.Arg408Trp", [{...curated,curatedLinks:[{...link,retrievedAt:"2026-10-06T00:00:00Z"}]},paper("gene","PAH activity.",2026,.99)]);
    expect(canonicalLiteratureSummary(first)).toBe(canonicalLiteratureSummary(later));
  });
  it("changes cache identity for changed selected content, IDs or retrieval outcomes", () => {
    const base = buildLiteratureSummary("PAH", "p.Arg408Trp", [paper("1", "PAH activity.")]);
    expect(canonicalLiteratureSummary(base)).not.toBe(canonicalLiteratureSummary(buildLiteratureSummary("PAH", "p.Arg408Trp", [paper("1", "PAH activity was reduced.")])));
    expect(canonicalLiteratureSummary(base)).not.toBe(canonicalLiteratureSummary(buildLiteratureSummary("PAH", "p.Arg408Trp", [paper("2", "PAH activity.")])));
    expect(canonicalLiteratureSummary(base)).not.toBe(canonicalLiteratureSummary({...base, scopes:{...base.scopes,variant:"error"}}));
  });
  it("prints actual quotes and incomplete scope status with explicit no-criterion rules", () => {
    const selected = buildLiteratureSummary("PAH", "p.Arg408Trp", [paper("1", "PAH p.Arg408Trp activity was reduced.")], {gene:"complete",variant:"error",curated:"unavailable"});
    const prompt = literatureSummaryPrompt(selected);
    expect(prompt).toContain("PAH p.Arg408Trp activity was reduced.");
    expect(prompt).toContain('"variant":"error"');
    expect(prompt).toContain("must NOT create or strengthen an ACMG/AMP criterion");
    expect(literatureSummaryPrompt({...selected,citations:[]})).toContain("draw no conclusion about absence");
  });
});

it("leaves the narrative empty when candidates have no gene, variant or curated relationship", () => {
  const selected = buildLiteratureSummary("RGS9", "p.Cys182Ser", [{ ...paper("goose", "We studied body weight in geese."), title: "Goose genetics" }]);
  expect(selected.citations).toEqual([]);
  expect(literatureSummaryPrompt(selected)).toContain("draw no conclusion about absence");
});
