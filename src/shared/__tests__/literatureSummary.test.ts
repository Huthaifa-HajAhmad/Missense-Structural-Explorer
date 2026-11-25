import { describe, it, expect } from "vitest";
import { buildLiteratureSummary, canonicalLiteratureSummary, literatureSummaryPrompt, SUMMARY_SELECTION_VERSION, summaryScopeRows, type LiteratureSummarySelection } from "../literatureSummary";
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

it("gives each retrieval scope one plain row, so a scope is never listed twice with two states", () => {
  // The FGFR3 p.Gly380Arg receipt on production: the 5-second budget ended while the variant search
  // was paging, before the gene search and the curated lookup returned.
  const rows = summaryScopeRows({
    citations: [],
    scopes: { gene: "error", variant: "error", curated: "error" },
    coverage: [{ scope: "variant", query: "FGFR3 AND (\"p.Gly380Arg\")", loaded: 25, matched: 495, state: "error", truncated: true }],
  });
  expect(rows).toEqual([
    { label: "Gene search", text: "Did not finish" },
    { label: "Variant notation search", text: "25 of 495 read · stopped before it finished" },
    { label: "Clinical and functional search", text: "Did not finish" },
    { label: "Curated variant records", text: "Did not finish" },
  ]);
});
it("says a finished but bounded search left matches unread, and keeps older receipts without coverage", () => {
  const rows = summaryScopeRows({
    citations: [],
    scopes: { gene: "complete", variant: "unavailable", curated: "complete" },
    coverage: [{ scope: "gene", query: "Default gene search", loaded: 100, matched: 747, state: "complete", truncated: true }],
  });
  expect(rows.map(r => r.text)).toEqual(["100 of 747 read · more matches not read", "Not available", "Did not finish", "Complete"]);
  expect(summaryScopeRows({ citations: [], scopes: { gene: "complete", variant: "complete", curated: "unavailable" }, coverage: [] }).map(r => r.label))
    .toEqual(["Gene search", "Variant notation search", "Curated variant records"]);
});

describe("narrative cache identity", () => {
  const selection = (loaded: number, truncated: boolean, state: "complete" | "error" = "complete"): LiteratureSummarySelection => ({
    citations: [],
    scopes: { gene: "complete", variant: "complete", curated: "complete" },
    withoutEmbeddings: 0,
    coverage: [{ scope: "variant", query: "PAH AND (\"R408W\")", loaded, matched: 300, state, truncated }],
  });
  it("does not change when only the number of pages read in the time budget changes", () => {
    // The same gene and variant read 25 papers on a slow upstream and 75 on a fast one. Both selected the
    // same abstracts, so they must share one cached narrative instead of paying for a second one.
    expect(canonicalLiteratureSummary(selection(25, true))).toBe(canonicalLiteratureSummary(selection(75, true)));
    expect(canonicalLiteratureSummary(selection(25, true))).toBe(canonicalLiteratureSummary(selection(300, false)));
  });
  it("shows the model the same coverage the cache key is made from, so a cached summary cannot describe other coverage", () => {
    const sameKey = (a: LiteratureSummarySelection, b: LiteratureSummarySelection) => canonicalLiteratureSummary(a) === canonicalLiteratureSummary(b);
    const slow = selection(25, true);
    const fast = selection(75, false);
    expect(sameKey(slow, fast)).toBe(true);
    // Same key, therefore the same prompt: nothing that differs between them may reach the model.
    expect(literatureSummaryPrompt(slow)).toBe(literatureSummaryPrompt(fast));
    // What does separate keys still reaches the model.
    expect(literatureSummaryPrompt(selection(25, true, "error"))).not.toBe(literatureSummaryPrompt(slow));
  });

  it("uses a new selection version, so summaries written from the old prompt are not served", () => {
    expect(SUMMARY_SELECTION_VERSION).toBeGreaterThanOrEqual(3);
  });

  it("still changes when a search stopped early, because that is a different quality of input", () => {
    expect(canonicalLiteratureSummary(selection(25, true, "error"))).not.toBe(canonicalLiteratureSummary(selection(25, true)));
  });
});
