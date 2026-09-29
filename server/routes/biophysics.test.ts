import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import { apiRouter } from "../routes.ts";
import { clearAllCaches } from "../services/cache.ts";
import { getRegistryPath } from "./shared.ts";
import { BiophysicalJobQueue } from "../services/biophysical-queue.ts";
import { clearInFlightRemoteSubmissions } from "./biophysics/generation.ts";

describe("Biophysics Route Endpoints & Helper Unit Tests", () => {
  beforeEach(() => {
    clearAllCaches();
    clearInFlightRemoteSubmissions();
    try {
      BiophysicalJobQueue.initialize(2, async () => ({}));
    } catch (_) {}
    // Clear the job registry between tests. This hook previously deleted the REAL
    // temp_jobs/job_registry.json; setup now redirects JOB_REGISTRY_PATH into the OS temp
    // directory, so the same reset applies to throwaway state only. Clearing it is required,
    // not optional: the redirected file persists between runs, and a stale entry whose
    // jobId/type happen to match makes the backfill test pass or fail depending on history.
    try {
      const registryPath = getRegistryPath();
      if (fs.existsSync(registryPath)) {
        fs.rmSync(registryPath, { force: true });
      }
    } catch (err) {}
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

  describe("/ddmut-submit and /ddmut-job/:jobId endpoints", () => {
    it("should accept standard missense code R408W in /ddmut-submit", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/ddmut-submit");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /ddmut-submit not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const dynamutServices = await import("../services/dynamut.ts");
      const submitSpy = vi.spyOn(dynamutServices, "submitDdmutJob").mockResolvedValue("99999");

      let jsonVal: any = null;
      const req: any = {
        body: {
          wtPdb: "ATOM      1  CA  ARG A 408      1.000   1.000   1.000  1.00  0.00           C\nEND",
          mutation: "R408W"
        }
      };
      const res: any = {
        json(body: any) {
          jsonVal = body;
          return this;
        },
        status(code: number) {
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(submitSpy).toHaveBeenCalledWith(expect.any(String), "A", 408, "R", "W");
      expect(jsonVal.ddmutJobId).toBe("99999");
      expect(jsonVal.ddmutStatus).toBe("pending");

      submitSpy.mockRestore();
    });

    it("should return prediction on /ddmut-job/:jobId when DONE", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/ddmut-job/:jobId");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /ddmut-job/:jobId not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const dynamutServices = await import("../services/dynamut.ts");
      const pollSpy = vi.spyOn(dynamutServices, "pollDdmutJob").mockResolvedValue({
        status: "DONE",
        prediction: -1.25
      });

      let jsonVal: any = null;
      const req: any = {
        params: { jobId: "99999" },
        headers: {},
        query: {}
      };
      const res: any = {
        json(body: any) {
          jsonVal = body;
          return this;
        },
        status(code: number) {
          return this;
        }
      };

      await handler(req, res, () => {});
      expect(pollSpy).toHaveBeenCalledWith("99999");
      expect(jsonVal.status).toBe("DONE");
      expect(jsonVal.prediction).toBe(-1.25);

      pollSpy.mockRestore();
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

  describe("/generate-mutant cache-hit remote dispatch", () => {
    it("should trigger DynaMut2 and DDMut submissions when FoldX has a cache hit but remote jobs are missing", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const externalServices = await import("../services/external.ts");
      const d2Spy = vi.spyOn(externalServices, "submitDynaMut2Job").mockResolvedValue("178940463982");
      const ddmutSpy = vi.spyOn(externalServices, "submitDdmutJob").mockResolvedValue("1789404644525461");

      const biophysicsModule = await import("../services/biophysics.ts");
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
          dynamut2: null,
          ddmut: null
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
      expect(d2Spy).toHaveBeenCalled();
      expect(ddmutSpy).toHaveBeenCalled();
      expect(jsonVal.dynamut2JobId).toBe("178940463982");
      expect(jsonVal.dynamut2Status).toBe("pending");
      expect(jsonVal.ddmutJobId).toBe("1789404644525461");
      expect(jsonVal.ddmutStatus).toBe("pending");
      expect(jsonVal.energetics.foldx).toBe(1.25);

      d2Spy.mockRestore();
      ddmutSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("should preserve completed DynaMut2 and DDMut values from cache without resubmitting", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const externalServices = await import("../services/external.ts");
      const d2Spy = vi.spyOn(externalServices, "submitDynaMut2Job");
      const ddmutSpy = vi.spyOn(externalServices, "submitDdmutJob");

      const biophysicsModule = await import("../services/biophysics.ts");
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
          dynamut2: -0.387,
          ddmut: 0.12
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
      expect(d2Spy).not.toHaveBeenCalled();
      expect(ddmutSpy).not.toHaveBeenCalled();
      expect(jsonVal.dynamut2Status).toBe("done");
      expect(jsonVal.ddmutStatus).toBe("done");
      expect(jsonVal.energetics.dynamut2).toBe(-0.387);
      expect(jsonVal.energetics.ddmut).toBe(0.12);

      d2Spy.mockRestore();
      ddmutSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("should handle slow remote submissions (>1.5s) by returning pending status and preliminary consensus", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const externalServices = await import("../services/external.ts");
      // Simulate slow submission taking 3s
      const d2Spy = vi.spyOn(externalServices, "submitDynaMut2Job").mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve("178940463982"), 3000))
      );
      const ddmutSpy = vi.spyOn(externalServices, "submitDdmutJob").mockResolvedValue("1789404644525461");

      const biophysicsModule = await import("../services/biophysics.ts");
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
          dynamut2: null,
          ddmut: null
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
      expect(jsonVal.dynamut2Status).toBe("pending");
      expect(jsonVal.energetics.pendingTools).toContain("DynaMut2");
      // Provisionality is a typed fact now, not a suffix concatenated onto the verdict. The verdict
      // itself stays a closed-set value, so no consumer has to parse it.
      expect(jsonVal.energetics.evidenceComplete).toBe(false);
      expect(jsonVal.energetics.consensusVerdict).not.toContain("Preliminary");

      d2Spy.mockRestore();
      ddmutSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("should gracefully handle external submission failures without crashing", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const externalServices = await import("../services/external.ts");
      const d2Spy = vi.spyOn(externalServices, "submitDynaMut2Job").mockRejectedValue(new Error("BioSig server down"));
      const ddmutSpy = vi.spyOn(externalServices, "submitDdmutJob").mockResolvedValue(null);

      const biophysicsModule = await import("../services/biophysics.ts");
      const mockCachedResult = {
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: {
          foldx: 1.25,
          foldxMean: 1.25,
          dynamut2: null,
          ddmut: null
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
      expect(jsonVal.dynamut2Status).toBe("unavailable");
      expect(jsonVal.ddmutStatus).toBe("unavailable");

      d2Spy.mockRestore();
      ddmutSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    it("should handle mixed cache state: preserving existing prediction while submitting missing one", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/generate-mutant");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /generate-mutant not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const externalServices = await import("../services/external.ts");
      const d2Spy = vi.spyOn(externalServices, "submitDynaMut2Job");
      const ddmutSpy = vi.spyOn(externalServices, "submitDdmutJob").mockResolvedValue("1789404644525461");

      const biophysicsModule = await import("../services/biophysics.ts");
      const mockCachedResult = {
        pdb: "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND",
        ddG: 1.25,
        status: "success",
        energetics: {
          foldx: 1.25,
          foldxMean: 1.25,
          dynamut2: -0.387,
          ddmut: null
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
      expect(d2Spy).not.toHaveBeenCalled();
      expect(ddmutSpy).toHaveBeenCalled();
      expect(jsonVal.dynamut2Status).toBe("done");
      expect(jsonVal.energetics.dynamut2).toBe(-0.387);
      expect(jsonVal.ddmutStatus).toBe("pending");
      expect(jsonVal.ddmutJobId).toBe("1789404644525461");

      d2Spy.mockRestore();
      ddmutSpy.mockRestore();
      cacheSpy.mockRestore();
    });
  });

  describe("BioSig Polling Cache Backfill", () => {
    it("should backfill completed DynaMut2 prediction into FoldX cache upon DONE status", async () => {
      const route = apiRouter.stack.find(s => s.route && s.route.path === "/dynamut2-job/:jobId");
      expect(route).toBeDefined();
      if (!route || !route.route) throw new Error("Route /dynamut2-job/:jobId not found");
      const handler = route.route.stack[route.route.stack.length - 1].handle;

      const { recordJobInRegistry } = await import("./shared.ts");
      await recordJobInRegistry("178940463982", "dynamut2", "SA489C", "test_cache_key_489");

      const externalServices = await import("../services/external.ts");
      const pollSpy = vi.spyOn(externalServices, "pollDynaMut2Job").mockResolvedValue({
        status: "DONE",
        prediction: -0.387
      });

      const biophysicsModule = await import("../services/biophysics.ts");
      const cachedMock = {
        pdb: "ATOM...",
        ddG: 1.0,
        energetics: { foldx: 1.0, dynamut2: null }
      };
      const getCacheSpy = vi.spyOn(biophysicsModule, "getMutantFromCache").mockResolvedValue(cachedMock as any);
      const writeCacheSpy = vi.spyOn(biophysicsModule, "writeMutantToCache").mockImplementation(() => {});

      let jsonVal: any = null;
      let statusCode = 200;
      const req: any = {
        params: { jobId: "178940463982" },
        headers: {},
        query: {}
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
      expect(jsonVal.status).toBe("DONE");
      expect(jsonVal.prediction).toBe(-0.387);
      expect(writeCacheSpy).toHaveBeenCalledWith("test_cache_key_489", expect.objectContaining({
        energetics: expect.objectContaining({ dynamut2: -0.387 })
      }));

      pollSpy.mockRestore();
      getCacheSpy.mockRestore();
      writeCacheSpy.mockRestore();
    });
  });
});
