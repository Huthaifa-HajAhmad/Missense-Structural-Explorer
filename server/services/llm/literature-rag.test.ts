import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { 
  cosineSimilarity, 
  getEmbedding, 
  syncLiteratureForGene, 
  retrieveRelevantLiterature, 
  getGeneCitations,
  formatQueryForEuropePmc,
  cleanLiteratureText,
  literatureCacheKey,
  isLiteratureCacheStale,
  getLiteratureHitCount,
  recordLiteratureSync,
  buildPaperUrl,
  searchGeneLiterature,
  migrateLiteratureSchema,
  resetDbForTesting
} from "./literature-rag.ts";

// Mock the Gemini client to avoid external API calls during testing
vi.mock("./gemini.ts", () => {
  return {
    getGeminiClient: () => {
      return {
        models: {
          embedContent: async ({ contents }: { contents: string }) => {
            // Generate deterministic mock vectors based on keyword contents
            const isPathogenic = contents.toLowerCase().includes("pathogenic");
            const isPAH = contents.toLowerCase().includes("pah");
            
            // Construct mock 1024-dimensional vectors
            const values = new Array(1024).fill(0.1);
            if (isPathogenic) values[0] = 0.9;
            if (isPAH) values[1] = 0.8;
            
            return {
              embeddings: [{
                values
              }]
            };
          }
        }
      };
    }
  };
});

