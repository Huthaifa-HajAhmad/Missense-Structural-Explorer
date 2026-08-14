import { describe, it, expect } from "vitest";
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
  sanitizeErrorMessage
} from "./utils.ts";
import { requestLogger } from "./middleware.ts";

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
      expect(() => validateGene(123 as any)).toThrow("Gene symbol must be a non-empty string.");
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
      expect(() => validateVariant(null as any)).toThrow("Variant must be a non-empty string.");
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
      expect(() => validateUniProt(undefined as any)).toThrow("UniProt accession ID must be a non-empty string.");
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

  describe("Strict IUPAC validations and synonymous / non-missense checks", () => {
    it("should reject synonymous variants", () => {
      expect(() => validateVariant("p.Arg215Arg")).toThrow("Synonymous variant detected");
      expect(() => validateVariant("Arg215Arg")).toThrow("Synonymous variant detected");
    });

    it("should reject nonsense variants with informative domain error", () => {
      expect(() => validateVariant("p.Glu289Ter")).toThrow("Nonsense / stop-gain variant detected");
      expect(() => validateVariant("p.E289*")).toThrow("Nonsense / stop-gain variant detected");
      expect(() => validateVariant("p.Trp123Stop")).toThrow("Nonsense / stop-gain variant detected");
      expect(() => validateVariant("E289X")).toThrow("Nonsense / stop-gain variant detected");
    });

    it("should reject frameshift variants with informative domain error", () => {
      expect(() => validateVariant("p.Lys123fs")).toThrow("Frameshift variant detected");
      expect(() => validateVariant("p.Gly45Argfs*12")).toThrow("Frameshift variant detected");
    });

    it("should reject insertion/deletion variants with informative domain error", () => {
      expect(() => validateVariant("p.Glu289del")).toThrow("Insertion/deletion variant detected");
      expect(() => validateVariant("p.Ala12_Gly13insVal")).toThrow("Insertion/deletion variant detected");
      expect(() => validateVariant("p.Pro4dup")).toThrow("Insertion/deletion variant detected");
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

  describe("sanitizeErrorMessage Unit Tests", () => {
    it("should preserve legitimate operational and connection diagnostic messages", () => {
      expect(sanitizeErrorMessage("timeout connecting to EBI API")).toBe("timeout connecting to EBI API");
      expect(sanitizeErrorMessage("Connection refused by localhost:8000")).toBe("Connection refused by localhost:8000");
      expect(sanitizeErrorMessage("Failed to fetch from Ensembl")).toBe("Reference database query failed. Please verify the connection or try again later.");
      expect(sanitizeErrorMessage("ClinVar API returned status 503")).toBe("ClinVar API returned status 503");
    });

    it("should systematically rewrite sensitive or code-level errors to generic messages", () => {
      expect(sanitizeErrorMessage("ENOENT: no such file or directory, open 'secrets.json'"))
        .toBe("A system-level resource is temporarily unavailable.");
      expect(sanitizeErrorMessage("Unexpected token < in JSON at position 0"))
        .toBe("Data format mismatch when retrieving reference database details.");
      expect(sanitizeErrorMessage("ACMG classification rule violation at index 5"))
        .toBe("Evaluation algorithm encountered an internal data processing mismatch.");
      expect(sanitizeErrorMessage("SELECT * FROM users WHERE id = 12"))
        .toBe("An internal server error occurred while processing the request.");
    });
  });

  describe("requestLogger middleware", () => {
    it("should generate a request ID if none is provided", () => {
      let headers: Record<string, string> = {};
      const req: any = { headers };
      let responseHeaders: Record<string, string> = {};
      const res: any = {
        setHeader(name: string, val: string) {
          responseHeaders[name] = val;
        },
        on(event: string, callback: () => void) {}
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
      const req: any = { headers };
      let responseHeaders: Record<string, string> = {};
      const res: any = {
        setHeader(name: string, val: string) {
          responseHeaders[name] = val;
        },
        on(event: string, callback: () => void) {}
      };
      const next = () => {};
      
      requestLogger(req, res, next);
      expect(req.headers["x-request-id"]).toBe("preset-req-id");
      expect(responseHeaders["X-Request-ID"]).toBe("preset-req-id");
    });
  });
});
