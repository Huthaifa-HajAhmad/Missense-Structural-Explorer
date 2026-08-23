import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { 
  cosineSimilarity, 
  getEmbedding, 
  syncLiteratureForGene, 
  retrieveRelevantLiterature, 
  getGeneCitations,
  formatQueryForEuropePmc,
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
  const dbPath = path.join(process.cwd(), "data", "shared_state.sqlite");
  
  beforeEach(() => {
    resetDbForTesting();
    // Delete database to start clean
    try {
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { force: true });
      }
    } catch (_) {}
  });

  afterEach(() => {
    resetDbForTesting();
    // Clean up database
    try {
      if (fs.existsSync(dbPath)) {
        fs.rmSync(dbPath, { force: true });
      }
    } catch (_) {}
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

      // Restore fetch
      global.fetch = originalFetch;
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
});