describe("Literature RAG and Vector Search Service Unit Tests", () => {
  beforeEach(() => {
    resetDbForTesting();
    // NOTE: this suite used to `fs.rmSync` the shared database here and in afterEach, which
    // deleted the developer's real `data/shared_state.sqlite`. The module already uses an
    // in-memory database under NODE_ENV=test (literature-rag.ts:11), so resetting the
    // singleton alone gives a clean store and the file deletions were pure data loss.
  });

  afterEach(() => {
    resetDbForTesting();
  });

  describe("cosineSimilarity", () => {
    it("should return 1 for identical vectors", () => {
      const a = new Float32Array([1.0, 2.0, 3.0]);
      const b = new Float32Array([1.0, 2.0, 3.0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 4);
    });

    it("should return 0 for perpendicular vectors", () => {
      const a = new Float32Array([1.0, 0.0]);
      const b = new Float32Array([0.0, 1.0]);
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it("should compute correct cosine similarity values", () => {
      const a = new Float32Array([3.0, 4.0]);
      const b = new Float32Array([4.0, 3.0]);
      // Dot product = 24. NormA = 5. NormB = 5. Similarity = 24/25 = 0.96
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.96, 4);
    });
  });

  describe("getEmbedding", () => {
    it("should parse the current @google/genai embeddings array response", async () => {
      const embedding = await getEmbedding("test PAH mutation text");
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding).toHaveLength(1024);
      expect(embedding[1]).toBeCloseTo(0.8, 4); // PAH flag should be active
    });

    it("should preserve compatibility with the legacy singular embedding response", async () => {
      const geminiModule = await import("./gemini.ts");
      const legacyClient = vi.spyOn(geminiModule, "getGeminiClient").mockReturnValue({
        models: {
          embedContent: vi.fn().mockResolvedValue({ embedding: { values: [1, 0, 0] } })
        }
      } as any);

      try {
        const embedding = await getEmbedding("legacy response");
        expect(Array.from(embedding)).toEqual([1, 0, 0]);
      } finally {
        legacyClient.mockRestore();
      }
    });
  });

  describe("syncLiteratureForGene and retrieval", () => {
    it("should query mock API, insert abstracts, and fetch them", async () => {
      // Mock global fetch for Europe PMC REST API
      const mockEuropePmcResult = {
        resultList: {
          result: [
            {
              pmid: "123456",
              title: "Pathogenic PAH mutation characterization",
              abstractText: "We found that PAH mutation p.Arg408His causes folding disruption.",
              authorString: "Smith J, Doe J",
              journalTitle: "J Biol Chem",
              pubYear: "2023"
            },
            {
              pmid: "789012",
              title: "Functional study of mutations",
              abstractText: "This functional study analyzes benign protein variants.",
              authorString: "Johnson A",
              journalTitle: "Nature Gen",
              pubYear: "2024"
            }
          ]
        }
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockEuropePmcResult)
        } as Response);
      });

      try {
        // 1. Sync
        const count = await syncLiteratureForGene("PAH");
        expect(count).toBe(2);

        // 2. Fetch citations for list view
        const citationsList = await getGeneCitations("PAH");
        expect(citationsList).toHaveLength(2);
        expect(citationsList[0].id).toBe("789012"); // Ordered by year descending

        // 3. Perform RAG query
        // Query contains "pathogenic", so Smith J's paper (which contains "Pathogenic") should score higher.
        const rankedCitations = await retrieveRelevantLiterature("PAH", "pathogenic PAH");
        expect(rankedCitations).toHaveLength(2);
        expect(rankedCitations[0].id).toBe("123456"); // First because similarity is higher
        expect(rankedCitations[0].similarity).toBeGreaterThan(rankedCitations[1].similarity);
      } finally {
        // Restore fetch even on assertion failure, or every later suite runs mocked.
        global.fetch = originalFetch;
      }
    });

    it("should format PubMed/MeSH syntax into clean Europe PMC queries", () => {
      const defaultQ = formatQueryForEuropePmc(undefined, "CNNM2");
      expect(defaultQ).toContain("CNNM2");
      expect(defaultQ).toContain("mutation");

      const pubmedQ = '(CNNM2[Gene]) AND ("missense"[All Fields] OR "mutation"[All Fields] OR p.ser489cys)';
      const formatted = formatQueryForEuropePmc(pubmedQ, "CNNM2");
      expect(formatted).not.toContain("[Gene]");
      expect(formatted).not.toContain("[All Fields]");
      expect(formatted).toContain("CNNM2");
      expect(formatted).toContain("p.ser489cys");
    });
  });

  describe("cleanLiteratureText", () => {
    it("strips raw inline tags, keeping the text between them", () => {
      expect(cleanLiteratureText("Role of <i>Abca1</i> in lipid transport")).toBe(
        "Role of Abca1 in lipid transport"
      );
    });

    it("decodes entity-encoded tags first, then strips them (the &lt;i&gt; screenshot bug)", () => {
      expect(
        cleanLiteratureText(
          "Biomarkers in liver fibrosis: transcriptomic analysis and &lt;i&gt;In Vivo&lt;/i&gt; validation."
        )
      ).toBe("Biomarkers in liver fibrosis: transcriptomic analysis and In Vivo validation.");
    });

    it("decodes &amp; only after tag stripping", () => {
      expect(cleanLiteratureText("ATP &amp; energy via &lt;b&gt;flux&lt;/b&gt;")).toBe(
        "ATP & energy via flux"
      );
    });

    it("turns headings into paragraph breaks without gluing the following text", () => {
      expect(cleanLiteratureText("<h4>Background</h4>We screened patients.")).toBe(
        "Background\n\nWe screened patients."
      );
    });

    it("returns an empty string for empty input", () => {
      expect(cleanLiteratureText("")).toBe("");
    });
  });

  describe("literatureCacheKey, staleness, and hit counts", () => {
    it("normalizes the gene and scopes keys per query", () => {
      expect(literatureCacheKey(" acot9 ")).toBe("ACOT9");
      expect(literatureCacheKey("ACOT9", "   ")).toBe("ACOT9");
      expect(literatureCacheKey("ACOT9", "p.Lys272Asn")).toBe("ACOT9::p.Lys272Asn");
    });

    it("treats a never-synced set as stale and a recorded sync as fresh", () => {
      const key = literatureCacheKey("GENEX", "custom query");
      expect(isLiteratureCacheStale(key)).toBe(true);
      recordLiteratureSync(key, "GENEX AND custom query", 1204);
      expect(isLiteratureCacheStale(key)).toBe(false);
      expect(getLiteratureHitCount(key)).toBe(1204);
    });
  });

  describe("buildPaperUrl", () => {
    it("routes each identifier source to its canonical page", () => {
      expect(buildPaperUrl("42433374", { source: "MED" })).toBe(
        "https://pubmed.ncbi.nlm.nih.gov/42433374/"
      );
      expect(buildPaperUrl("PPR998877", { source: "PPR" })).toBe(
        "https://europepmc.org/article/PPR/PPR998877"
      );
      expect(buildPaperUrl("PMC1234567", { source: "PMC" })).toBe(
        "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/"
      );
      expect(buildPaperUrl("weird-id", {})).toContain("europepmc.org/search?query=weird-id");
    });
  });

  describe("searchGeneLiterature caching", () => {
    const emptyPage = { resultList: { result: [] }, hitCount: 0 };

    it("serves a fresh cached search without re-querying, and force bypasses it", async () => {
      const originalFetch = global.fetch;
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve(emptyPage) } as Response);
      global.fetch = fetchMock;
      try {
        // First run: the set was never fetched, so this goes upstream.
        await searchGeneLiterature("TP53", undefined, undefined, "tp53 AND custom");
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Second run: the entry is fresh, so it is served from cache.
        await searchGeneLiterature("TP53", undefined, undefined, "tp53 AND custom");
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // force=true (the Sync button) bypasses the fresh cache and re-queries.
        await searchGeneLiterature("TP53", undefined, undefined, "tp53 AND custom", true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("reports degraded=true when the upstream call fails, instead of a silent fallback", async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as any;
      try {
        const result = await searchGeneLiterature("TP53", undefined, undefined, "tp53 AND custom", true);
        expect(result.degraded).toBe(true);
        expect(Array.isArray(result.citations)).toBe(true);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe("formatQueryForEuropePmc gene scoping (word boundary)", () => {
    it("leaves a query that mentions the gene as a whole word unscoped", () => {
      expect(formatQueryForEuropePmc("efface the marks with ACE inhibitors", "ACE")).toBe(
        "efface the marks with ACE inhibitors"
      );
      expect(formatQueryForEuropePmc("HLA-B expression in patients", "HLA-B")).toBe(
        "HLA-B expression in patients"
      );
    });

    it("still scopes when the gene appears only inside another token", () => {
      expect(formatQueryForEuropePmc("the FACEBOOK story", "ACE")).toBe("(the FACEBOOK story) AND ACE");
      // `HLA-B27` contains `HLA-B` as a substring but is not a mention of the gene —
      // the old substring check returned this unscoped.
      expect(formatQueryForEuropePmc("HLA-B27 and arthritis", "HLA-B")).toBe(
        "(HLA-B27 and arthritis) AND HLA-B"
      );
    });
  });

  describe("migrateLiteratureSchema re-open idempotence", () => {
    // Regression guard for the startup backfill: it must attribute only membership-less
    // legacy rows to the default key, and stay a no-op on repeat opens — a custom-query
    // paper must never gain default-key membership, no matter how many restarts happen.
    it("attributes only membership-less rows, and is stable across re-opens", async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(":memory:");
      try {
        // Legacy shape: no `has_embedding` / `url` columns, no syncs table.
        db.exec(`
          CREATE TABLE literature_abstracts (
            id TEXT PRIMARY KEY,
            gene TEXT NOT NULL,
            title TEXT NOT NULL,
            abstract TEXT NOT NULL,
            authors TEXT,
            journal TEXT,
            year INTEGER,
            embedding BLOB NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE TABLE literature_query_members (
            cache_key TEXT NOT NULL,
            paper_id TEXT NOT NULL,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (cache_key, paper_id)
          );
        `);
        const insertPaper = db.prepare(
          "INSERT INTO literature_abstracts (id, gene, title, abstract, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        );
        const zero = Buffer.alloc(768 * 4);
        insertPaper.run("111", "TP53", "Legacy paper", "Abstract", zero, 1);
        insertPaper.run("222", "TP53", "Custom-only paper", "Abstract", zero, 2);
        db.prepare(
          "INSERT INTO literature_query_members (cache_key, paper_id, added_at) VALUES (?, ?, ?)"
        ).run("TP53::tp53 AND custom", "222", 3);

        const members = () =>
          (db.prepare("SELECT cache_key, paper_id FROM literature_query_members").all() as Array<{ cache_key: string; paper_id: string }>);

        migrateLiteratureSchema(db);
        expect(members()).toContainEqual({ cache_key: "TP53", paper_id: "111" });
        expect(members().filter((m) => m.paper_id === "222")).toEqual([
          { cache_key: "TP53::tp53 AND custom", paper_id: "222" }
        ]);

        // A second open (restart) must change nothing.
        migrateLiteratureSchema(db);
        expect(members()).toHaveLength(2);
      } finally {
        db.close();
      }
    });
  });

  describe("searchGeneLiterature live ordering", () => {
    it("returns live results in cache order (year DESC), not upstream page order", async () => {
      const originalFetch = global.fetch;
      const page = {
        resultList: {
          result: [
            {
              pmid: "100",
              title: "Older study",
              abstractText: "Abstract one.",
              authorString: "Smith J",
              journalTitle: "J One",
              pubYear: "2020"
            },
            {
              pmid: "200",
              title: "Newer study",
              abstractText: "Abstract two.",
              authorString: "Jones A",
              journalTitle: "J Two",
              pubYear: "2024"
            }
          ]
        },
        hitCount: 2
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: true, json: () => Promise.resolve(page) } as Response);
      global.fetch = fetchMock;
      try {
        // Upstream page order is 2020-then-2024; the live read must come back in the
        // same year-DESC order the cached SELECT (and every later render) uses.
        const result = await searchGeneLiterature("TP53", undefined, undefined, "tp53 AND ordering", true);
        expect(result.degraded).toBe(false);
        expect(result.citations.map((c) => c.id)).toEqual(["200", "100"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Second run is served from the fresh cache with identical ordering and no fetch.
        const cached = await searchGeneLiterature("TP53", undefined, undefined, "tp53 AND ordering");
        expect(cached.degraded).toBe(false);
        expect(cached.citations.map((c) => c.id)).toEqual(["200", "100"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
