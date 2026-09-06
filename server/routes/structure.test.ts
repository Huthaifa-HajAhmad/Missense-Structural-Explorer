import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../routes.ts";
import * as externalServices from "../services/external.ts";

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
  });
});
