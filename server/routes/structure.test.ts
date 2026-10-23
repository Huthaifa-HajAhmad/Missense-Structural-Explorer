import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../routes.ts";
import * as externalServices from "../services/external.ts";
import { PUBLIC_ENDPOINTS } from "./state.ts";
import { CONFIG } from "../config.ts";
import {
  clearStructureReferences,
  registerStructureReference,
  resolveStructureReference,
} from "../services/structure/structure-reference-store.ts";
import { isStructureRef, STRUCTURE_REF_HEADER, STRUCTURE_REF_MAX_PDB_CHARS } from "../../src/shared/structureRefs.ts";
import { ALPHAFOLD_ABSENCE_HEADER } from "../../src/shared/alphafoldAvailability.ts";

describe("Structure Routes (/alphafold-pdb and /pdb/entry)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /alphafold-pdb/:uniprotId", () => {
    const route = apiRouter.stack.find(s => s.route && s.route.path === "/alphafold-pdb/:uniprotId");
    expect(route).toBeDefined();
    const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;

    it("should return 400 BAD_REQUEST for invalid UniProt ID format", async () => {
      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = { params: { uniprotId: "invalid_id_!!!" } };
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          jsonVal = data;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(statusCode).toBe(400);
      expect(jsonVal?.error?.code).toBe("BAD_REQUEST");
    });

    it("should return 404 NOT_FOUND if AlphaFold DB does not have the model", async () => {
      vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue(null);
      // Length within the database's ceiling: the absence is unexplained, not a property of the protein.
      vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("M".repeat(534));

      const headers: Record<string, string> = {};
      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = { params: { uniprotId: "Q9H8M5" } };
      const res: any = {
        setHeader(name: string, value: string) { headers[name] = value; return this; },
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          jsonVal = data;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(statusCode).toBe(404);
      expect(jsonVal?.error?.code).toBe("NOT_FOUND");
      expect(headers[ALPHAFOLD_ABSENCE_HEADER]).toBeUndefined();
      expect(jsonVal?.error?.message).toBe("Could not retrieve AlphaFold DB model for accession: Q9H8M5.");
    });

    it("explains and marks the 404 when the protein is past AlphaFold DB's single-chain ceiling", async () => {
      // PKD1 (P98161) is 4,302 aa; AlphaFold DB models single chains up to 2,700 aa, so this route
      // could never have answered. The marker is what lets the client record the expected absence
      // instead of a degraded network call.
      vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue(null);
      vi.spyOn(externalServices, "fetchUniprotSequence").mockResolvedValue("M".repeat(4302));

      const headers: Record<string, string> = {};
      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = { params: { uniprotId: "P98161" } };
      const res: any = {
        setHeader(name: string, value: string) { headers[name] = value; return this; },
        status(code: number) { statusCode = code; return this; },
        json(data: any) { jsonVal = data; return this; },
      };

      await handler(req, res, () => {});

      expect(statusCode).toBe(404);
      expect(headers[ALPHAFOLD_ABSENCE_HEADER]).toBe("beyond-length-limit");
      expect(jsonVal?.error?.code).toBe("NOT_FOUND");
      expect(jsonVal?.error?.message).toContain("no full-length model for P98161");
      expect(jsonVal?.error?.message).toContain("4,302 aa");
      expect(jsonVal?.error?.message).toContain("2,700 aa");
    });

    it("leaves the 404 unmarked when the length cannot be read", async () => {
      // An unreadable length is not evidence of an absence; the generic 404 must stand rather than
      // silence a real upstream failure.
      vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue(null);
      vi.spyOn(externalServices, "fetchUniprotSequence").mockRejectedValue(new Error("UniProt unavailable"));

      const headers: Record<string, string> = {};
      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = { params: { uniprotId: "P98161" } };
      const res: any = {
        setHeader(name: string, value: string) { headers[name] = value; return this; },
        status(code: number) { statusCode = code; return this; },
        json(data: any) { jsonVal = data; return this; },
      };

      await handler(req, res, () => {});

      expect(statusCode).toBe(404);
      expect(headers[ALPHAFOLD_ABSENCE_HEADER]).toBeUndefined();
      expect(jsonVal?.error?.message).toContain("Could not retrieve AlphaFold DB model");
    });

    it("should serve AlphaFold PDB text with correct headers when available", async () => {
      const mockPdb = "ATOM      1  N   MET A   1      27.340  24.430   2.614  1.00 95.40           N\n";
      vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue(mockPdb);
      vi.spyOn(externalServices, "getResolvedAlphafoldVersion").mockReturnValue("v6");

      const headers: Record<string, string> = {};
      let sentBody: string = "";
      const req: any = { params: { uniprotId: "Q9H8M5" } };
      const res: any = {
        setHeader(name: string, value: string) {
          headers[name] = value;
          return this;
        },
        send(body: any) {
          sentBody = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(headers["Content-Type"]).toBe("text/plain");
      expect(headers["X-Template-Source"]).toBe("alphafold");
      expect(headers["X-Template-AfdbVersion"]).toBe("v6");
      expect(sentBody).toBe(mockPdb);
    });
  });

  describe("GET /pdb/entry/:pdbId", () => {
    const route = apiRouter.stack.find(s => s.route && s.route.path === "/pdb/entry/:pdbId");
    expect(route).toBeDefined();
    const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;

    it("should return 400 for invalid 4-char PDB ID", async () => {
      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = { params: { pdbId: "12" } };
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          jsonVal = data;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(statusCode).toBe(400);
      expect(jsonVal?.error?.code).toBe("BAD_REQUEST");
    });

    it("should return 200 with experimental headers for valid PDB entry", async () => {
      const mockPdb = "ATOM      1  N   VAL A 429      12.120  15.340  -5.210  1.00 25.00           N\n";
      vi.spyOn(externalServices, "fetchFullPdbEntry").mockResolvedValue(mockPdb);

      const headers: Record<string, string> = {};
      let sentBody: string = "";
      const req: any = { params: { pdbId: "6N7E" } };
      const res: any = {
        setHeader(name: string, value: string) {
          headers[name] = value;
          return this;
        },
        send(body: any) {
          sentBody = body;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(headers["Content-Type"]).toBe("text/plain");
      expect(headers["X-Template-Source"]).toBe("experimental");
      expect(headers["X-Template-PdbId"]).toBe("6N7E");
      expect(headers["X-Entry-Numbering"]).toBe("author");
      expect(sentBody).toBe(mockPdb);
    });

    it("returns the mapped chain in UniProt numbering, and says so in its headers", async () => {
      const chainPdb = "ATOM      1  CA  ASP B 116      12.120  15.340  -5.210  1.00 25.00           C\n";
      const spy = vi.spyOn(externalServices, "fetchEntryForVariant").mockResolvedValue({
        pdbText: chainPdb, numbering: "uniprot", chainId: "B", mapping: "sifts", unmappedResidues: 6, reason: null,
      });
      const headers: Record<string, string> = {};
      let sentBody = "";
      const req: any = { params: { pdbId: "9qn5" }, query: { uniprot: "Q13564", pos: "116", wt: "d" } };
      const res: any = {
        setHeader(name: string, value: string) { headers[name] = value; return this; },
        send(body: any) { sentBody = body; return this; },
      };
      await handler(req, res, () => {});
      expect(spy).toHaveBeenCalledWith("9QN5", "Q13564", 116, "D");
      expect(headers["X-Entry-Numbering"]).toBe("uniprot");
      expect(headers["X-Entry-Chain"]).toBe("B");
      expect(headers["X-Entry-Mapping"]).toBe("sifts");
      expect(headers["X-Entry-Unmapped"]).toBe("6");
      expect(headers["X-Entry-Reason"]).toBeUndefined();
      expect(sentBody).toBe(chainPdb);
    });

    it("sends the reason, URI-encoded, when the entry keeps its own numbering", async () => {
      vi.spyOn(externalServices, "fetchEntryForVariant").mockResolvedValue({
        pdbText: "ATOM\n", numbering: "author", chainId: null, mapping: null, unmappedResidues: null, reason: "No chain of 9QN5 carries D116 under a verified mapping to Q13564.",
      });
      const headers: Record<string, string> = {};
      const req: any = { params: { pdbId: "9QN5" }, query: { uniprot: "Q13564", pos: "116", wt: "D" } };
      const res: any = { setHeader(name: string, value: string) { headers[name] = value; return this; }, send() { return this; } };
      await handler(req, res, () => {});
      expect(headers["X-Entry-Numbering"]).toBe("author");
      expect(headers["X-Entry-Unmapped"]).toBeUndefined();
      expect(decodeURIComponent(headers["X-Entry-Reason"])).toBe("No chain of 9QN5 carries D116 under a verified mapping to Q13564.");
    });

    it("rejects a malformed position or residue with 400", async () => {
      let statusCode = 200;
      const req: any = { params: { pdbId: "9QN5" }, query: { uniprot: "Q13564", pos: "116", wt: "Asp" } };
      const res: any = { status(code: number) { statusCode = code; return this; }, json() { return this; } };
      await handler(req, res, () => {});
      expect(statusCode).toBe(400);
    });
  });

  describe("structure references issued with served PDB text", () => {
    beforeEach(() => {
      clearStructureReferences();
    });

    const mockPdb = "ATOM      1  N   VAL A 429      12.120  15.340  -5.210  1.00 25.00           N\n";

    it("announces a reference on /pdb/:uniprotId that resolves to exactly the served bytes", async () => {
      const resolver = await import("../services/structure-resolver.ts");
      vi.spyOn(resolver, "resolveStructure").mockResolvedValue({
        pdbText: mockPdb,
        provenance: { source: "experimental", pdbId: "6N7E", chainId: "A" },
      } as any);

      const route = apiRouter.stack.find(s => s.route && s.route.path === "/pdb/:uniprotId");
      expect(route).toBeDefined();
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;

      const headers: Record<string, string> = {};
      let sentBody = "";
      const req: any = { params: { uniprotId: "P00439" }, query: {} };
      const res: any = {
        setHeader(name: string, value: string) { headers[name] = value; return this; },
        send(body: any) { sentBody = body; return this; },
      };

      await handler(req, res, () => {});

      const ref = headers[STRUCTURE_REF_HEADER];
      expect(isStructureRef(ref)).toBe(true);
      // The reference names the bytes that were actually sent — that is what makes a later
      // pocket/nearest call about the same structure, with no upload and no re-resolution.
      expect(resolveStructureReference(ref)?.pdbText).toBe(mockPdb);
      expect(sentBody).toBe(mockPdb);
    });

    it("announces a reference on /alphafold-pdb/:uniprotId", async () => {
      vi.spyOn(externalServices, "fetchAlphafoldPdb").mockResolvedValue(mockPdb);
      vi.spyOn(externalServices, "getResolvedAlphafoldVersion").mockReturnValue("v6");

      const route = apiRouter.stack.find(s => s.route && s.route.path === "/alphafold-pdb/:uniprotId");
      const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;

      const headers: Record<string, string> = {};
      const req: any = { params: { uniprotId: "Q9H8M5" } };
      const res: any = {
        setHeader(name: string, value: string) { headers[name] = value; return this; },
        send() { return this; },
      };

      await handler(req, res, () => {});

      const ref = headers[STRUCTURE_REF_HEADER];
      expect(isStructureRef(ref)).toBe(true);
      expect(resolveStructureReference(ref)?.pdbText).toBe(mockPdb);
      expect(resolveStructureReference(ref)?.identity.afdbVersion).toBe("v6");
    });

    it("refuses to mint a reference for text that cannot be referenced", () => {
      // Empty text, and text past the same 5 MB ceiling the routes enforce: a reference that named
      // either would be useless at best, and at worst an unbounded retention of a rejected payload.
      expect(registerStructureReference("", { origin: "server" })).toBeNull();
      expect(
        registerStructureReference("A".repeat(STRUCTURE_REF_MAX_PDB_CHARS + 1), { origin: "server" })
      ).toBeNull();
    });
  });

  describe("GET /sidecar-health", () => {    const route = apiRouter.stack.find(s => s.route && s.route.path === "/sidecar-health");
    expect(route).toBeDefined();
    const handler = route!.route!.stack[route!.route!.stack.length - 1].handle;

    it("should be whitelisted in PUBLIC_ENDPOINTS for unauthenticated client health checks", () => {
      expect(PUBLIC_ENDPOINTS).toContain("/sidecar-health");
      expect(PUBLIC_ENDPOINTS).toContain("/api/v1/sidecar-health");
    });

    it("should return reachable true and model info when sidecar /health responds successfully", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "healthy", model_loaded: true, active_models: 2 })
      });
      vi.stubGlobal("fetch", fetchMock);

      let jsonVal: any = null;
      const req: any = {};
      const res: any = {
        json(data: any) {
          jsonVal = data;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(jsonVal.reachable).toBe(true);
      expect(jsonVal.status).toBe("healthy");
      expect(jsonVal.modelLoaded).toBe(true);
      expect(jsonVal.activeModels).toBe(2);
      expect(jsonVal.latencyMs).toBeTypeOf("number");
    });

    it("should return reachable false with HTTP status code when sidecar returns HTTP 500 error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      });
      vi.stubGlobal("fetch", fetchMock);

      let jsonVal: any = null;
      const req: any = {};
      const res: any = {
        json(data: any) {
          jsonVal = data;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(jsonVal.reachable).toBe(false);
      expect(jsonVal.error).toBe("Sidecar returned HTTP 500");
      expect(jsonVal.remediation?.local).toContain("tools/model_server.py");
      expect(jsonVal.remediation?.oci).toContain("SIDECAR_URL");
    });

    it("should return reachable false with timeout error when sidecar fetch times out", async () => {
      const abortError = new Error("The operation was aborted due to timeout");
      abortError.name = "TimeoutError";
      const fetchMock = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal("fetch", fetchMock);

      let jsonVal: any = null;
      const req: any = {};
      const res: any = {
        json(data: any) {
          jsonVal = data;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(jsonVal.reachable).toBe(false);
      expect(jsonVal.error).toContain("aborted due to timeout");
      expect(jsonVal.remediation?.local).toContain("tools/model_server.py");
    });

    it("should return reachable false with remediation commands when sidecar is offline", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
      vi.stubGlobal("fetch", fetchMock);

      let jsonVal: any = null;
      const req: any = {};
      const res: any = {
        json(data: any) {
          jsonVal = data;
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(jsonVal.reachable).toBe(false);
      expect(jsonVal.error).toContain("fetch failed");
      expect(jsonVal.remediation?.local).toContain("tools/model_server.py");
      expect(jsonVal.remediation?.oci).toContain("SIDECAR_URL");
    });

    it("should suppress baseUrl in production mode to prevent private IP disclosure", async () => {
      const originalIsProd = CONFIG.server.isProduction;
      try {
        (CONFIG.server as any).isProduction = true;
        const fetchMock = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ status: "healthy", model_loaded: true, active_models: 1 })
        });
        vi.stubGlobal("fetch", fetchMock);

        let jsonVal: any = null;
        const req: any = {};
        const res: any = {
          json(data: any) {
            jsonVal = data;
            return this;
          }
        };

        await handler(req, res, () => {});
        expect(jsonVal.reachable).toBe(true);
        expect(jsonVal.baseUrl).toBeUndefined();
      } finally {
        (CONFIG.server as any).isProduction = originalIsProd;
      }
    });

    it("should sanitize error message in production mode to prevent private IP disclosure", async () => {
      const originalIsProd = CONFIG.server.isProduction;
      try {
        (CONFIG.server as any).isProduction = true;
        const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.1.45:8000"));
        vi.stubGlobal("fetch", fetchMock);

        let jsonVal: any = null;
        const req: any = {};
        const res: any = {
          json(data: any) {
            jsonVal = data;
            return this;
          }
        };

        await handler(req, res, () => {});
        expect(jsonVal.reachable).toBe(false);
        expect(jsonVal.error).not.toContain("10.0.1.45");
        expect(jsonVal.error).toBe("Model server sidecar connection unavailable");
      } finally {
        (CONFIG.server as any).isProduction = originalIsProd;
      }
    });
  });

  describe("POST /esmfold", () => {
    const esmfoldRoute: any = apiRouter.stack.find(
      (s: any) => s.route && (s.route.path === "/esmfold" || (Array.isArray(s.route.path) && s.route.path.includes("/esmfold")))
    );
    expect(esmfoldRoute).toBeDefined();
    const handler = esmfoldRoute.route.stack[esmfoldRoute.route.stack.length - 1].handle;

    it("rejects sequences exceeding 1,024 residues without token with 422 UNPROCESSABLE_ENTITY", async () => {
      let statusCode = 0;
      let errorBody: any = null;
      const longSeq = "M".repeat(1025);
      const req: any = {
        body: { sequence: longSeq },
        headers: {}
      };
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          errorBody = data;
          return this;
        }
      };

      await handler(req, res);
      expect(statusCode).toBe(422);
      expect(errorBody?.error?.code).toBe("UNPROCESSABLE_ENTITY");
      expect(errorBody?.error?.message).toContain("1,024 aa");
      expect(errorBody?.error?.message).toContain("400 aa");
    });
  });

  describe("POST /structure/multimer", () => {
    it("rejects request with 400 if required fields are invalid or missing", async () => {
      const multimerRoute: any = apiRouter.stack.find(
        (s: any) => s.route && (s.route.path === "/structure/multimer" || (Array.isArray(s.route.path) && s.route.path.includes("/structure/multimer")))
      );
      expect(multimerRoute).toBeDefined();

      const handler = multimerRoute.route.stack[multimerRoute.route.stack.length - 1].handle;
      let statusCode = 0;
      let errorBody: any = null;
      const req: any = { body: { gene: "PAH", variant: "invalid" } }; // missing uniprotId
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          errorBody = data;
          return this;
        }
      };

      await handler(req, res);
      expect(statusCode).toBe(400);
      expect(errorBody?.error?.code).toBe("BAD_REQUEST");
    });
  });

  describe("POST /ppi/binding-affinity", () => {
    it("rejects request if gene or variant missing", async () => {
      const ppiRoute: any = apiRouter.stack.find(
        (s: any) => s.route && (s.route.path === "/ppi/binding-affinity" || (Array.isArray(s.route.path) && s.route.path.includes("/ppi/binding-affinity")))
      );
      expect(ppiRoute).toBeDefined();

      const handler = ppiRoute.route.stack[ppiRoute.route.stack.length - 1].handle;
      let statusCode = 0;
      let errorBody: any = null;
      const req: any = { body: { gene: "PAH" } };
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          errorBody = data;
          return this;
        }
      };

      await handler(req, res);
      expect(statusCode).toBe(400);
      expect(errorBody?.error?.code).toBe("BAD_REQUEST");
    });

    it("rejects a binding-shift request with fewer than two chains", async () => {
      // The binding change is computed on a wild-type complex of the modelled chains; a single chain
      // has no partner to bind. (Replaces the old chainA/chainB check: this route no longer takes PDBs.)
      const shiftRoute: any = apiRouter.stack.find(
        (s: any) => s.route && Array.isArray(s.route.path) && s.route.path.includes("/ppi/binding-shift")
      );
      const handler = shiftRoute.route.stack[shiftRoute.route.stack.length - 1].handle;
      let statusCode = 0;
      let errorBody: any = null;
      const req: any = {
        body: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", chains: [{ id: "A", accession: "Q13564" }] }
      };
      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(data: any) {
          errorBody = data;
          return this;
        }
      };

      await handler(req, res);
      expect(statusCode).toBe(400);
      expect(errorBody?.error?.message).toContain("at least two chains");
    });
  });
});
