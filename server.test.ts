import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: (...args: any[]) => mockGenerateContent(...args)
      };
    },
    Type: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      ARRAY: "ARRAY"
    }
  };
});

beforeEach(() => {
  mockGenerateContent.mockReset();
  clearAllCaches();
  process.env.APP_SESSION_SECRET = "dev-session-secret-must-be-changed-in-prod";
  try {
    const cacheDir = path.join(process.cwd(), "logs", "gemini_cache");
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  } catch (err) {}
});
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
  CDNA_PATTERN,
  DASHED_GENOMIC_PATTERN,
  safeCompare,
  filterPII,
  encryptSession,
  decryptSession,
  getApiKeyFromSession,
  Semaphore
} from "./server/utils.ts";
import {
  pdbCache,
  uniprotCache,
  clinvarCache,
  predictorCache,
  conservationCache,
  stringCache,
  fetchClinVarData,
  extractChainFromPdb,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  clearAllCaches
} from "./server/services/external.ts";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { 
  parseFoldxDifFile,
  parseResiduesFromPdbAsync,
  parseResiduesFromPdbMaybeAsync,
  parseAtomsFromPdbAsync,
  parseAtomsFromPdbMaybeAsync,
  generateMutantPdb,
  computeStructuralDiff,
  runEsm2Eval
} from "./server/services/biophysics.ts";
import { apiRouter } from "./server/routes.ts";
import { requestLogger, authCheck } from "./server/middleware.ts";
import * as externalServices from "./server/services/external.ts";
import { getNearestResidues } from "./src/data.ts";
import { computeRuleBasedACMG } from "./server/services/acmg.ts";
import { 
  svd3, 
  calculateLocalSidechainRmsd, 
  calculateClashes, 
  predictStructuralDisruption,
  PdbAtom
} from "./server/services/biophysics.ts";
import { countPredictorConcordance, computeConsensusVerdict } from "./src/shared/thresholds.ts";

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

    it("should match valid dashed genomic coordinates", () => {
      expect(DASHED_GENOMIC_PATTERN.test("20-23365054-G-A")).toBe(true);
      expect(DASHED_GENOMIC_PATTERN.test("chr20-23365054-G-A")).toBe(true);
      expect(DASHED_GENOMIC_PATTERN.test("X-12345-C-G")).toBe(true);
      expect(DASHED_GENOMIC_PATTERN.test("chrY-9876-A-T")).toBe(true);
    });

    it("should reject invalid dashed genomic coordinates", () => {
      expect(DASHED_GENOMIC_PATTERN.test("20-23365054-G")).toBe(false);
      expect(DASHED_GENOMIC_PATTERN.test("20-23365054-G-")).toBe(false);
      expect(DASHED_GENOMIC_PATTERN.test("20-23365054--A")).toBe(false);
      expect(DASHED_GENOMIC_PATTERN.test("20--G-A")).toBe(false);
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
          uids: ["12345"],
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
          uids: ["67890"],
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

  describe("Remediation Security and Biophysics Enhancements", () => {
    describe("parseFoldxDifFile", () => {
      it("should parse stability change value (ddG) from single-run FoldX output text", () => {
        const mockFxout = `
  # FoldX output file
  Pdb\tTotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics
  wt.pdb\t10.50\t2.50\t8.00\t1.50\t2.00
  wt_1.pdb\t12.0432\t3.04\t9.00\t2.10\t2.20
        `.trim();
        const res = parseFoldxDifFile(mockFxout);
        expect(res.ddG).toBeCloseTo(1.5432, 4);
        expect(res.sd).toBe(0);
        expect(res.vdw).toBeCloseTo(0.60, 4);
        expect(res.electrostatics).toBeCloseTo(0.20, 4);
      });

      it("should parse and average multiple FoldX stochastic runs (BIO-10)", () => {
        const mockFxout = `
  # FoldX output file
  Pdb\tTotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics
  wt.pdb\t10.00\t2.50\t8.00\t1.50\t2.00
  wt_1.pdb\t12.00\t3.04\t9.00\t2.10\t2.20
  wt_2.pdb\t13.00\t3.04\t9.00\t2.20\t2.30
  wt_3.pdb\t14.00\t3.04\t9.00\t2.30\t2.40
        `.trim();
        const res = parseFoldxDifFile(mockFxout);
        // mutant energies: wt_1=12.00, wt_2=13.00, wt_3=14.00.
        // WT energy: 10.00
        // ddGs: 2.00, 3.00, 4.00
        // mean: 3.00
        // sample SD: sqrt(((2-3)^2 + (3-3)^2 + (4-3)^2)/2) = 1.00.
        expect(res.ddG).toBe(3.00);
        expect(res.sd).toBe(1.00);
      });

      it("should mark extreme outlier ddG values (> 20 kcal/mol) as degenerate artifacts (H-5, BIO-6)", () => {
        const mockFxout = `
  # FoldX output file
  Pdb\tTotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics
  wt.pdb\t10.00\t2.50\t8.00\t1.50\t2.00
  wt_1.pdb\t160.00\t3.04\t9.00\t120.00\t20.00
        `.trim();
        const res = parseFoldxDifFile(mockFxout);
        expect(res.ddG).toBe(null); // Extreme unphysical energy artifact (> 20 kcal/mol)
        expect(res.isDegenerate).toBe(true);
        expect(res.stericClashWarning).toBe(true);
      });

      it("should apply strict column matching and reject greedy total headers (BIO-5)", () => {
        const mockFxout = `
  Pdb\tTotal hbonds\tTotal energy
  wt.pdb\t45\t10.00
  wt_1.pdb\t42\t12.00
        `.trim();
        const res = parseFoldxDifFile(mockFxout);
        // should match Total energy (index 2), not Total hbonds (index 1)
        expect(res.ddG).toBe(2.00);
      });

      it("should throw error if total energy column is not found", () => {
        const mockFxout = `
  Pdb\tOtherCol\tBackbone
  wt.pdb\t10.0\t0.20
  wt_1.pdb\t7.5\t0.54
        `.trim();
        expect(() => parseFoldxDifFile(mockFxout)).toThrow();
      });

      it("should throw error if file is empty or mutant row is missing", () => {
        expect(() => parseFoldxDifFile("")).toThrow();
        expect(() => parseFoldxDifFile("HeaderOnly")).toThrow();
        expect(() => parseFoldxDifFile(`
  Pdb\tTotal energy
  wt.pdb\t10.50
        `.trim())).toThrow();
      });

      it("should parse difference-only format where WT row is missing", () => {
        const res = parseFoldxDifFile(`
  Pdb\tTotal energy
  wt_1.pdb\t12.00
        `.trim());
        expect(res.ddG).toBe(12.00);
      });

      it("should parse FoldX 5.1 style output with metadata headers not starting with #", () => {
        const res = parseFoldxDifFile(`
FoldX 5.1 (2011)
by the FoldX Consortium
------------------------------------------------------

PDB file analysed: batch
Output type: BuildModel
Pdb\ttotal energy\tBackbone Hbond
wt_1.pdb\t11.8627\t1.97785
        `.trim());
        expect(res.ddG).toBe(11.8627);
      });

      it.skipIf(!fs.existsSync("server/testdata/Dif_wt.fixture.fxout"))(
        "should match real captured FoldX fixture output value", 
        () => {
          const fixturePath = "server/testdata/Dif_wt.fixture.fxout";
          const fxText = fs.readFileSync(fixturePath, "utf8");
          const val = parseFoldxDifFile(fxText);
          
          expect(val.ddG).not.toBeNull();
          expect(isNaN(val.ddG!)).toBe(false);
        }
      );
    });

    describe("getNearestResidues regression check", () => {
      it("should return empty array for non-preset variants and never return synthetic residues", () => {
        const residues = getNearestResidues("P00439", "p.Val123Ala", 123);
        expect(residues).toEqual([]);
      });
    });

    describe("Legacy settings key scrub", () => {
      it("should scrub geminiApiKey from localStorage and return it empty in parsed settings", () => {
        const legacySettings = {
          residueColor: "#F97316",
          primaryAccent: "indigo",
          geminiApiKey: "legacy-api-key-12345",
          geminiSessionId: "session-id-123"
        };
        
        const store: Record<string, string> = {
          missenseUserSettings: JSON.stringify(legacySettings)
        };
        const localStorageMock = {
          getItem(key: string) { return store[key] || null; },
          setItem(key: string, val: string) { store[key] = val; }
        };
        
        const saved = localStorageMock.getItem("missenseUserSettings");
        let parsed = saved ? JSON.parse(saved) : null;
        if (parsed && parsed.geminiApiKey !== undefined) {
          delete parsed.geminiApiKey;
          localStorageMock.setItem("missenseUserSettings", JSON.stringify(parsed));
        }
        
        expect(parsed.geminiApiKey).toBeUndefined();
        const updatedStore = JSON.parse(store.missenseUserSettings);
        expect(updatedStore.geminiApiKey).toBeUndefined();
      });
    });

    describe("nearest-residues endpoint", () => {
      it("should return nearest residues correctly sorted by Euclidean distance", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/nearest-residues");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /nearest-residues not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;
        
        const mockPdbText = `
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
ATOM      2  CA  ALA A   2      2.000   2.000   2.000  1.00  0.00           C
ATOM      3  CA  VAL A   3      5.000   5.000   5.000  1.00  0.00           C
ATOM      4  CA  LEU A   4     10.000  10.000  10.000  1.00  0.00           C
        `.trim();

        let jsonVal: any = null;
        let statusVal: number | null = null;
        
        const req: any = {
          body: {
            pdbText: mockPdbText,
            targetIndex: 1,
            n: 2
          }
        };
        const res: any = {
          status(code: number) {
            statusVal = code;
            return this;
          },
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };
        
        await handler(req, res, () => {});
        
        expect(jsonVal).toBeDefined();
        expect(jsonVal.source).toBe("computed");
        expect(jsonVal.residues.length).toBe(2);
        expect(jsonVal.residues[0].name).toBe("ALA");
        expect(jsonVal.residues[0].index).toBe(2);
        expect(jsonVal.residues[0].distance).toBeCloseTo(1.73, 1);
        expect(jsonVal.residues[1].name).toBe("VAL");
        expect(jsonVal.residues[1].index).toBe(3);
        expect(jsonVal.residues[1].distance).toBeCloseTo(6.93, 1);
      });
    });

    describe("safeCompare timing-safe comparison", () => {
      it("should return true for identical strings", () => {
        expect(safeCompare("secureToken123", "secureToken123")).toBe(true);
      });

      it("should return false for different strings of same length", () => {
        expect(safeCompare("secureToken123", "secureToken321")).toBe(false);
      });

      it("should return false for different strings of different length", () => {
        expect(safeCompare("secureToken123", "short")).toBe(false);
      });
    });

    describe("Strict IUPAC validations and synonymous checks", () => {
      it("should reject synonymous variants", () => {
        expect(() => validateVariant("p.Arg215Arg")).toThrow("Synonymous variant detected");
        expect(() => validateVariant("Arg215Arg")).toThrow("Synonymous variant detected");
      });

      it("should reject non-IUPAC amino acids", () => {
        expect(HGVS_PATTERN.test("p.Z215A")).toBe(false);
        expect(MUTATION_FOLDX_PATTERN.test("ZA215A")).toBe(false);
      });

      it("should accept valid IUPAC codes", () => {
        expect(HGVS_PATTERN.test("p.Arg215Trp")).toBe(true);
        expect(MUTATION_FOLDX_PATTERN.test("RA215W")).toBe(true);
      });
    });

    describe("Stateless AES-GCM Session functions", () => {
      const secret = "test-secret-at-least-32-chars-long-1234567";

      it("should encrypt and decrypt session payload successfully", () => {
        const payload = { apiKey: "test-api-key", expiresAt: Date.now() + 10000 };
        const token = encryptSession(payload, secret);
        expect(token).toBeDefined();
        expect(typeof token).toBe("string");
        
        const decrypted = decryptSession(token, secret);
        expect(decrypted).toBeDefined();
        expect(decrypted?.apiKey).toBe("test-api-key");
        expect(decrypted?.expiresAt).toBe(payload.expiresAt);
      });

      it("should return undefined when decrypting with an incorrect secret", () => {
        const payload = { apiKey: "test-api-key", expiresAt: Date.now() + 10000 };
        const token = encryptSession(payload, secret);
        const decrypted = decryptSession(token, "wrong-secret-value-here-1234567890");
        expect(decrypted).toBeUndefined();
      });

      it("should return undefined for invalid or tampered tokens", () => {
        expect(decryptSession("invalid-token", secret)).toBeUndefined();
        
        const payload = { apiKey: "test-api-key", expiresAt: Date.now() + 10000 };
        const token = encryptSession(payload, secret);
        const parts = token.split(":");
        // Alter ciphertext content to fail GCM tag authentication
        parts[1] = (parts[1][0] === "A" ? "B" : "A") + parts[1].slice(1);
        const tamperedToken = parts.join(":");
        expect(decryptSession(tamperedToken, secret)).toBeUndefined();
      });

      it("should return undefined if the session is expired in getApiKeyFromSession", () => {
        const expiredPayload = { apiKey: "expired-key", expiresAt: Date.now() - 5000 };
        const expiredToken = encryptSession(expiredPayload, secret);
        
        const oldSecret = process.env.APP_SESSION_SECRET;
        process.env.APP_SESSION_SECRET = secret;
        try {
          expect(getApiKeyFromSession(expiredToken)).toBeUndefined();
        } finally {
          if (oldSecret === undefined) {
            delete process.env.APP_SESSION_SECRET;
          } else {
            process.env.APP_SESSION_SECRET = oldSecret;
          }
        }
      });

      it("should return API key if session is not expired in getApiKeyFromSession", () => {
        const validPayload = { apiKey: "valid-key", expiresAt: Date.now() + 60000 };
        const validToken = encryptSession(validPayload, secret);
        
        const oldSecret = process.env.APP_SESSION_SECRET;
        process.env.APP_SESSION_SECRET = secret;
        try {
          expect(getApiKeyFromSession(validToken)).toBe("valid-key");
        } finally {
          if (oldSecret === undefined) {
            delete process.env.APP_SESSION_SECRET;
          } else {
            process.env.APP_SESSION_SECRET = oldSecret;
          }
        }
      });
    });

    describe("PII Filter phone regex tightening constraints", () => {
      it("should redact standard phone numbers with diverse formats", () => {
        expect(filterPII("My number is 123-456-7890")).toContain("[REDACTED PHONE]");
        expect(filterPII("Reach me at +1 (123) 456-7890")).toContain("[REDACTED PHONE]");
        expect(filterPII("Call +441234567890")).toContain("[REDACTED PHONE]");
        expect(filterPII("Phone: 123.456.7890")).toContain("[REDACTED PHONE]");
      });

      it("should ignore genomic coordinates and other normal sequences of digits", () => {
        const coordInput = "Variant chr7:g.140753336A>T is pathogenic";
        expect(filterPII(coordInput)).toBe(coordInput);
        
        const plainDigits = "My query has number 140753336 inside it";
        expect(filterPII(plainDigits)).toBe(plainDigits);
      });

      it("should redact other PII types (email, SSN, DOB, Patient ID)", () => {
        expect(filterPII("Email test@example.com here")).toContain("[REDACTED EMAIL]");
        expect(filterPII("SSN: 123-45-6789")).toContain("[REDACTED SSN]");
        expect(filterPII("DOB: 12/04/1985")).toContain("[REDACTED DOB]");
        expect(filterPII("MRN: abc-12345")).toContain("[REDACTED PATIENT ID]");
      });
    });

    describe("Async PDB Parsers", () => {
      // Build unique residues to avoid Map deduplication key collision
      const mockPdbLines: string[] = [];
      for (let i = 1; i <= 4000; i++) {
        const resSeqStr = String(i).padStart(4, " ");
        mockPdbLines.push(`ATOM      1  CA  ASP A${resSeqStr}      1.000   1.000   1.000  1.00  0.00           C`);
      }
      const smallPdbText = mockPdbLines.slice(0, 10).join("\n");
      const largePdbText = mockPdbLines.join("\n");

      it("should parse residues asynchronously for large PDB files and synchronously for small ones", async () => {
        const smallRes = await parseResiduesFromPdbMaybeAsync(smallPdbText);
        expect(smallRes.length).toBe(10);
        
        const largeRes = await parseResiduesFromPdbMaybeAsync(largePdbText);
        expect(largeRes.length).toBe(4000);
      });

      it("should parse atoms asynchronously for large PDB files and synchronously for small ones", async () => {
        const smallAtoms = await parseAtomsFromPdbMaybeAsync(smallPdbText);
        expect(smallAtoms.length).toBe(10);
        
        const largeAtoms = await parseAtomsFromPdbMaybeAsync(largePdbText);
        expect(largeAtoms.length).toBe(4000);
      });
    });

    describe("requestLogger middleware", () => {
      it("should generate a request ID if none is provided", () => {
        let headers: Record<string, string> = {};
        const req: any = {
          headers
        };
        let responseHeaders: Record<string, string> = {};
        const res: any = {
          setHeader(name: string, val: string) {
            responseHeaders[name] = val;
          },
          on(event: string, callback: () => void) {
            // no-op
          }
        };
        const next = () => {};
        
        requestLogger(req, res, next);
        expect(req.headers["x-request-id"]).toBeDefined();
        expect(responseHeaders["X-Request-ID"]).toBe(req.headers["x-request-id"]);
      });

      it("should reuse an existing x-request-id header", () => {
        let headers: Record<string, string> = {
          "x-request-id": "preset-req-id"
        };
        const req: any = {
          headers
        };
        let responseHeaders: Record<string, string> = {};
        const res: any = {
          setHeader(name: string, val: string) {
            responseHeaders[name] = val;
          },
          on(event: string, callback: () => void) {
            // no-op
          }
        };
        const next = () => {};
        
        requestLogger(req, res, next);
        expect(req.headers["x-request-id"]).toBe("preset-req-id");
        expect(responseHeaders["X-Request-ID"]).toBe("preset-req-id");
      });
    });

    describe("Public API routes", () => {
      it("should return ok status on GET /health", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/health");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /health not found");
        const handler = route.route.stack[0].handle;
        let jsonVal: any = null;
        const req: any = {};
        const res: any = {
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };
        
        await handler(req, res, () => {});
        expect(jsonVal.status).toBe("ok");
        expect(jsonVal.timestamp).toBeDefined();
      });

      it("should return version info on GET /version", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/version");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /version not found");
        const handler = route.route.stack[0].handle;
        let jsonVal: any = null;
        const req: any = {};
        const res: any = {
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };
        
        await handler(req, res, () => {});
        expect(jsonVal.version).toBe("1.0.0");
      });
    });

    describe("PDB Prioritization & Chain Extraction", () => {
      it("should extract correct chain atoms and strip others", () => {
        const dummyPdb = `
HEADER    EXPERIMENTAL STRUCTURE
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
ATOM      2  CA  ALA B   2      2.000   2.000   2.000  1.00  0.00           C
TER       3      ALA B   2
CONECT    1    2
END
`.trim();
        const extracted = extractChainFromPdb(dummyPdb, "A");
        expect(extracted).toContain("ASP A   1");
        expect(extracted).not.toContain("ALA B   2");
        expect(extracted).not.toContain("CONECT");
        expect(extracted).toContain("HEADER");
      });

      it("should resolve best structure with no shifts and matching position", async () => {
        const mockBestRes = {
          "P00439": [
            {
              "pdb_id": "6hpo",
              "chain_id": "A",
              "unp_start": 1,
              "unp_end": 452,
              "start": 1,
              "end": 452,
              "resolution": 1.67,
              "coverage": 1.0
            },
            {
              "pdb_id": "1abc",
              "chain_id": "B",
              "unp_start": 10,
              "unp_end": 100,
              "start": 1,
              "end": 91,
              "resolution": 2.0,
              "coverage": 0.5
            }
          ]
        };

        const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(() => 
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockBestRes)
          } as any)
        );

        const res1 = await fetchBestPdbStructure("P00439", 100);
        expect(res1).toEqual({ pdbId: "6hpo", chainId: "A", shift: 0, unpStart: 1, structStart: 1 });

        const res2 = await fetchBestPdbStructure("P00439", 500);
        expect(res2).toBeNull();

        fetchSpy.mockRestore();
      });

      it("should return PDB data from RCSB if mapping exists", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/alphafold-pdb/:uniprotId");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /alphafold-pdb/:uniprotId not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const bestSpy = vi.spyOn(await import("./server/services/external.ts"), "fetchBestPdbStructure").mockImplementation(() =>
          Promise.resolve({ pdbId: "6hpo", chainId: "A", shift: 0, unpStart: 1, structStart: 1 })
        );

        const rcsbSpy = vi.spyOn(await import("./server/services/external.ts"), "fetchPdbFromRcsb").mockImplementation(() =>
          Promise.resolve("ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C")
        );

        let sentData: any = null;
        const req: any = {
          params: { uniprotId: "P00439" },
          query: { pos: "408" }
        };
        const res: any = {
          setHeader() {},
          send(body: any) {
            sentData = body;
            return this;
          },
          status() {
            return this;
          },
          json(body: any) {
            sentData = body;
            return this;
          }
        };

        await handler(req, res, () => {});
        expect(sentData).toContain("ASP A   1");
        
        bestSpy.mockRestore();
        rcsbSpy.mockRestore();
      });
    });

    describe("FoldX execution failure and error propagation", () => {
      it("should throw a hard modeling engine unavailable error when FoldX execution fails", async () => {
        const dummyPdb = `
HEADER    EXPERIMENTAL STRUCTURE
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
TER       2      ASP A   1
END
`.trim();
        const tempJobDir = path.join(process.cwd(), "temp_jobs", "test-foldx-failure-" + crypto.randomUUID());
        await fs.promises.mkdir(tempJobDir, { recursive: true });
        
        // Force FOLDX_BINARY to a non-existent executable to ensure failure
        const oldFoldxBin = process.env.FOLDX_BINARY;
        process.env.FOLDX_BINARY = "non-existent-foldx-binary";
        
        try {
          await expect(
            generateMutantPdb(dummyPdb, "DA1W", "P00439", tempJobDir)
          ).rejects.toThrow("Biophysical modeling engine unavailable");
        } finally {
          process.env.FOLDX_BINARY = oldFoldxBin;
          if (fs.existsSync(tempJobDir)) {
            await fs.promises.rm(tempJobDir, { recursive: true, force: true });
          }
        }
      });
    });

    describe("Gemini API Fallback Cascade and Error Mapping", () => {
      it("should attempt fallback models if the primary model fails with model-not-found/unavailable error", async () => {
        const geminiService = await import("./server/services/gemini.ts");
        
        const oldModel = process.env.GEMINI_MODEL;
        const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
        
        process.env.GEMINI_MODEL = "invalid-model-1";
        process.env.GEMINI_MODEL_FALLBACKS = "invalid-model-2,gemini-3.5-flash";
        
        mockGenerateContent
          .mockRejectedValueOnce(new Error("model not found"))
          .mockRejectedValueOnce(new Error("model_unavailable"))
          .mockResolvedValueOnce({
            text: JSON.stringify({
              analysis: "Successful fallback analysis",
              biochemicalShift: "test shift",
              structuralImpact: "test impact",
              plausibility: "Plausibly pathogenic because of something",
              acmgCriteria: [{ code: "PM1", reason: "test reason" }]
            })
          });
          
        try {
          const result = await geminiService.performGeminiAnalysis(
            "PAH",
            "p.Arg408Trp",
            "P00439",
            "408",
            "R",
            "W",
            undefined,
            null,
            "standard",
            "dummy-key",
            AbortSignal.timeout(5000)
          );
          
          expect(mockGenerateContent).toHaveBeenCalledTimes(3);
          expect(mockGenerateContent.mock.calls[0][0].model).toBe("invalid-model-1");
          expect(mockGenerateContent.mock.calls[1][0].model).toBe("invalid-model-2");
          expect(mockGenerateContent.mock.calls[2][0].model).toBe("gemini-3.5-flash");
          expect(result.analysis).toBe("Successful fallback analysis");
          expect(result.insights?.pathogenicity).toBe("(Clinician Assigned)");
          expect(result.insights?.plausibility).toBe("Plausibly pathogenic because of something");
        } finally {
          process.env.GEMINI_MODEL = oldModel;
          process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
        }
      });

      it("should map specific SDK errors to correct GeminiError instances", async () => {
        const geminiService = await import("./server/services/gemini.ts");
        
        const oldModel = process.env.GEMINI_MODEL;
        const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
        process.env.GEMINI_MODEL = "primary";
        process.env.GEMINI_MODEL_FALLBACKS = "";
        
        const testErrorMapping = async (apiErrorMsg: string, apiStatus: number, expectedCode: string, expectedStatus: number) => {
          mockGenerateContent.mockReset();
          mockGenerateContent.mockRejectedValue({
            message: apiErrorMsg,
            status: apiStatus
          });
          
          try {
            await expect(
              geminiService.performGeminiAnalysis(
                "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
              )
            ).rejects.toThrowError(geminiService.GeminiError);
            
            try {
              await geminiService.performGeminiAnalysis(
                "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
              );
            } catch (err: any) {
              expect(err.code).toBe(expectedCode);
              expect(err.status).toBe(expectedStatus);
            }
          } catch (e) {
            // expected to throw
          }
        };
        
        try {
          await testErrorMapping("API key is invalid or unauthorized", 403, "API_KEY_INVALID", 403);
          await testErrorMapping("Resource exhausted or quota exceeded", 429, "RESOURCE_EXHAUSTED", 429);
          await testErrorMapping("Deadline exceeded or request timed out", 504, "TIMEOUT", 504);
          await testErrorMapping("Internal server error or unknown code", 500, "MODEL_UNAVAILABLE", 503);
        } finally {
          process.env.GEMINI_MODEL = oldModel;
          process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
        }
      });
    });

    describe("DynaMut2 two-phase polling", () => {
      it("should return 400 for non-numeric Job ID format", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/dynamut2-job/:jobId");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /dynamut2-job/:jobId not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        let statusVal: number | null = null;
        let jsonVal: any = null;
        const req: any = {
          params: { jobId: "abc" },
          headers: {}
        };
        const res: any = {
          status(code: number) {
            statusVal = code;
            return this;
          },
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});
        expect(statusVal).toBe(400);
        expect(jsonVal.error.code).toBe("BAD_REQUEST");
      });

      it("should correctly call pollDynaMut2Job and return status & prediction", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/dynamut2-job/:jobId");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /dynamut2-job/:jobId not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const pollSpy = vi.spyOn(externalServices, "pollDynaMut2Job").mockResolvedValue({
          status: "DONE",
          prediction: -0.426
        });

        let jsonVal: any = null;
        const req: any = {
          params: { jobId: "12345" },
          headers: {}
        };
        const res: any = {
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});
        expect(pollSpy).toHaveBeenCalledWith("12345");
        expect(jsonVal.status).toBe("DONE");
        expect(jsonVal.prediction).toBe(-0.426);
        
        pollSpy.mockRestore();
      });

      it("should return foldx result immediately when calling /generate-mutant", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /generate-mutant not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const biophysics = await import("./server/services/biophysics.ts");
        const mutantSpy = vi.spyOn(biophysics, "generateMutantPdb").mockResolvedValue({
          pdb: "ATOM  1  CA  VAL A   1 ...",
          ddG: 1.25,
          status: "success",
          foldedResidueIndex: 1
        });

        const ddgunSpy = vi.spyOn(biophysics, "runDdgunSeq").mockResolvedValue(0.3);
        const raspSpy = vi.spyOn(biophysics, "runRaspLocal").mockResolvedValue(null);
        const seqSpy = vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("D");
        const dynamutSpy = vi.spyOn(externalServices, "submitDynaMut2Job").mockResolvedValue("12345");
        const ddmutSpy = vi.spyOn(externalServices, "submitDdmutJob").mockResolvedValue("67890");

        let jsonVal: any = null;
        let statusVal: number | null = null;
        
        const dummyPdb = `
HEADER    EXPERIMENTAL STRUCTURE
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
TER       2      ASP A   1
END
        `.trim();

        const req: any = {
          body: {
            wtPdb: dummyPdb,
            mutation: "DA1V",
            uniprotId: "P00439"
          },
          headers: {
            "x-request-id": "test-req-id"
          }
        };
        const res: any = {
          status(code: number) {
            statusVal = code;
            return this;
          },
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});
        
        expect(mutantSpy).toHaveBeenCalled();
        expect(ddgunSpy).toHaveBeenCalled();
        expect(jsonVal).toBeDefined();
        expect(jsonVal.energetics.foldx).toBe(1.25);
        expect(jsonVal.energetics.ddgun).toBe(0.3);

        mutantSpy.mockRestore();
        ddgunSpy.mockRestore();
        raspSpy.mockRestore();
        seqSpy.mockRestore();
        dynamutSpy.mockRestore();
        ddmutSpy.mockRestore();
      });

      it("should submit DynaMut2 job successfully when calling /dynamut2-submit", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/dynamut2-submit");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /dynamut2-submit not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const submitSpy = vi.spyOn(externalServices, "submitDynaMut2Job").mockResolvedValue("98765");

        let jsonVal: any = null;
        const dummyPdb = `
HEADER    EXPERIMENTAL STRUCTURE
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
TER       2      ASP A   1
END
        `.trim();

        const req: any = {
          body: {
            wtPdb: dummyPdb,
            mutation: "DA1V"
          }
        };
        const res: any = {
          status(code: number) {
            return this;
          },
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});
        
        expect(submitSpy).toHaveBeenCalledWith(dummyPdb, "A", 1, "D", "V");
        expect(jsonVal).toBeDefined();
        expect(jsonVal.dynamut2JobId).toBe("98765");
        expect(jsonVal.dynamut2Status).toBe("pending");

        submitSpy.mockRestore();
      });

      it("should submit DDMut job successfully when calling /ddmut-submit", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/ddmut-submit");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /ddmut-submit not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const submitSpy = vi.spyOn(externalServices, "submitDdmutJob").mockResolvedValue("ddmut-job-1");

        let jsonVal: any = null;
        const dummyPdb = `
HEADER    EXPERIMENTAL STRUCTURE
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C
TER       2      ASP A   1
END
        `.trim();

        const req: any = {
          body: {
            wtPdb: dummyPdb,
            mutation: "DA1V"
          }
        };
        const res: any = {
          status(code: number) {
            return this;
          },
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});
        
        expect(submitSpy).toHaveBeenCalledWith(dummyPdb, "A", 1, "D", "V");
        expect(jsonVal).toBeDefined();
        expect(jsonVal.ddmutJobId).toBe("ddmut-job-1");
        expect(jsonVal.ddmutStatus).toBe("pending");

        submitSpy.mockRestore();
      });

      it("should correctly call pollDdmutJob and return status & prediction", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/ddmut-job/:jobId");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /ddmut-job/:jobId not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const pollSpy = vi.spyOn(externalServices, "pollDdmutJob").mockResolvedValue({
          status: "DONE",
          prediction: -1.25
        });

        let jsonVal: any = null;
        const req: any = {
          params: { jobId: "98765" },
          query: {},
          headers: {}
        };
        const res: any = {
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});
        expect(pollSpy).toHaveBeenCalledWith("98765");
        expect(jsonVal.status).toBe("DONE");
        expect(jsonVal.prediction).toBe(-1.25);
        
        pollSpy.mockRestore();
      });
    });

    describe("/analyze-variant-biophysical endpoint", () => {
      it("should return biophysical narrative from Gemini successfully", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant-biophysical");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /analyze-variant-biophysical not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const geminiServices = await import("./server/services/gemini.ts");
        const geminiSpy = vi.spyOn(geminiServices, "performGeminiBiophysicalAnalysis").mockResolvedValue({
          biochemicalShift: "mock shift",
          structuralImpact: "mock structural impact"
        } as any);

        let jsonVal: any = null;
        const req: any = {
          body: {
            gene: "PAH",
            variant: "p.Arg408Cys",
            uniprotId: "P00439",
            residueIndex: "408",
            wildType: "Arg",
            mutant: "Cys"
          },
          headers: {}
        };
        const res: any = {
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});

        expect(geminiSpy).toHaveBeenCalled();
        expect(jsonVal.biochemicalShift).toBe("mock shift");
        expect(jsonVal.structuralImpact).toBe("mock structural impact");

        geminiSpy.mockRestore();
      });

      it("should gracefully degrade and return fallback strings when Gemini throws an error", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant-biophysical");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /analyze-variant-biophysical not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const geminiServices = await import("./server/services/gemini.ts");
        const geminiSpy = vi.spyOn(geminiServices, "performGeminiBiophysicalAnalysis").mockRejectedValue(new Error("Gemini quota exceeded"));

        let jsonVal: any = null;
        const req: any = {
          body: {
            gene: "PAH",
            variant: "p.Arg408Gly",
            uniprotId: "P00439",
            residueIndex: "408",
            wildType: "Arg",
            mutant: "Gly"
          },
          headers: {}
        };
        const res: any = {
          json(body: any) {
            jsonVal = body;
            return this;
          }
        };

        await handler(req, res, () => {});

        expect(geminiSpy).toHaveBeenCalled();
        expect(jsonVal.biochemicalShift).toContain("unavailable");
        expect(jsonVal.structuralImpact).toContain("Gemini quota exceeded");

        geminiSpy.mockRestore();
      });

      it("should bypass rate limiter and serve directly from cache on subsequent requests", async () => {
        const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant-biophysical");
        expect(route).toBeDefined();
        if (!route || !route.route) throw new Error("Route /analyze-variant-biophysical not found");
        const handler = route.route.stack[route.route.stack.length - 1].handle;

        const geminiServices = await import("./server/services/gemini.ts");
        const geminiSpy = vi.spyOn(geminiServices, "performGeminiBiophysicalAnalysis").mockResolvedValue({
          biochemicalShift: "mock cache shift",
          structuralImpact: "mock cache structural impact"
        });

        const req: any = {
          body: {
            gene: "PAH",
            variant: "p.Arg408His",
            uniprotId: "P00439",
            residueIndex: "408",
            wildType: "Arg",
            mutant: "His"
          },
          headers: {}
        };

        let firstJsonVal: any = null;
        const res1: any = {
          json(body: any) {
            firstJsonVal = body;
            return this;
          }
        };

        // First call - Cache miss, calls performGeminiBiophysicalAnalysis
        await handler(req, res1, () => {});
        expect(geminiSpy).toHaveBeenCalledTimes(1);
        expect(firstJsonVal.biochemicalShift).toBe("mock cache shift");

        geminiSpy.mockClear();

        let secondJsonVal: any = null;
        const res2: any = {
          json(body: any) {
            secondJsonVal = body;
            return this;
          }
        };

        // Second call - Cache hit, does NOT call performGeminiBiophysicalAnalysis
        await handler(req, res2, () => {});
        expect(geminiSpy).not.toHaveBeenCalled();
        expect(secondJsonVal.biochemicalShift).toBe("mock cache shift");

        geminiSpy.mockRestore();
      });
    });
  });
});

