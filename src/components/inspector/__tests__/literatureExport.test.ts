import { describe, expect, it } from "vitest";
import { shortlistRecords, toBibtex, toRis, toCsv } from "../LiteratureInspector";
import type { Citation } from "../../LiteratureView";
import { buildLiteratureEvidence } from "../../../shared/literatureEvidence";

const citations: Citation[] = [
  {
    id: "42433374",
    title: "ATP & transport: {a} <study>",
    abstract: "An abstract about transport.",
    authors: "Wang W, Liu J",
    journal: "Nature, Genetics",
    year: 2024,
    url: "https://pubmed.ncbi.nlm.nih.gov/42433374/"
  },
  {
    id: "PPR998877",
    title: "=cmd|'/c calc'!A1",
    abstract: "A preprint abstract.",
    authors: "Smith J",
    journal: "Preprints",
    year: null,
    url: "https://europepmc.org/article/PPR/PPR998877"
  }
];

describe("citation export serializers (export exactly the on-screen list)", () => {
  it("exports the screening tier, source-backed tags, quote, and header block", () => {
    const evidence = buildLiteratureEvidence({
      gene: "NAE1", variant: "p.Asp116Gly", citations: [{ ...citations[0], abstract: "NAE1 p.Asp116Gly activity was reduced." }],
      response: null, executedQuery: "", narrowingFilter: "", groupFilter: "all", pinnedIds: new Set(),
      probe: { state: "idle", hitCount: null }, load: "ready", error: null,
    });
    const header = { query: "NAE1", lexiconVersion: 1, date: "2026-10-05" };
    expect(toBibtex(evidence.visible, header)).toContain("@comment{Query: NAE1; Lexicon version: 1; Date: 2026-10-05}");
    expect(toRis(evidence.visible, header)).toContain("N1  - tier 1; tags");
    const csv = toCsv(evidence.visible, "NAE1", "p.Asp116Gly", header);
    expect(csv).toContain("# Query,NAE1");
    expect(csv).toContain("Tier,Screening tags");
    expect(csv).toContain("functional-assay [sentence-anchor]");
  });

  it("builds the shortlist export from Read first and Read next even when the table is filtered", () => {
    const evidence = buildLiteratureEvidence({
      gene: "NAE1", variant: "p.Asp116Gly", citations: [
        { ...citations[0], abstract: "NAE1 p.Asp116Gly activity was reduced." },
        { ...citations[1], title: "NAE1 mechanism", abstract: "NAE1 loss-of-function mechanism." },
        { ...citations[1], id: "PMC999", title: "Fish", abstract: "Aquaculture genetics." },
      ], response: null, executedQuery: "", narrowingFilter: "", groupFilter: "all", pinnedIds: new Set(),
      probe: { state: "idle", hitCount: null }, load: "ready", error: null,
    });
    expect(shortlistRecords(evidence.papers).map(paper => paper.citation.id)).toEqual(["42433374", "PPR998877"]);
  });
  it("exports curated record relationships as provenance, separate from quote-backed tags", () => {
    const withLink: Citation = {
      ...citations[0],
      curatedLinks: [{
        provider: "uniprot",
        featureId: "VAR_088123",
        accession: "Q13564",
        variant: "D116G",
        variantDescription: "in NEDFIH",
        evidenceCode: "ECO:0000269",
        pmid: "42433374",
        source: "PubMed",
        sourceUrl: "https://www.uniprot.org/uniprotkb/Q13564/variant/VAR_088123",
        retrievedAt: "2026-10-05T00:00:00.000Z",
      }],
    };
    const csv = toCsv([withLink], "NAE1", "p.Asp116Gly");
    expect(csv).toContain("Curated links");
    expect(csv).toContain("Cited by UniProt variant record [PMID 42433374 VAR_088123]");
    expect(csv).toContain("https://www.uniprot.org/uniprotkb/Q13564/variant/VAR_088123");
    expect(toBibtex([withLink])).toContain("curated: Cited by UniProt variant record");
    expect(toRis([withLink])).toContain("curated: Cited by UniProt variant record");
  });

  describe("toBibtex", () => {
    const out = toBibtex(citations);

    it("emits one @article per citation with a stable, unique key", () => {
      expect(out).toContain("@article{pmid42433374,");
      expect(out).toContain("@article{PPR998877,");
      expect((out.match(/@article\{/g) ?? []).length).toBe(2);
    });

    it("converts authors to surname-first form joined by 'and'", () => {
      expect(out).toContain("author  = {Wang, W and Liu, J}");
      expect(out).toContain("author  = {Smith, J}");
    });

    it("escapes BibTeX special characters in free-text fields", () => {
      expect(out).toContain("title   = {ATP \\& transport: \\{a\\} <study>}");
    });

    it("escapes the full TeX special set, including author names and URLs", () => {
      const tricky = toBibtex([
        {
          id: "7",
          title: "A 50% rise in X_Y & Z #2 $daily$ ~60 ^2",
          abstract: "",
          authors: "van der Burg A, The GTEx Consortium, Smith J Jr.",
          journal: "J_Test",
          year: 2023,
          url: "https://example.org/a_b?c=d&e=f"
        } as Citation
      ]);
      // Particle surnames keep every word before the surname comma; consortium names
      // (no trailing initials to anchor on) are left intact rather than cut mid-name;
      // suffixes ride with the given name.
      expect(tricky).toContain("author  = {van der Burg, A and The GTEx Consortium and Smith, J Jr.}");
      // #$ _ get a backslash; ~ and ^ need their text-macro forms (a bare backslash
      // would be a TeX accent macro missing its argument).
      expect(tricky).toContain("title   = {A 50\\% rise in X\\_Y \\& Z \\#2 \\$daily\\$ \\textasciitilde{}60 \\textasciicircum{}2}");
      expect(tricky).toContain("journal = {J\\_Test}");
      expect(tricky).toContain("url     = {https://example.org/a\\_b?c=d\\&e=f}");
    });

    it("de-duplicates export keys that differ only in stripped punctuation", () => {
      const dupes = toBibtex([
        { id: "PPR-1", title: "A", abstract: "", authors: "X", journal: "J", year: null, url: null },
        { id: "PPR:1", title: "B", abstract: "", authors: "X", journal: "J", year: null, url: null }
      ] as Citation[]);
      expect(dupes).toContain("@article{PPR1,");
      expect(dupes).toContain("@article{PPR12,");
    });

    it("emits year only for records that have one", () => {
      expect(out).toContain("year    = {2024}");
      const pprEntry = out.split("@article{")[2];
      expect(pprEntry).not.toContain("year    =");
    });

    it("labels the identifier correctly for PMID and non-PMID records", () => {
      expect(out).toContain("note    = {PMID: 42433374}");
      expect(out).toContain("note    = {ID: PPR998877}");
    });
  });

  describe("toRis", () => {
    const out = toRis(citations);

    it("emits one TY…ER record per citation", () => {
      expect(out.startsWith("TY  - JOUR\n")).toBe(true);
      expect((out.match(/ER  - /g) ?? []).length).toBe(2);
      expect((out.match(/TY  - JOUR/g) ?? []).length).toBe(2);
    });

    it("carries one AU line per author plus journal, year, URL, and accession", () => {
      expect(out).toContain("AU  - Wang, W");
      expect(out).toContain("AU  - Liu, J");
      expect(out).toContain("JO  - Nature, Genetics");
      expect(out).toContain("PY  - 2024");
      expect(out).toContain("UR  - https://pubmed.ncbi.nlm.nih.gov/42433374/");
      expect(out).toContain("AN  - PPR998877");
      expect((out.match(/PY  - /g) ?? []).length).toBe(1); // null year omitted, not blank
    });

    it("folds newlines into spaces and carries the abstract on AB", () => {
      const folded = toRis([
        {
          id: "5",
          title: "Line one\nline two",
          abstract: "First line.\r\nSecond line.",
          authors: "Jones A",
          journal: "J",
          year: 2021,
          url: null
        } as Citation
      ]);
      expect(folded).toContain("TI  - Line one line two");
      expect(folded).toContain("AB  - First line. Second line.");
      // No raw newline survives inside a value line (blank record separators aside).
      for (const line of folded.split("\n")) {
        if (!line.trim()) continue;
        expect(line).toMatch(/^(TY|TI|AU|JO|AB|PY|UR|AN|ER)  -/);
      }
    });
  });

  describe("toCsv", () => {
    it("emits the documented header and CRLF row endings", () => {
      const out = toCsv(citations, "GENE1", "p.X1Y2");
      const lines = out.split("\r\n");
      expect(lines[0]).toBe("Gene,Variant,ID,Title,Authors,Journal,Year,URL,Tier,Screening tags,Curated links");
      expect(out.endsWith("\r\n")).toBe(true);
      expect(lines[1]).toContain("GENE1,p.X1Y2,42433374,");
      expect(lines[1]).toContain('"Wang W, Liu J"');
      expect(lines[1]).toContain('"Nature, Genetics"');
      expect(lines[2]).toContain(",Preprints,,"); // null year → empty cell
    });

    it("neutralizes spreadsheet formula injection (RFC 4180 + apostrophe guard)", () => {
      const out = toCsv(citations, "GENE1", "p.X1Y2");
      const lines = out.split("\r\n");
      // A cell starting with = would be *executed* by Excel/Sheets — the apostrophe
      // prefix keeps it inert text.
      expect(lines[2]).toContain("'=cmd|'/c calc'!A1");
      // The old `(^|,)=` assertion only caught row 1 — a raw `=` at the start of a
      // later row (after \r\n) sailed through. Anchor on any cell boundary instead.
      expect(out).not.toMatch(/[,\r\n]=/); // no cell ever begins with a raw =

      const tricky = toCsv(
        [{ id: "9", title: "-draft", authors: "@lab", journal: "Notes", year: 2020, url: null } as Citation],
        "G",
        "V"
      );
      expect(tricky).toContain(",'-draft,");
      expect(tricky).toContain(",'@lab,");
      expect(tricky).toMatch(/,2020,/);
    });

    it("doubles embedded quotes per RFC 4180", () => {
      const out = toCsv(
        [{ id: "1", title: 'He said "hello"', authors: "A B", journal: "J", year: 2020, url: null } as Citation],
        "G",
        "V"
      );
      expect(out).toContain('"He said ""hello"""');
    });
  });
});
