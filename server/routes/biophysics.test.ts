import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiRouter } from "../routes.ts";
import { clearAllCaches } from "../services/cache.ts";
import { BiophysicalJobQueue } from "../services/biophysical-queue.ts";
import { clearInFlightRemoteSubmissions } from "./biophysics/generation.ts";

describe("Biophysics Route Endpoints & Helper Unit Tests", () => {
  beforeEach(() => {
    clearAllCaches();
    clearInFlightRemoteSubmissions();
    try {
      BiophysicalJobQueue.initialize(2, async () => ({}));
    } catch (_) {}
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

  describe("/analyze-variant-biophysical endpoint", () => {
    it("should return biophysical narrative from Gemini successfully", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant-biophysical");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /analyze-variant-biophysical not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const geminiServices = await import("../services/gemini.ts");
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

      const geminiServices = await import("../services/gemini.ts");
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

    it("should serve directly from cache on subsequent requests", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/analyze-variant-biophysical");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /analyze-variant-biophysical not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const geminiServices = await import("../services/gemini.ts");
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

      await handler(req, res2, () => {});
      expect(geminiSpy).not.toHaveBeenCalled();
      expect(secondJsonVal.biochemicalShift).toBe("mock cache shift");

      geminiSpy.mockRestore();
    });
  });

  describe("retired Phase 6 stability endpoints and synchronous /thermompnn-submit", () => {
    it("unregisters retired DynaMut2, DDMut, Tamarind, and ThermoMPNN polling routes", () => {
      for (const path of ["/dynamut2-submit", "/ddmut-submit", "/dynamut2-job/:jobId", "/ddmut-job/:jobId", "/thermompnn-job/:jobId", "/test-tamarind-connection"]) {
        expect(apiRouter.stack.find(s => s.route && s.route.path === path), `${path} should be removed`).toBeUndefined();
      }
    });

    it("rejects wild-type residue mismatch on /thermompnn-submit with 422", async () => {
      const thermoRoute = apiRouter.stack.find(s => s.route && s.route.path === "/thermompnn-submit");
      expect(thermoRoute).toBeDefined();
      if (!thermoRoute?.route) throw new Error("Expected route.route to be defined");
      const handler = thermoRoute.route.stack[thermoRoute.route.stack.length - 1].handle;
      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = {
        headers: {},
        body: {
          wtPdb: "ATOM      1  CA  ARG A 408      1.000   1.000   1.000  1.00  0.00           C\nEND",
          mutation: "L408W"
        }
      };
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
      expect(statusCode).toBe(422);
      expect(jsonVal?.error?.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("returns a synchronous prediction on /thermompnn-submit without a pollable job id", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/thermompnn-submit");
      expect(route).toBeDefined();
      if (!route?.route) throw new Error("Route /thermompnn-submit not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const biophysics = await import("../services/biophysics.ts");
      const spy = vi.spyOn(biophysics, "submitThermoMpnnJob").mockResolvedValue({
        jobId: null,
        status: "done",
        prediction: 0.91,
      });

      let jsonVal: any = null;
      await handler({
        headers: {},
        body: {
          wtPdb: "ATOM      1  CA  ARG B 408      1.000   1.000   1.000  1.00  0.00           C\nEND",
          mutation: "R408W",
        },
      } as any, { status() { return this; }, json(b: any) { jsonVal = b; return this; } } as any, () => {});

      expect(spy).toHaveBeenCalledWith(expect.any(String), "RB408W");
      expect(jsonVal).toMatchObject({
        thermompnnStatus: "done",
        prediction: 0.91,
        error: null,
      });
      spy.mockRestore();
    });
  });

  describe("SSE /jobs/events endpoint and pdbRef resolution", () => {
    it("should establish SSE stream on /jobs/events and emit connected event", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/jobs/events");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /jobs/events not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const writtenChunks: string[] = [];
      const req: any = { query: { jobs: "job-123" }, on: vi.fn() };
      const res: any = {
        setHeader: vi.fn(),
        flushHeaders: vi.fn(),
        write: (chunk: string) => {
          writtenChunks.push(chunk);
          return true;
        }
      };

      handler(req, res, () => {});
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
      expect(writtenChunks.length).toBeGreaterThan(0);
      expect(writtenChunks[0]).toContain('"type":"connected"');
    });

    it("should reject SSE connection with 400 when jobs query is missing", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/jobs/events");
      if (!route || !route.route) throw new Error("Route /jobs/events not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      let statusCode = 200;
      let jsonVal: any = null;
      const req: any = { query: {}, on: vi.fn() };
      const res: any = {
        setHeader: vi.fn(),
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonVal = data; return res; }
      };

      handler(req, res, () => {});
      expect(statusCode).toBe(400);
      expect(jsonVal.error.message).toContain("Query parameter 'jobs'");
    });

    it("answers a bad subscription with a real 400 before any stream headers are flushed", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/jobs/events");
      if (!route || !route.route) throw new Error("Route /jobs/events not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const tooMany = Array.from({ length: 51 }, (_, i) => `job-${i}`).join(",");
      for (const jobs of [tooMany, "ok-1,bad id!", "a/../b"]) {
        let statusCode = 200;
        let jsonVal: any = null;
        const res: any = {
          setHeader: vi.fn(),
          flushHeaders: vi.fn(),
          write: vi.fn(),
          status: (code: number) => { statusCode = code; return res; },
          json: (data: any) => { jsonVal = data; return res; }
        };
        handler({ query: { jobs }, on: vi.fn() } as any, res, () => {});
        expect(statusCode).toBe(400);
        expect(jsonVal.error.code).toBe("BAD_REQUEST");
        expect(res.flushHeaders).not.toHaveBeenCalled();
        expect(res.write).not.toHaveBeenCalled();
      }
    });

    it("refuses non-admin cancellation of SYSTEM_OWNER prewarm jobs", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/jobs/:jobId/cancel");
      if (!route || !route.route) throw new Error("Route /jobs/:jobId/cancel not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const { BiophysicalJobQueue } = await import("../services/biophysical-queue.ts");
      const queue = BiophysicalJobQueue.getInstance();
      const ownerSpy = vi.spyOn(queue, "getJobOwner").mockResolvedValueOnce("__system__" as any);
      const cancelSpy = vi.spyOn(queue, "cancelFor");

      let statusCode = 200;
      let jsonVal: any = null;
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonVal = data; return res; }
      };
      await handler({ params: { jobId: "sys-prewarm-1" }, principal: { kind: "service", userId: "service" } } as any, res, () => {});
      expect(statusCode).toBe(403);
      expect(jsonVal.error.code).toBe("FORBIDDEN");
      expect(cancelSpy).not.toHaveBeenCalled();

      ownerSpy.mockRestore();
      cancelSpy.mockRestore();
    });

    it("should resolve pdbRef from cache in /pocket-detect", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/pocket-detect");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /pocket-detect not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const { pdbCache } = await import("../services/cache.ts");
      const mockPdbText = "ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C\nEND";
      pdbCache.set("P00439", mockPdbText);

      let jsonVal: any = null;
      let statusCode = 200;
      const req: any = {
        body: {
          pdbRef: "P00439",
          targetIndex: 1
        },
        headers: {}
      };
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
      expect(statusCode).toBe(200);
      expect(jsonVal.status).toBe("queued");
      expect(jsonVal.pocketJobId).toBeDefined();
    });

    it("should fall back to AlphaFold when target residue is missing from initial experimental PDB text", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/pocket-finder");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /pocket-finder not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      // Mock experimental PDB that only has residue 1-10, while targetIndex is 586
      const partialPdbText = "ATOM      1  CA  ASP A   1      1.000   1.000   1.000  1.00  0.00           C\nEND";
      const fullAlphafoldText = "ATOM      1  CA  ASP A 586      5.000   5.000   5.000  1.00  0.00           C\nEND";

      const structFetcher = await import("../services/structure-fetcher.ts");
      const afSpy = vi.spyOn(structFetcher, "fetchAlphafoldPdb").mockResolvedValue(fullAlphafoldText);

      let jsonVal: any = null;
      let statusCode = 200;
      const req: any = {
        body: {
          pdbText: partialPdbText,
          pdbRef: "Q9H116",
          targetIndex: 586
        },
        headers: {}
      };
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
      expect(afSpy).toHaveBeenCalledWith("Q9H116");
      expect(statusCode).toBe(200);
      expect(jsonVal.status).toBe("queued");
      expect(jsonVal.pocketJobId).toBeDefined();

      afSpy.mockRestore();
    });
  });

  describe("/generate-mutant with no usable structure", () => {
    // RYR1 p.Arg614Cys, 2026-11-18: the experimental chain did not serve position 614 and AlphaFold has
    // no model for a 5,038-residue protein. Nothing was sent, yet the reply said "Invalid PDB content".
    const NO_STRUCTURE =
      "We could not obtain a usable structure for residue 614 of P21817: no experimental chain or AlphaFold model could be used, or a structure provider did not answer. The structure-based engines did not run; trying again later may help.";
    const call = async (body: any) => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;
      const out: { status: number; body: any } = { status: 200, body: null };
      const res: any = {
        status(code: number) { out.status = code; return this; },
        json(b: any) { out.body = b; return this; },
      };
      await handler({ body, headers: {} } as any, res, () => {});
      return out;
    };

    it("says no usable structure was obtained when the resolver finds none, without blaming a sent structure", async () => {
      const resolver = await import("../services/structure-resolver.ts");
      const spy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue(null);
      try {
        const out = await call({ mutation: "RA614C", uniprotId: "P21817" });
        expect(out.status).toBe(422);
        expect(out.body.error.code).toBe("NO_STRUCTURE");
        expect(out.body.error.message).toBe(NO_STRUCTURE);
      } finally {
        spy.mockRestore();
      }
    });

    it("gives the same careful answer when a structure provider fails", async () => {
      const resolver = await import("../services/structure-resolver.ts");
      const spy = vi.spyOn(resolver, "resolveStructure").mockRejectedValue(new Error("PDBe answered 503"));
      try {
        const out = await call({ mutation: "RA614C", uniprotId: "P21817" });
        expect(out.status).toBe(422);
        expect(out.body.error.message).toBe(NO_STRUCTURE);
      } finally {
        spy.mockRestore();
      }
    });

    it("still calls a sent structure without coordinates invalid", async () => {
      const resolver = await import("../services/structure-resolver.ts");
      const spy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue(null);
      try {
        const out = await call({ mutation: "RA614C", uniprotId: "P21817", wtPdb: "HEADER only, no coordinates" });
        expect(out.status).toBe(400);
        expect(out.body.error.message).toContain("Invalid PDB content");
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("/generate-mutant cache-hit companion dispatch", () => {
    it("should trigger local ThermoMPNN submission when FoldX has a cache hit and thermompnn is missing", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const biophysicsModule = await import("../services/biophysics.ts");
      const tmSpy = vi.spyOn(biophysicsModule, "submitThermoMpnnJob").mockResolvedValue({
        jobId: null,
        status: "done",
        prediction: 0.72,
      });

      const mockCachedResult = {
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: {
          foldx: 1.25,
          foldxMean: 1.25,
          vdw: 0.5,
          electrostatics: 0.1,
          rasp: -0.2,
          thermompnn: null,
          stabilityoracle: 0.4,
        }
      };

      const cacheSpy = vi.spyOn(biophysicsModule, "getMutantFromCache").mockResolvedValue(mockCachedResult as any);

      const mockPdbText = "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND";
      let jsonVal: any = null;
      let statusCode = 200;
      const req: any = {
        body: {
          wtPdb: mockPdbText,
          mutation: "SA489C",
          uniprotId: "Q9H116"
        },
        headers: {}
      };
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

      expect(statusCode).toBe(200);
      expect(jsonVal).toBeDefined();
      expect(tmSpy).toHaveBeenCalled();
      expect(jsonVal.thermompnnStatus).toBe("done");
      expect(jsonVal.energetics.foldx).toBe(1.25);
      expect(jsonVal.energetics.thermompnn).toBe(0.72);
      expect(jsonVal.dynamut2JobId).toBeUndefined();
      expect(jsonVal.ddmutJobId).toBeUndefined();

      tmSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("should preserve completed ThermoMPNN value from cache without resubmitting", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const biophysicsModule = await import("../services/biophysics.ts");
      const tmSpy = vi.spyOn(biophysicsModule, "submitThermoMpnnJob");

      const mockCachedResult = {
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: {
          foldx: 1.25,
          foldxMean: 1.25,
          vdw: 0.5,
          electrostatics: 0.1,
          rasp: -0.2,
          thermompnn: 0.8,
          stabilityoracle: 0.4,
        }
      };

      const cacheSpy = vi.spyOn(biophysicsModule, "getMutantFromCache").mockResolvedValue(mockCachedResult as any);

      const mockPdbText = "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND";
      let jsonVal: any = null;
      let statusCode = 200;
      const req: any = {
        body: {
          wtPdb: mockPdbText,
          mutation: "SA489C",
          uniprotId: "Q9H116"
        },
        headers: {}
      };
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

      expect(statusCode).toBe(200);
      expect(jsonVal).toBeDefined();
      expect(tmSpy).not.toHaveBeenCalled();
      expect(jsonVal.thermompnnStatus).toBe("done");
      expect(jsonVal.energetics.thermompnn).toBe(0.8);

      tmSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("should handle slow sidecar ThermoMPNN submissions (>1.5s) by returning pending status and collecting via /remote-submissions/:token", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      const subRoute = apiRouter.stack.find(s => s.route && s.route.path === "/remote-submissions/:token");
      if (!route?.route || !subRoute?.route) throw new Error("routes not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;
      const subHandler = subRoute.route.stack[subRoute.route.stack.length - 1].handle;

      const biophysicsModule = await import("../services/biophysics.ts");
      const tmSpy = vi.spyOn(biophysicsModule, "submitThermoMpnnJob").mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ jobId: null, status: "done", prediction: 0.91 }), 2500))
      );
      const cacheSpy = vi.spyOn(biophysicsModule, "getMutantFromCache").mockResolvedValue({
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: { foldx: 1.25, foldxMean: 1.25, rasp: -0.2, thermompnn: null, stabilityoracle: 0.4 }
      } as any);

      const mkRes = () => {
        const out: any = { statusCode: 200, body: null };
        out.status = (c: number) => { out.statusCode = c; return out; };
        out.json = (b: any) => { out.body = b; return out; };
        return out;
      };
      const res = mkRes();
      await handler({
        body: { wtPdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND", mutation: "SA489C", uniprotId: "Q9H116" },
        headers: {}
      } as any, res, () => {});

      expect(res.body.thermompnnStatus).toBe("pending");
      expect(res.body.energetics.pendingTools).toContain("ThermoMPNN");
      expect(res.body.energetics.evidenceComplete).toBe(false);
      expect(res.body.energetics.consensusVerdict).not.toContain("Preliminary");
      expect(typeof res.body.remoteSubmissionToken).toBe("string");

      const subRes = mkRes();
      await subHandler({ params: { token: res.body.remoteSubmissionToken }, headers: {} } as any, subRes, () => {});
      expect(subRes.body.settled).toBe(true);
      expect(subRes.body.thermompnnStatus).toBe("done");
      expect(subRes.body.thermompnnVal).toBe(0.91);

      tmSpy.mockRestore();
      cacheSpy.mockRestore();
    }, 15000);

    it("rejects an unknown remote-submission token", async () => {
      const subRoute = apiRouter.stack.find(s => s.route && s.route.path === "/remote-submissions/:token");
      if (!subRoute?.route) throw new Error("route not found");
      const subHandler = subRoute.route.stack[subRoute.route.stack.length - 1].handle;
      let code = 200;
      const res: any = { status(c: number) { code = c; return this; }, json() { return this; } };
      await subHandler({ params: { token: "00000000-0000-4000-8000-000000000000" }, headers: {} } as any, res, () => {});
      expect(code).toBe(404);
    });

    /**
     * The defect behind "RaSP almost never shows a result": the queue worker looks RaSP up AFTER FoldX
     * has cached its record, so every cached record carries `rasp: null`, and the cache-hit path
     * served it without ever querying the index.
     */
    it("looks RaSP up on a cache hit instead of serving the cached null", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      if (!route?.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;
      const biophysicsModule = await import("../services/biophysics.ts");
      const cacheSpy = vi.spyOn(biophysicsModule, "getMutantFromCache").mockResolvedValue({
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: { foldx: 1.25, foldxMean: 1.25, rasp: null, raspReason: undefined, thermompnn: 0.8, stabilityoracle: 0.4 }
      } as any);
      const raspSpy = vi.spyOn(biophysicsModule, "runRaspLocal").mockResolvedValue({ score: 1.7 });
      // A structure the server resolved is in UniProt numbering, so the lookups by position apply to it.
      const resolver = await import("../services/structure-resolver.ts");
      const resolveSpy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue({ pdbText: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND", provenance: { source: "alphafold", chainId: "A" } } as any);

      let body: any = null;
      await handler({
        body: { mutation: "SA489C", uniprotId: "Q9H116" },
        headers: {}
      } as any, { status() { return this; }, json(b: any) { body = b; return this; } } as any, () => {});

      expect(raspSpy).toHaveBeenCalledWith("", "", "A", 489, "S", "C", "Q9H116");
      expect(body.energetics.rasp).toBe(1.7);

      resolveSpy.mockRestore();
      raspSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("does not mutate the live cached record or persist transient companion outages during cache-hit backfills", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      if (!route?.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const protvarModule = await import("../services/external-api/protvar.ts");
      const biophysicsModule = await import("../services/biophysics.ts");

      const liveCachedEntry: any = {
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: {
          foldx: 1.25,
          foldxMean: 1.25,
          rasp: null,
          raspReason: undefined,
          thermompnn: 0.8,
          stabilityoracle: 0.4,
        }
      };

      const cacheSpy = vi.spyOn(biophysicsModule, "getMutantFromCache").mockResolvedValue(liveCachedEntry);
      const writeSpy = vi.spyOn(biophysicsModule, "writeMutantToCache").mockImplementation(() => {});
      const raspSpy = vi.spyOn(biophysicsModule, "runRaspLocal").mockResolvedValue({
        score: null,
        reason: biophysicsModule.RASP_STORE_UNAVAILABLE_REASON
      });
      const protvarSpy = vi.spyOn(protvarModule, "fetchProtVarFoldx").mockResolvedValue({
        status: "found",
        ddg: 0.9,
        plddt: 92,
        model: "AF-Q9H116-F1",
      } as any);

      const resolver = await import("../services/structure-resolver.ts");
      const resolveSpy = vi.spyOn(resolver, "resolveStructure").mockResolvedValue({ pdbText: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND", provenance: { source: "alphafold", chainId: "A" } } as any);

      let body: any = null;
      await handler({
        body: { mutation: "SA489C", uniprotId: "Q9H116" },
        headers: {}
      } as any, { status() { return this; }, json(b: any) { body = b; return this; } } as any, () => {});
      resolveSpy.mockRestore();

      expect(body.energetics.raspError).toBe(biophysicsModule.RASP_STORE_UNAVAILABLE_REASON);
      expect(body.energetics.protvar).toBe(0.9);
      // Live in-memory cache object must remain untouched
      expect(liveCachedEntry.energetics.raspError).toBeUndefined();
      expect(liveCachedEntry.energetics.protvar).toBeUndefined();
      // Persistent cache backfill for ProtVar must not carry the transient RaSP outage
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const persistedArg = writeSpy.mock.calls[0][1] as any;
      expect(persistedArg.energetics.protvar).toBe(0.9);
      expect(persistedArg.energetics.raspError).toBeUndefined();
      expect(persistedArg.energetics.raspStatus).toBeUndefined();

      protvarSpy.mockRestore();
      raspSpy.mockRestore();
      writeSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("should gracefully handle ThermoMPNN sidecar unavailability on cache hits without crashing", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const biophysicsModule = await import("../services/biophysics.ts");
      const tmSpy = vi.spyOn(biophysicsModule, "submitThermoMpnnJob").mockResolvedValue({
        jobId: null,
        status: "unavailable",
        prediction: null,
        error: "Sidecar offline",
      });

      const mockCachedResult = {
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: {
          foldx: 1.25,
          foldxMean: 1.25,
          thermompnn: null,
        }
      };

      const cacheSpy = vi.spyOn(biophysicsModule, "getMutantFromCache").mockResolvedValue(mockCachedResult as any);

      const mockPdbText = "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND";
      let jsonVal: any = null;
      let statusCode = 200;
      const req: any = {
        body: {
          wtPdb: mockPdbText,
          mutation: "SA489C",
          uniprotId: "Q9H116"
        },
        headers: {}
      };
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

      expect(statusCode).toBe(200);
      expect(jsonVal).toBeDefined();
      expect(jsonVal.thermompnnStatus).toBe("unavailable");

      tmSpy.mockRestore();
      cacheSpy.mockRestore();
    });
  });
});
