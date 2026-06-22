import { describe, it, expect, vi } from "vitest";
import { 
  validateGene, 
  validateVariant, 
  validateUniProt, 
  sendError,
  GENE_PATTERN, 
  HGVS_PATTERN, 
  UNIPROT_PATTERN,
  MUTATION_FOLDX_PATTERN,
  VCF_GENOMIC_PATTERN,
  CDNA_PATTERN
} from "./server/utils.ts";
import {
  pdbCache,
  uniprotCache,
  fetchClinVarData
} from "./server/services/external.ts";

describe("Input Validation Patterns & Functions", () => {
  describe("validateGene", () => {
    it("should accept valid human gene symbols", () => {
      expect(validateGene("PAH")).toBe("PAH");
      expect(validateGene("FGFR3")).toBe("FGFR3");
      expect(validateGene("GBA1")).toBe("GBA1");
      expect(validateGene("NAE1")).toBe("NAE1");
      expect(validateGene("LPCAT3")).toBe("LPCAT3");
      expect(validateGene("BRAF")).toBe("BRAF");
      expect(validateGene("mlh1")).toBe("MLH1");
      expect(validateGene("SCN1A")).toBe("SCN1A");
      expect(validateGene("CFTR")).toBe("CFTR");
    });

    it("should reject invalid gene symbols", () => {
      expect(() => validateGene("")).toThrow("Gene symbol must be a non-empty string.");
      expect(() => validateGene(123)).toThrow("Gene symbol must be a non-empty string.");
      expect(() => validateGene("PAH_1")).toThrow("Invalid gene symbol format");
      expect(() => validateGene("A*B")).toThrow("Invalid gene symbol format");
      expect(() => validateGene("VERYLONGGENESYMBOLTHATEXCEEDSTWENTYCHARACTERS")).toThrow("Invalid gene symbol format");
    });
  });

  describe("validateVariant", () => {
    it("should accept valid HGVS protein variants (with or without p. prefix)", () => {
      expect(validateVariant("p.Arg408Trp")).toBe("p.Arg408Trp");
      expect(validateVariant("Arg408Trp")).toBe("Arg408Trp");
      expect(validateVariant("p.Gly380Arg")).toBe("p.Gly380Arg");
      expect(validateVariant("Gly380Arg")).toBe("Gly380Arg");
      expect(validateVariant("p.Leu483Pro")).toBe("p.Leu483Pro");
      expect(validateVariant("Leu483Pro")).toBe("Leu483Pro");
    });

    it("should reject invalid variants", () => {
      expect(() => validateVariant("")).toThrow("Variant must be a non-empty string.");
      expect(() => validateVariant(null)).toThrow("Variant must be a non-empty string.");
      expect(() => validateVariant("p.123")).toThrow("Invalid variant format");
      expect(() => validateVariant("Arg215")).toThrow("Invalid variant format");
      expect(() => validateVariant("p.ArgTrp")).toThrow("Invalid variant format");
    });
  });

  describe("validateUniProt", () => {
    it("should accept valid UniProt accessions", () => {
      expect(validateUniProt("P00439")).toBe("P00439");
      expect(validateUniProt("Q13564")).toBe("Q13564");
      expect(validateUniProt("P22607")).toBe("P22607");
      expect(validateUniProt("p04062")).toBe("P04062");
    });

    it("should reject invalid UniProt accessions", () => {
      expect(() => validateUniProt("")).toThrow("UniProt accession ID must be a non-empty string.");
      expect(() => validateUniProt(undefined)).toThrow("UniProt accession ID must be a non-empty string.");
      expect(() => validateUniProt("P0")).toThrow("Invalid UniProt accession ID format");
      expect(() => validateUniProt("P04637123456")).toThrow("Invalid UniProt accession ID format");
      expect(() => validateUniProt("P-04637")).toThrow("Invalid UniProt accession ID format");
    });
  });

  describe("FoldX Mutation Pattern", () => {
    it("should match valid FoldX formats", () => {
      expect(MUTATION_FOLDX_PATTERN.test("RA408W")).toBe(true);
      expect(MUTATION_FOLDX_PATTERN.test("GG380R")).toBe(true);
      expect(MUTATION_FOLDX_PATTERN.test("GL483P")).toBe(true);
    });

    it("should reject invalid FoldX formats", () => {
      expect(MUTATION_FOLDX_PATTERN.test("p.Arg215Trp")).toBe(false);
      expect(MUTATION_FOLDX_PATTERN.test("R215W")).toBe(false);
      expect(MUTATION_FOLDX_PATTERN.test("RA215")).toBe(false);
    });
  });

  describe("VCF and cDNA Patterns", () => {
    it("should match valid VCF genomic coordinates", () => {
      expect(VCF_GENOMIC_PATTERN.test("chr7:g.140753336A>T")).toBe(true);
      expect(VCF_GENOMIC_PATTERN.test("7:g.140753336A>T")).toBe(true);
      expect(VCF_GENOMIC_PATTERN.test("chrX:g.12345C>G")).toBe(true);
    });

    it("should reject invalid VCF genomic coordinates", () => {
      expect(VCF_GENOMIC_PATTERN.test("chr7:140753336A>T")).toBe(false);
      expect(VCF_GENOMIC_PATTERN.test("g.140753336A>T")).toBe(false);
      expect(VCF_GENOMIC_PATTERN.test("chr7:g.140753336")).toBe(false);
    });

    it("should match valid cDNA notations", () => {
      expect(CDNA_PATTERN.test("NM_004333.6:c.1799T>A")).toBe(true);
      expect(CDNA_PATTERN.test("c.1799T>A")).toBe(true);
      expect(CDNA_PATTERN.test("ENST00000288602.11:c.1799T>A")).toBe(true);
    });

    it("should reject invalid cDNA notations", () => {
      expect(CDNA_PATTERN.test("NM_004333.6:1799T>A")).toBe(false);
      expect(CDNA_PATTERN.test("c.1799")).toBe(false);
    });
  });

  describe("sendError helper", () => {
    it("should serialize error payload in a standardized envelope", () => {
      let statusVal = 0;
      let jsonVal: any = null;
      const mockRes: any = {
        status(code: number) {
          statusVal = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };

      sendError(mockRes, 400, "BAD_REQUEST", "Invalid input param", { extra: 123 });
      expect(statusVal).toBe(400);
      expect(jsonVal).toEqual({
        error: {
          code: "BAD_REQUEST",
          message: "Invalid input param",
          details: { extra: 123 }
        }
      });
    });
  });

  describe("LRU Cache", () => {
    it("should allow setting and getting cached PDB structures", () => {
      pdbCache.set("P00439", "MOCK_PDB_CONTENT");
      expect(pdbCache.get("P00439")).toBe("MOCK_PDB_CONTENT");
      expect(pdbCache.has("P00439")).toBe(true);
      pdbCache.delete("P00439");
      expect(pdbCache.get("P00439")).toBeUndefined();
    });

    it("should allow setting and getting cached UniProt mappings", () => {
      uniprotCache.set("PAH", "P00439");
      expect(uniprotCache.get("PAH")).toBe("P00439");
      uniprotCache.delete("PAH");
      expect(uniprotCache.get("PAH")).toBeUndefined();
    });
  });

  describe("fetchClinVarData", () => {
    it("should return parsed results if variant title matches (exact or mapped AA codes)", async () => {
      const mockSearchResponse = {
        esearchresult: {
          idlist: ["12345"]
        }
      };

      const mockSummaryResponse = {
        result: {
          "12345": {
            title: "NM_000277.3(PAH):c.1224C>T (p.Arg408Trp)",
            germline_classification: {
              description: "Pathogenic",
              last_evaluated: "2023-01-01",
              review_status: "practice guideline",
              trait_set: [{ trait_name: "Phenylketonuria" }]
            },
            allele_freq_set: [
              { source: "gnomAD", value: "0.0005" }
            ]
          }
        }
      };

      const fetchSpy = vi.spyOn(global, "fetch");
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResponse
      } as any);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummaryResponse
      } as any);

      const res = await fetchClinVarData("PAH", "p.Arg408Trp");
      expect(res.classification).toBe("Pathogenic");
      expect(res.trait).toBe("Phenylketonuria");
      expect(res.uid).toBe("12345");
      expect(res.alleleFrequencies[0].value).toBe("0.0005");

      fetchSpy.mockRestore();
    });

    it("should not match and return default response if title doesn't match clean variant", async () => {
      const mockSearchResponse = {
        esearchresult: {
          idlist: ["67890"]
        }
      };

      const mockSummaryResponse = {
        result: {
          "67890": {
            title: "NM_000277.3(PAH):c.1000G>A (p.Ala123Val)",
            germline_classification: {
              description: "Benign"
            }
          }
        }
      };

      const fetchSpy = vi.spyOn(global, "fetch");
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResponse
      } as any);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSummaryResponse
      } as any);

      const res = await fetchClinVarData("PAH", "p.Arg408Trp");
      expect(res.classification).toBe("Not found in ClinVar");
      expect(res.uid).toBeNull();

      fetchSpy.mockRestore();
    });
  });
});