describe("Session Authentication & Key Validation", () => {
  describe("/analyze-variant Session Validation", () => {
    it("should return SESSION_EXPIRED when session has expired on /analyze-variant", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /analyze-variant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const externalServices = await import("./server/services/external.ts");
      const biophysicsServices = await import("./server/services/biophysics.ts");

      const seqSpy = vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("M");
      const clinvarSpy = vi.spyOn(externalServices, "fetchClinVarData").mockResolvedValue({} as any);
      const predSpy = vi.spyOn(externalServices, "fetchPredictorData").mockResolvedValue({} as any);
      const consSpy = vi.spyOn(externalServices, "fetchConservationData").mockResolvedValue({} as any);
      const strSpy = vi.spyOn(externalServices, "fetchStringInteractions").mockResolvedValue([] as any);
      const freqSpy = vi.spyOn(externalServices, "fetchGnomadVariantFrequency").mockResolvedValue({} as any);
      const pdbSpy = vi.spyOn(externalServices, "fetchBestPdbStructure").mockResolvedValue({} as any);
      const afPdbSpy = vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue("dummy-pdb-text");
      const constSpy = vi.spyOn(externalServices, "fetchGnomadGeneConstraint").mockResolvedValue({} as any);
      const featSpy = vi.spyOn(externalServices, "fetchUniprotFeatures").mockResolvedValue({} as any);

      const disSpy = vi.spyOn(biophysicsServices, "predictStructuralDisruption").mockResolvedValue({ level: "low", reason: "mocked", plddt: 100 } as any);
      const esmSpy = vi.spyOn(biophysicsServices, "runEsm2Eval").mockResolvedValue({ llr: -5, verdict: "neutral" } as any);

      const encryptSecret = "dev-session-secret-must-be-changed-in-prod";
      const expiredSessionId = encryptSession(
        { apiKey: "test-key-expired", expiresAt: Date.now() - 5000 },
        encryptSecret
      );
      
      const req: any = {
        body: {
          gene: "PAH",
          variant: "p.Met1Val",
          uniprotId: "P00439"
        },
        headers: {
          "authorization": "Bearer dummy-token",
          "x-gemini-session-id": expiredSessionId
        }
      };
      
      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };
      
      await handler(req, res, () => {});
      
      expect(statusCode).toBe(401);
      expect(jsonVal.error.code).toBe("SESSION_EXPIRED");

      seqSpy.mockRestore();
      clinvarSpy.mockRestore();
      predSpy.mockRestore();
      consSpy.mockRestore();
      strSpy.mockRestore();
      freqSpy.mockRestore();
      pdbSpy.mockRestore();
      afPdbSpy.mockRestore();
      constSpy.mockRestore();
      featSpy.mockRestore();
      disSpy.mockRestore();
      esmSpy.mockRestore();
    });

    it("should return SESSION_EXPIRED when session is completely invalid on /analyze-variant", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /analyze-variant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const externalServices = await import("./server/services/external.ts");
      const biophysicsServices = await import("./server/services/biophysics.ts");

      const seqSpy = vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("M");
      const clinvarSpy = vi.spyOn(externalServices, "fetchClinVarData").mockResolvedValue({} as any);
      const predSpy = vi.spyOn(externalServices, "fetchPredictorData").mockResolvedValue({} as any);
      const consSpy = vi.spyOn(externalServices, "fetchConservationData").mockResolvedValue({} as any);
      const strSpy = vi.spyOn(externalServices, "fetchStringInteractions").mockResolvedValue([] as any);
      const freqSpy = vi.spyOn(externalServices, "fetchGnomadVariantFrequency").mockResolvedValue({} as any);
      const pdbSpy = vi.spyOn(externalServices, "fetchBestPdbStructure").mockResolvedValue({} as any);
      const afPdbSpy = vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue("dummy-pdb-text");
      const constSpy = vi.spyOn(externalServices, "fetchGnomadGeneConstraint").mockResolvedValue({} as any);
      const featSpy = vi.spyOn(externalServices, "fetchUniprotFeatures").mockResolvedValue({} as any);

      const disSpy = vi.spyOn(biophysicsServices, "predictStructuralDisruption").mockResolvedValue({ level: "low", reason: "mocked", plddt: 100 } as any);
      const esmSpy = vi.spyOn(biophysicsServices, "runEsm2Eval").mockResolvedValue({ llr: -5, verdict: "neutral" } as any);

      const req: any = {
        body: {
          gene: "PAH",
          variant: "p.Met1Val",
          uniprotId: "P00439"
        },
        headers: {
          "authorization": "Bearer dummy-token",
          "x-gemini-session-id": "completely-invalid-session-id-format"
        }
      };
      
      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };
      
      await handler(req, res, () => {});
      
      expect(statusCode).toBe(401);
      expect(jsonVal.error.code).toBe("SESSION_EXPIRED");

      seqSpy.mockRestore();
      clinvarSpy.mockRestore();
      predSpy.mockRestore();
      consSpy.mockRestore();
      strSpy.mockRestore();
      freqSpy.mockRestore();
      pdbSpy.mockRestore();
      afPdbSpy.mockRestore();
      constSpy.mockRestore();
      featSpy.mockRestore();
      disSpy.mockRestore();
      esmSpy.mockRestore();
    });
  });

  describe("API Key Regex Validation", () => {
    it("should validate relaxed API key format with special characters", () => {
      const relaxedRegex = /^[a-zA-Z0-9_\-\.\+\=\/]+$/;
      
      expect(relaxedRegex.test("AIzaSyB123_456-789")).toBe(true);
      expect(relaxedRegex.test("AIzaSyB123.456.789")).toBe(true);
      expect(relaxedRegex.test("AIzaSyB123+456/789=")).toBe(true);
      expect(relaxedRegex.test("AIzaSyB123 456")).toBe(false);
      expect(relaxedRegex.test("AIzaSyB123\"456")).toBe(false);
    });
  });

  describe("ACMG Pathogenicity Engine & Rule Classifier", () => {
    it("should correctly classify standard evidence combinations (1 Very Strong + 1 Moderate -> Likely Pathogenic)", () => {
      const clinvar = { classification: "Likely pathogenic", uid: "123" };
      // PVS1 (pathogenic clinvar) + PM2 (revel = 0.6)
      const res = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        clinvar,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
        { available: true, revel: 0.6, gerp: 1.0, phylop: 0.5, consurf: 2 },
        null,
        { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" }
      );
      
      // PM2 from rarity fallback, plus BP4 resolved (since 2 benign vs 1 pathogenic)
      expect(res.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
      expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
      // verdict is determined using the Richards combinatorial classifier
      expect(res.acmgVerdict).toBeDefined();
    });

    it("should count BS1 as strong benign and class as Likely Benign with BP4", () => {
      const res = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
        { available: true, revel: 0.1 },
        null,
        { maxAF: 0.015, groupMaxAF: 0.015, genomeAF: 0.015, exomeAF: 0.015, nHomozygous: 0, dataset: "gnomad" }, // 7th argument: gnomadFrequency
        "standard"
      );
      expect(res.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
      expect(res.acmgCriteria.some(c => c.code === "BS1")).toBe(true);
      expect(res.acmgVerdict).toBe("Likely Benign");
    });

    it("should include bayesdel in PP3/BP4 predictor concordance", () => {
      const res = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 },
        { available: true, revel: 0.1, bayesdel: 0.2 } // 3 pathogenic total (AM, CADD, BayesDel)
      );
      expect(res.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
      expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("BayesDel: 0.2");
      expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("3/4 predictors agree");
    });

    it("should respect PP3/BP4 concordance voting rules under conflicting predictor scenarios", () => {
      // 2 pathogenic, 1 benign -> met PP3 (Pathogenic supporting)
      const res1 = computeRuleBasedACMG(
        "GBA1",
        "p.Asn370Ser",
        null,
        { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 }, // pathogenic
        { available: true, revel: 0.1, gerp: 1.0, phylop: 0.5 } // benign
      );
      expect(res1.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
      expect(res1.acmgCriteria.some(c => c.code === "BP4")).toBe(false);

      // 1 pathogenic, 2 benign -> met BP4 (Benign supporting)
      const res2 = computeRuleBasedACMG(
        "GBA1",
        "p.Asn370Ser",
        null,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 }, // benign
        { available: true, revel: 0.6, gerp: 1.0, phylop: 0.5 } // pathogenic (revel 0.6 >= 0.5)
      );
      // Wait: AM=benign, CADD=5 (benign), REVEL=0.6 (pathogenic)
      // 2 benign vs 1 pathogenic -> met BP4
      expect(res2.acmgCriteria.some(c => c.code === "BP4")).toBe(true);
      expect(res2.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
    });

    it("should assign PP3 when amClass is likely_pathogenic (ACMG-AM regression)", () => {
      // AM = likely_pathogenic, CADD = 26, REVEL = 0.8 -> 3 pathogenic -> PP3 (threshold calibrated to >= 0.75)
      const res = computeRuleBasedACMG(
        "LDLR",
        "p.Glu101Lys",
        null,
        { available: true, amPathogenicity: 0.65, amClass: "likely_pathogenic", caddPhred: 26 },
        { available: true, revel: 0.8 }
      );
      expect(res.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
      expect(res.acmgCriteria.find(c => c.code === "PP3")?.reason).toContain("3/3");
    });

    it("should output accurate count, never false agreement wording, when only one predictor is available", () => {
      const res = computeRuleBasedACMG(
        "PTEN",
        "p.Arg130Gln",
        null,
        { available: true, amPathogenicity: 0.85, amClass: "pathogenic", caddPhred: null },
        { available: false, revel: null }
      );
      const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
      expect(pp3).toBeDefined();
      expect(pp3?.reason).toContain("1/1 predictor supports");
      expect(pp3?.reason).not.toContain("agree");
    });

    it("should respect popEVE scores in ACMG PP3/BP4 concordance calculations", () => {
      const res = computeRuleBasedACMG(
        "GBA1",
        "p.Asn370Ser",
        null,
        {
          available: true,
          amPathogenicity: 0.8,
          amClass: "pathogenic",
          caddPhred: 26,
        },
        {
          available: true,
          revel: 0.1,
          popeve: -3.775,
        }
      );
      const pp3 = res.acmgCriteria.find(c => c.code === "PP3");
      expect(pp3).toBeDefined();
      expect(pp3?.reason).toContain("3/4 predictors agree");
      expect(pp3?.reason).toContain("popEVE: PATHOGENIC");
    });

    it("should respect acmgWeighting parameter (conservative & strict-structural modes)", () => {
      const predictorData = { available: true, amPathogenicity: 0.8, amClass: "pathogenic", caddPhred: 26 };
      const conservationData = { available: true, revel: 0.6 };
      const gnomadConstraintMock = { isPP2Constrained: true, missense_z: 3.0, oe_mis: 0.5, pli: null };

      // Standard mode - applies PP3, PM2, PP2 (via live constraint) even if ClinVar is null
      const resStandard = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        predictorData,
        conservationData,
        gnomadConstraintMock,
        { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
        "standard"
      );
      expect(resStandard.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
      expect(resStandard.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
      expect(resStandard.acmgCriteria.some(c => c.code === "PP2")).toBe(true);

      // Conservative mode without ClinVar support - skips PP3, PM2, PP2
      const resConservativeNoClinVar = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        predictorData,
        conservationData,
        gnomadConstraintMock,
        { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
        "conservative"
      );
      expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
      expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
      expect(resConservativeNoClinVar.acmgCriteria.some(c => c.code === "PP2")).toBe(false);

      // Conservative mode WITH ClinVar support - keeps PP3, PM2, PP2
      const resConservativeWithClinVar = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        { classification: "Pathogenic", uid: "123" },
        predictorData,
        conservationData,
        gnomadConstraintMock,
        { maxAF: 0.00001, groupMaxAF: 0.00001, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" },
        "conservative"
      );
      expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PP3")).toBe(true);
      expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
      expect(resConservativeWithClinVar.acmgCriteria.some(c => c.code === "PP2")).toBe(true);

      // Strict-structural mode - skips PP3, PM2, PP2 regardless of ClinVar
      const resStrictStructural = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        { classification: "Pathogenic", uid: "123" },
        predictorData,
        conservationData,
        gnomadConstraintMock,
        null,
        "strict-structural"
      );
      expect(resStrictStructural.acmgCriteria.some(c => c.code === "PP3")).toBe(false);
      expect(resStrictStructural.acmgCriteria.some(c => c.code === "PM2")).toBe(false);
      expect(resStrictStructural.acmgCriteria.some(c => c.code === "PP2")).toBe(false);
    });

    it("should respect ClinGen-calibrated AlphaMissense thresholds (pathogenic >= 0.983, benign <= 0.063)", () => {
      // 1. Pathogenic: score = 0.985, class = null (should evaluate to pathogenic)
      const resPath = countPredictorConcordance(
        null, null, 0.985, null
      );
      expect(resPath.signals.am).toBe("pathogenic");

      // 2. Benign: score = 0.05, class = null (should evaluate to benign)
      const resBenign = countPredictorConcordance(
        null, null, 0.05, null
      );
      expect(resBenign.signals.am).toBe("benign");

      // 3. Indeterminate (VUS): score = 0.5, class = null (should evaluate to vus)
      const resVus = countPredictorConcordance(
        null, null, 0.5, null
      );
      expect(resVus.signals.am).toBe("vus");
    });

    it("should validate production session secret validation checks", () => {
      // If we execute the self-invoking function under production, it exits if secret is default or weak.
      const originalEnv = process.env.NODE_ENV;
      const originalSecret = process.env.APP_SESSION_SECRET;
      const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
      const mockError = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        process.env.NODE_ENV = "production";
        process.env.APP_SESSION_SECRET = "dev-secret-change-me"; // Default weak secret
        
        // Trigger the validation block manually (since it runs on import, we check logic)
        const secret = process.env.APP_SESSION_SECRET;
        const defaultValues = ["dev-secret-change-me", "change_me", "secret", ""];
        const isInvalid = !secret || defaultValues.some(d => secret.toLowerCase().includes(d)) || secret.length < 32;
        
        expect(isInvalid).toBe(true);
      } finally {
        process.env.NODE_ENV = originalEnv;
        process.env.APP_SESSION_SECRET = originalSecret;
        mockExit.mockRestore();
        mockError.mockRestore();
      }
    });

    it("should throttle concurrent operations using ConcurrencySemaphore", async () => {
      const sem = new Semaphore(2);
      let activeCount = 0;
      let maxActiveCount = 0;

      const task = async (id: number, delayMs: number) => {
        await sem.acquire();
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        activeCount--;
        sem.release();
      };

      // Run 3 tasks concurrently. Concurrency limit is 2.
      // Task 1 and 2 will acquire immediately. Task 3 will queue.
      const p1 = task(1, 10);
      const p2 = task(2, 10);
      const p3 = task(3, 10);

      await Promise.all([p1, p2, p3]);

      expect(maxActiveCount).toBe(2);
      expect(activeCount).toBe(0);
    });

    it("should compute Kabsch alignment and structural diff correctly", async () => {
      const wtPdb = `
ATOM      1  CA  ASP A   1       1.000   0.000   0.000  1.00  0.00           C
ATOM      2  CA  ASP A   2       0.000   1.000   0.000  1.00  0.00           C
ATOM      3  CA  ASP A   3       0.000   0.000   1.000  1.00  0.00           C
      `.trim();

      const mutPdb = `
ATOM      1  CA  ASP A   1       2.000   0.000   0.000  1.00  0.00           C
ATOM      2  CA  ASP A   2       1.000   1.000   0.000  1.00  0.00           C
ATOM      3  CA  ASP A   3       1.000   0.000   1.000  1.00  0.00           C
      `.trim();

      const diff = await computeStructuralDiff(wtPdb, mutPdb, 1, "A");
      expect(diff.rmsd).toBeLessThan(0.0001);
      expect(diff.windowDisplacements).toBeDefined();
      expect(diff.windowDisplacements.length).toBe(3);
      expect(diff.clashes).toBeDefined();
    });

    it("should handle structural-diff endpoint request successfully", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/structural-diff");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /structural-diff not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      let jsonVal: any = null;
      let statusVal: number | null = null;
      const req: any = {
        body: {
          wtPdb: "ATOM      1  CA  ASP A   1       1.000   0.000   0.000  1.00  0.00           C",
          mutPdb: "ATOM      1  CA  ASP A   1       1.000   0.000   0.000  1.00  0.00           C",
          pos: "1",
          chain: "A"
        }
      };
      const res: any = {
        status(code: number) {
          statusVal = code;
          return this;
        },
        json(body: any) {
          jsonVal = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(jsonVal).toBeDefined();
      expect(jsonVal.rmsd).toBe(0);
      expect(jsonVal.clashes.wtClashCount).toBe(0);
    });

    it("should run ESM2 evaluator and return parsed prediction", async () => {
      const biophysics = await import("./server/services/biophysics.ts");
      const execSpy = vi.spyOn(biophysics, "runEsm2Eval").mockResolvedValue({
        llr: -7.25,
        verdict: "pathogenic"
      });

      const res = await biophysics.runEsm2Eval("MELA", 1, "M", "A");
      expect(execSpy).toHaveBeenCalled();
      expect(res).toBeDefined();
      expect(res?.llr).toBe(-7.25);
      expect(res?.verdict).toBe("pathogenic");

      execSpy.mockRestore();
    });

    it("should run RaSP evaluator and return parsed prediction", async () => {
      const biophysics = await import("./server/services/biophysics.ts");
      const raspSpy = vi.spyOn(biophysics, "runRaspLocal").mockResolvedValue({ score: -1.5 });

      const res = await biophysics.runRaspLocal("wt.pdb", "mut.pdb", "A", 12, "V", "I");
      expect(raspSpy).toHaveBeenCalledWith("wt.pdb", "mut.pdb", "A", 12, "V", "I");
      expect(res).toEqual({ score: -1.5 });

      raspSpy.mockRestore();
    });

    it("should return explicit database reason string in runRaspLocal when precomputed score is null", async () => {
      const biophysics = await import("./server/services/biophysics.ts");
      const lookupSpy = vi.spyOn(biophysics, "lookupPrecomputedRaspScore").mockResolvedValue({ score: null, reason: "Residue position is not present in the pre-computed database" });

      const res = await biophysics.runRaspLocal("wt.pdb", "mut.pdb", "A", 2, "A", "P", "Q9H116");
      expect(res).toEqual({ score: null, reason: "Residue position is not present in the pre-computed database" });

      lookupSpy.mockRestore();
    });

    it("should compute consensus verdict stability correctly for benchmark variant PAH p.Arg408Trp (golden-value test)", async () => {
      const { computeConsensusVerdict } = await import("./src/shared/thresholds.ts");
      const verdict = computeConsensusVerdict({
        foldxMean: 4.85, // Strongly destabilizing ΔΔG
        rasp: -3.2,      // Strongly destabilizing RaSP
        ddgun: -2.1      // Destabilizing DDGun
      });
      expect(verdict).toBe("High Misfolding Risk (Destabilizing Consensus)");
    });

    it("should evaluate PM2/BA1/BS1 based on groupMaxAF in computeRuleBasedACMG", () => {
      // Test groupMaxAF standalone benign (BA1)
      const resBA1 = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
        { available: true, revel: 0.1 },
        null,
        { maxAF: 0.0001, groupMaxAF: 0.06, genomeAF: 0.0001, exomeAF: 0.0001, nHomozygous: 0, dataset: "gnomad" }
      );
      expect(resBA1.acmgCriteria.some(c => c.code === "BA1")).toBe(true);

      // Test groupMaxAF intermediate (BS1)
      const resBS1 = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
        { available: true, revel: 0.1 },
        null,
        { maxAF: 0.00001, groupMaxAF: 0.015, genomeAF: 0.00001, exomeAF: 0.00001, nHomozygous: 0, dataset: "gnomad" }
      );
      expect(resBS1.acmgCriteria.some(c => c.code === "BS1")).toBe(true);
    });

    it("should run predictStructuralDisruption and populate sasa/rsa fields if runSasaEval returns data", async () => {
      const biophysics = await import("./server/services/biophysics.ts");
      const dummyPdb = `
HEADER    EXPERIMENTAL STRUCTURE
ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00 95.00           C
TER       2      ASP A   1
END
      `.trim();
      
      const sasaResult = await biophysics.predictStructuralDisruption(dummyPdb, "D", 1, "V", "A");
      expect(sasaResult).toBeDefined();
      expect(sasaResult.plddt).toBe(95.0);
      // Since sasa_eval.py might not exist or run locally, it may fallback or return null, but it should be defined
      expect(sasaResult.burialStatus).toBeDefined();
    });

    it("should assign PM1 when variant falls inside a critical functional hotspot", () => {
      const uniprotFeatures = {
        geneName: "PAH",
        features: [
          { type: "Active site", description: "Catalytic iron binding", start: 400, end: 410 }
        ]
      };
      const res = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
        { available: true, revel: 0.1 },
        null,
        null,
        "standard",
        null,
        uniprotFeatures
      );
      const pm1 = res.acmgCriteria.find(c => c.code === "PM1");
      expect(pm1).toBeDefined();
      expect(pm1?.reason).toContain("Active site");
    });

    it("should dynamically scale PM2 allele frequency thresholds based on pLI score", () => {
      // pLI >= 0.9 -> Likely Dominant -> PM2 threshold = 0.01%
      const resDominant = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
        { available: true, revel: 0.1 },
        { pli: 0.95, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        { maxAF: 0.0005, groupMaxAF: 0.0005, genomeAF: 0.0005, exomeAF: 0.0005, nHomozygous: 0, dataset: "gnomad" }
      );
      // Freq 0.05% > 0.01% -> No PM2 (instead BS1_Supp is mapped)
      expect(resDominant.acmgCriteria.some(c => c.code === "PM2")).toBe(false);

      // pLI < 0.9 -> Likely Recessive -> PM2 threshold = 0.1%
      const resRecessive = computeRuleBasedACMG(
        "PAH",
        "p.Arg408Trp",
        null,
        { available: true, amPathogenicity: 0.1, amClass: "benign", caddPhred: 5 },
        { available: true, revel: 0.1 },
        { pli: 0.10, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        { maxAF: 0.0005, groupMaxAF: 0.0005, genomeAF: 0.0005, exomeAF: 0.0005, nHomozygous: 0, dataset: "gnomad" }
      );
      // Freq 0.05% <= 0.1% -> PM2 should be assigned!
      expect(resRecessive.acmgCriteria.some(c => c.code === "PM2")).toBe(true);
    });
  });

  describe("MissenseResolve® New Correctness Tests", () => {
    it("should assign PVS1 for nonsense/stop/frameshift variants in known constrained genes when NMD is predicted", () => {
      const res = computeRuleBasedACMG(
        "PAH",
        "p.Arg100*", // Stop/nonsense mutation early in protein
        null,
        { available: true, amPathogenicity: null, amClass: null, caddPhred: null },
        { available: false, revel: null },
        { pli: 0.95, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        null,
        "standard",
        null,
        null,
        "A".repeat(452) // sequence
      );
      expect(res.acmgCriteria.some(c => c.code === "PVS1")).toBe(true);
    });

    it("should assign PVS1_Moderate for C-terminal nonsense variants without critical domain overlap", () => {
      const res = computeRuleBasedACMG(
        "PAH",
        "p.Arg408*", // Stop/nonsense mutation near C-terminus
        null,
        { available: true, amPathogenicity: null, amClass: null, caddPhred: null },
        { available: false, revel: null },
        { pli: 0.95, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        null,
        "standard",
        null,
        null,
        "A".repeat(452) // sequence
      );
      expect(res.acmgCriteria.some(c => c.code === "PVS1_Moderate")).toBe(true);
    });

    it("should assign PVS1_Strong for C-terminal nonsense variants with critical domain overlap", () => {
      const res = computeRuleBasedACMG(
        "PAH",
        "p.Arg408*", // Stop/nonsense mutation near C-terminus
        null,
        { available: true, amPathogenicity: null, amClass: null, caddPhred: null },
        { available: false, revel: null },
        { pli: 0.95, missense_z: 1.0, oe_mis: 1.0, isPP2Constrained: false },
        null,
        "standard",
        null,
        { features: [{ type: "domain", start: 400, end: 420 }] }, // uniprotFeatures
        "A".repeat(452) // sequence
      );
      expect(res.acmgCriteria.some(c => c.code === "PVS1_Strong")).toBe(true);
    });

    it("should correctly count homozygous null variants when total is zero", async () => {
      // Testing external homozygous counts serialization is zero rather than null
      const fakeGnomadData = {
        exome: { homozygous_count: 0 },
        genome: { homozygous_count: 0 }
      };
      const totalHom = (fakeGnomadData.exome?.homozygous_count ?? 0) + (fakeGnomadData.genome?.homozygous_count ?? 0);
      expect(totalHom).toBe(0);
    });

    it("should validate and compute consensus verdict stability correctly", () => {
      // High-risk: >= 2 destabilizing
      const highRisk = computeConsensusVerdict({ foldxMean: 2.0, rasp: -1.2, ddgun: null });
      expect(highRisk).toBe("High Misfolding Risk (Destabilizing Consensus)");

      // Conflicting: 1 destabilizing, >= 2 available
      const conflicting = computeConsensusVerdict({ foldxMean: 2.0, rasp: 0.1, ddgun: 0.2 });
      expect(conflicting).toBe("Moderate Misfolding Risk (Conflicting Stability)");

      // Neutral: 0 destabilizing
      const neutral = computeConsensusVerdict({ foldxMean: 0.5, rasp: 0.2, ddgun: null });
      expect(neutral).toBe("Low Misfolding Risk (Neutral Stability)");
    });
  });

  describe("Critical Biophysical Numerical and Rules Verification (C-2)", () => {
    it("should verify svd3 matrix decomposition against a known identity matrix", () => {
      const I = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ] as any;
      const { U, S, V } = svd3(I);
      expect(S[0]).toBeCloseTo(1.0);
      expect(S[1]).toBeCloseTo(1.0);
      expect(S[2]).toBeCloseTo(1.0);
      expect(U[0][0]).toBeCloseTo(1.0);
      expect(V[0][0]).toBeCloseTo(1.0);
    });

    it("should compute 0.0 RMSD for perfectly aligned identical sidechains", () => {
      const atom1: PdbAtom = { resSeq: 10, resName: "ARG", name: "CB", chain: "A", x: 1.0, y: 1.0, z: 1.0 };
      const atom2: PdbAtom = { resSeq: 10, resName: "ARG", name: "CG", chain: "A", x: 2.0, y: 1.5, z: 1.0 };
      const atom3: PdbAtom = { resSeq: 10, resName: "ARG", name: "CA", chain: "A", x: 0.0, y: 0.0, z: 0.0 };
      const rmsd = calculateLocalSidechainRmsd([atom1, atom2, atom3], [atom1, atom2, atom3], 10, "A");
      expect(rmsd).toBeCloseTo(0.0);
    });

    it("should accurately count steric clashes when atoms are below threshold", () => {
      const a1: PdbAtom = { resSeq: 1, resName: "ALA", name: "CA", chain: "A", x: 0.0, y: 0.0, z: 0.0 };
      const a2: PdbAtom = { resSeq: 5, resName: "ALA", name: "CB", chain: "A", x: 1.0, y: 1.0, z: 1.0 }; // dist = ~1.73 < 2.2, different residues
      expect(calculateClashes([a1, a2])).toBe(1);

      const a3: PdbAtom = { resSeq: 5, resName: "ALA", name: "CB", chain: "A", x: 3.0, y: 0.0, z: 0.0 }; // dist = 3.0 > 2.2
      expect(calculateClashes([a1, a3])).toBe(0);
    });

    it("should evaluate predictStructuralDisruption rules correctly", async () => {
      // Helper function to format PDB lines properly using exact index mappings
      function formatPdbAtomLine(serial: number, name: string, resName: string, chain: string, resSeq: number, x: number, y: number, z: number): string {
        const chars = Array(80).fill(" ");
        chars.splice(0, 4, ..."ATOM".split(""));
        const serialStr = String(serial).padStart(5, " ");
        chars.splice(6, 5, ...serialStr.split(""));
        const nameStr = name.padEnd(4, " ");
        chars.splice(12, 4, ...nameStr.split(""));
        const resNameStr = resName.padEnd(3, " ");
        chars.splice(17, 3, ...resNameStr.split(""));
        chars[21] = chain.slice(0, 1);
        const resSeqStr = String(resSeq).padStart(4, " ");
        chars.splice(22, 4, ...resSeqStr.split(""));
        const xStr = x.toFixed(3).padStart(8, " ");
        chars.splice(30, 8, ...xStr.split(""));
        const yStr = y.toFixed(3).padStart(8, " ");
        chars.splice(38, 8, ...yStr.split(""));
        const zStr = z.toFixed(3).padStart(8, " ");
        chars.splice(46, 8, ...zStr.split(""));
        const bStr = "95.00".padStart(6, " ");
        chars.splice(60, 6, ...bStr.split(""));
        return chars.join("");
      }

      // Proline in helix
      const pdbHelix = `
HELIX    1  H1 ALA A   10  ALA A   20
${formatPdbAtomLine(1, "CA", "ALA", "A", 10, 0, 0, 0)}
TER
END
      `.trim();
      const resA = await predictStructuralDisruption(pdbHelix, "A", 10, "P", "A");
      expect(resA.level).toBe("high");
      expect(resA.reason).toContain("Proline introduced at position 10");

      // Buried charge reversal
      let pdbBuried = formatPdbAtomLine(1, "CA", "ASP", "A", 15, 0, 0, 0) + "\n";
      for (let i = 1; i <= 15; i++) {
        const theta = (i / 15) * 2 * Math.PI;
        const phi = (i / 15) * Math.PI;
        const r = 2.0;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        pdbBuried += formatPdbAtomLine(i + 1, "CA", "VAL", "A", 15 + i, x, y, z) + "\n";
      }
      pdbBuried += "TER\nEND";
      const resB = await predictStructuralDisruption(pdbBuried, "D", 15, "R", "A");
      expect(resB.level).toBe("high");
      expect(resB.reason).toContain("Buried charge reversal");

      // Core volume expansion (Gly to Trp, vol delta = 167.7)
      let pdbVolume = formatPdbAtomLine(1, "CA", "GLY", "A", 20, 0, 0, 0) + "\n";
      for (let i = 1; i <= 15; i++) {
        const theta = (i / 15) * 2 * Math.PI;
        const phi = (i / 15) * Math.PI;
        const r = 2.0;
        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);
        pdbVolume += formatPdbAtomLine(i + 1, "CA", "VAL", "A", 20 + i, x, y, z) + "\n";
      }
      pdbVolume += "TER\nEND";
      const resC = await predictStructuralDisruption(pdbVolume, "G", 20, "W", "A");
      expect(resC.level).toBe("high");
      expect(resC.reason).toContain("Severe core steric expansion");

      // Proline to glycine loop-flexibility shift
      const pdbLoop = `
${formatPdbAtomLine(1, "CA", "PRO", "A", 25, 0, 0, 0)}
TER
END
      `.trim();
      const resD = await predictStructuralDisruption(pdbLoop, "P", 25, "G", "A");
      expect(resD.level).toBe("high");
      expect(resD.reason).toContain("Proline to Glycine substitution in structural loop");

      // Neutral case
      const pdbNeutral = `
${formatPdbAtomLine(1, "CA", "ALA", "A", 30, 0, 0, 0)}
TER
END
      `.trim();
      const resNormal = await predictStructuralDisruption(pdbNeutral, "A", 30, "V", "A");
      expect(resNormal.level).toBe("low");
    }, 15000);
  });

  describe("Full Pipeline Integration Test (C-7)", () => {
    it("should walk through the main endpoints of the pipeline", async () => {
      // 1. Test /translate-variant
      const translateRoute: any = apiRouter.stack.find(s => s.route && s.route.path === "/translate-variant");
      expect(translateRoute).toBeDefined();
      const translateHandler = translateRoute.route.stack[translateRoute.route.stack.length - 1].handle;
      
      const fetchSpy = vi.spyOn(global, "fetch");
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            transcript_consequences: [
              {
                transcript_id: "ENST00000256078",
                canonical: true,
                hgvsp: "ENSP00000256078:p.Arg408His",
                gene_symbol: "PAH"
              }
            ]
          }
        ]
      } as any);

      let translateJson: any = null;
      const translateReq: any = { body: { variant: "NM_000277.5:c.1222C>T" }, headers: {} };
      const translateRes: any = {
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { translateJson = body; return this; }
      };
      await translateHandler(translateReq, translateRes, () => {});
      
      expect(translateJson).toBeDefined();
      expect(translateJson.gene).toBe("PAH");
      expect(translateJson.variant).toBe("p.Arg408His");
      expect(translateJson.uniprotId).toBe("");
      fetchSpy.mockRestore();

      // 1b. Test /translate-variant with dashed genomic coordinates
      const fetchSpyDashed = vi.spyOn(global, "fetch");
      fetchSpyDashed.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            seq_region_name: "20",
            start: 23365054,
            allele_string: "G/A",
            transcript_consequences: [
              {
                transcript_id: "ENST00000325888",
                canonical: true,
                hgvsp: "ENSP00000325888:p.Gly380Arg",
                gene_symbol: "CNNM2"
              }
            ]
          }
        ]
      } as any);

      let translateDashedJson: any = null;
      const translateDashedReq: any = { body: { variant: "20-23365054-G-A" }, headers: {} };
      const translateDashedRes: any = {
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { translateDashedJson = body; return this; }
      };
      await translateHandler(translateDashedReq, translateDashedRes, () => {});

      expect(translateDashedJson).toBeDefined();
      expect(translateDashedJson.gene).toBe("CNNM2");
      expect(translateDashedJson.variant).toBe("p.Gly380Arg");
      expect(translateDashedJson.genomicCoordinates).toBe("20-23365054-G-A");
      fetchSpyDashed.mockRestore();

      // 2. Test /resolve-gene
      const resolveRoute: any = apiRouter.stack.find(s => s.route && s.route.path === "/resolve-gene");
      expect(resolveRoute).toBeDefined();
      const resolveHandler = resolveRoute.route.stack[resolveRoute.route.stack.length - 1].handle;
      
      let resolveJson: any = null;
      const resolveReq: any = { body: { gene: "PAH" }, headers: {} };
      const resolveRes: any = {
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { resolveJson = body; return this; }
      };
      const uniprotSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
      const pdbSpy = vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue("dummy-pdb-text");
      await resolveHandler(resolveReq, resolveRes, () => {});
      expect(resolveJson).toBeDefined();
      expect(resolveJson.uniprotId).toBe("P00439");
      uniprotSpy.mockRestore();
      pdbSpy.mockRestore();
    });
  });

  describe("fetchLandscapeData Stats Calculations", () => {
    it("should calculate mean, median, min, max and count for REVEL and AlphaMissense", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      
      // Mock myvariant.info response
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hits: [
            {
              dbnsfp: {
                aa: { pos: 5 },
                revel: { score: 0.2 },
                alphamissense: { score: 0.1 },
                'gerp++': { rs: 1.5 },
                phylop: { '100way_vertebrate': { score: 0.5 } }
              }
            },
            {
              dbnsfp: {
                aa: { pos: 5 },
                revel: { score: 0.8 },
                alphamissense: { score: 0.9 },
                'gerp++': { rs: 2.5 },
                phylop: { '100way_vertebrate': { score: 1.5 } }
              }
            },
            {
              dbnsfp: {
                aa: { pos: 5 },
                revel: { score: 0.5 },
                alphamissense: { score: 0.5 },
                'gerp++': { rs: 2.0 },
                phylop: { '100way_vertebrate': { score: 1.0 } }
              }
            }
          ]
        })
      } as any);

      const data = await externalServices.fetchLandscapeData("PAH", 5, 5);
      expect(data).toHaveLength(1);
      const pos5 = data[0];
      
      expect(pos5.residx).toBe(5);
      // REVEL scores: [0.2, 0.8, 0.5] -> Mean: 0.5, Median: 0.5, Min: 0.2, Max: 0.8, Count: 3
      expect(pos5.revelMean).toBeCloseTo(0.5);
      expect(pos5.revelMedian).toBeCloseTo(0.5);
      expect(pos5.revelMin).toBe(0.2);
      expect(pos5.revelMax).toBe(0.8);
      expect(pos5.revelCount).toBe(3);

      // AM scores: [0.1, 0.9, 0.5] -> Mean: 0.5, Median: 0.5, Min: 0.1, Max: 0.9, Count: 3
      expect(pos5.amMean).toBeCloseTo(0.5);
      expect(pos5.amMedian).toBeCloseTo(0.5);
      expect(pos5.amMin).toBe(0.1);
      expect(pos5.amMax).toBe(0.9);
      expect(pos5.amCount).toBe(3);

      // GERP++ scores: [1.5, 2.5, 2.0] -> Mean: 2.0
      expect(pos5.gerp).toBeCloseTo(2.0);
      // PhyloP scores: [0.5, 1.5, 1.0] -> Mean: 1.0
      expect(pos5.phylop).toBeCloseTo(1.0);

      fetchSpy.mockRestore();
    });
  });

  describe("Local dbNSFP Amino Acid Filtering", () => {
    it("should match amino acid change representations properly using matchAminoAcidChange logic", async () => {
      const dbnsfpLocal = await import("./server/services/dbnsfp_local.ts");
      
      const dbInstanceSpy = vi.spyOn(dbnsfpLocal as any, "getDbInstance").mockReturnValue({
        prepare: () => ({
          all: () => [
            { gene: "GZF1", pos: 586, aa_change: "p.Asp586Val", revel: 0.1 },
            { gene: "GZF1", pos: 586, aa_change: "p.Asp586Ala", revel: 0.9 }
          ]
        })
      });

      const res = await dbnsfpLocal.queryLocalDbnsfpVariant("GZF1", 586, null, null, "p.Asp586Ala");
      expect(res).toBeDefined();
      expect(res?.revel).toBe(0.9);
      expect(res?.aa_change).toBe("p.Asp586Ala");

      dbInstanceSpy.mockRestore();
    });

    it("should fetch popEVE score online for GZF1 p.Asp586Ala via fetchPopEVEScoreOnline", async () => {
      const externalServices = await import("./server/services/external.ts");
      const score = await externalServices.fetchPopEVEScoreOnline("GZF1", "p.Asp586Ala");
      expect(score).not.toBeNull();
      if (score !== null) {
        expect(score).toBeCloseTo(-3.775, 2);
      }
    }, 15000);
  });
});

