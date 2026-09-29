import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../routes.ts";
import * as externalServices from "../services/external.ts";
import { PUBLIC_ENDPOINTS } from "./state.ts";
import { CONFIG } from "../config.ts";

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

      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = { params: { uniprotId: "Q9H8M5" } };
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
      expect(statusCode).toBe(404);
      expect(jsonVal?.error?.code).toBe("NOT_FOUND");
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
      expect(sentBody).toBe(mockPdb);
    });
  });

  describe("GET /sidecar-health", () => {
    const route = apiRouter.stack.find(s => s.route && s.route.path === "/sidecar-health");
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
