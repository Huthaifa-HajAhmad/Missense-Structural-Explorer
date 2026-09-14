import { describe, it, expect, vi } from "vitest";
import { safeParseFloat, safeParseInt, toSingleAa, getFirstOrVal } from "./normalizer.ts";
import { resolveGpnStarScore } from "./conservation-orchestrator.ts";
import { UNIPROT_ACCESSION_REGEX, getTranscriptsForProtein, transcriptMappingCache } from "./transcript-resolver.ts";

describe("Predictors Sub-Resolvers Unit Tests", () => {
  describe("normalizer", () => {
    it("safely parses float values and handles sentinel strings", () => {
      expect(safeParseFloat("0.85")).toBe(0.85);
      expect(safeParseFloat(0.42)).toBe(0.42);
      expect(safeParseFloat(".")).toBeNull();
      expect(safeParseFloat("")).toBeNull();
      expect(safeParseFloat(null)).toBeNull();
      expect(safeParseFloat(undefined)).toBeNull();
      expect(safeParseFloat("invalid")).toBeNull();
    });

    it("safely parses int values", () => {
      expect(safeParseInt("42")).toBe(42);
      expect(safeParseInt(100)).toBe(100);
      expect(safeParseInt(".")).toBeNull();
      expect(safeParseInt(null)).toBeNull();
      expect(safeParseInt("foo")).toBeNull();
    });

    it("converts 3-letter amino acids to 1-letter codes", () => {
      expect(toSingleAa("Ala")).toBe("A");
      expect(toSingleAa("Arg")).toBe("R");
      expect(toSingleAa("val")).toBe("V");
      expect(toSingleAa("W")).toBe("W");
      expect(toSingleAa("")).toBe("");
    });

    it("extracts the first value from arrays or semicolon-delimited strings", () => {
      expect(getFirstOrVal(["first", "second"])).toBe("first");
      expect(getFirstOrVal("0.85;0.92")).toBe("0.85");
      expect(getFirstOrVal(123)).toBe(123);
    });
  });

  describe("UniProt Accession vs Gene Symbol disambiguation", () => {
    it("correctly identifies valid UniProt accessions", () => {
      expect(UNIPROT_ACCESSION_REGEX.test("P00439")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("Q9BYF1")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("O15552")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("A0A024RBG1")).toBe(true);
      expect(UNIPROT_ACCESSION_REGEX.test("p04637")).toBe(true); // case-insensitive
    });

    it("rejects 6-10 character standard gene symbols to prevent UniProt 404s", () => {
      // Common human genes with 6-10 characters that must NEVER match UniProt regex
      const geneSymbols = ["CDKN2A", "PIK3CA", "COL1A1", "CYP2D6", "MAPK14", "SMARCA4", "TMPRSS2", "BRCA1", "TP53", "EGFR"];
      for (const gene of geneSymbols) {
        expect(UNIPROT_ACCESSION_REGEX.test(gene)).toBe(false);
      }
    });

    it("routes gene symbols to search endpoint and accessions to uniprotkb endpoint", async () => {
      transcriptMappingCache.clear();
      const origFetch = global.fetch;
      const requestedUrls: string[] = [];

      global.fetch = vi.fn().mockImplementation(async (url: string | URL | Request) => {
        const urlStr = String(url);
        requestedUrls.push(urlStr);
        return new Response(JSON.stringify({
          results: [{
            uniProtKBCrossReferences: [
              { database: "MANE-Select", id: "ENST00000304494", properties: [{ key: "RefSeqNucleotideId", value: "NM_000077.5" }] }
            ]
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      try {
        const mapping = await getTranscriptsForProtein("CDKN2A");
        expect(mapping.isManeSelect).toBe(true);
        expect(mapping.ensemblId).toBe("ENST00000304494");
        expect(requestedUrls[0]).toContain("https://rest.uniprot.org/uniprotkb/search?query=gene_exact:CDKN2A");
        expect(requestedUrls[0]).not.toContain("/uniprotkb/CDKN2A.json");
      } finally {
        global.fetch = origFetch;
      }
    });
  });

  describe("gpn-star score resolver", () => {
    it("extracts score from varied field conventions", () => {
      expect(resolveGpnStarScore({ gpn_star: "-1.25" })).toBe(-1.25);
      expect(resolveGpnStarScore({ gpn: -0.8 })).toBe(-0.8);
      expect(resolveGpnStarScore({ gpn_msa: ["-2.1"] })).toBe(-2.1);
      expect(resolveGpnStarScore({ gpnStar: -0.5 })).toBe(-0.5);
      expect(resolveGpnStarScore({})).toBeNull();
    });
  });
});
