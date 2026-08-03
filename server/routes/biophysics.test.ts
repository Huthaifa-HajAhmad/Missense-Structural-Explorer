import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { apiRouter } from "../routes.ts";
import { getNearestResidues } from "../../src/data.ts";
import { clearAllCaches } from "../services/cache.ts";

describe("Biophysics Route Endpoints & Helper Unit Tests", () => {
  beforeEach(() => {
    clearAllCaches();
    try {
      const cacheDir = path.join(process.cwd(), "logs", "gemini_cache");
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
    } catch (err) {}
  });

  describe("getNearestResidues regression check", () => {
    it("should return empty array for non-preset variants and never return synthetic residues", () => {
      const residues = getNearestResidues("P00439", "p.Val123Ala", 123);
      expect(residues).toEqual([]);
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
});
