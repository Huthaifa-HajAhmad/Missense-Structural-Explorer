import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRouter } from "../../routes.ts";
import * as externalServices from "../../services/external.ts";
import * as geminiService from "../../services/gemini.ts";
import { geminiCache } from "../shared.ts";

describe("Variant narrative route wiring", () => {
  beforeEach(() => {
    geminiCache.clear();
  });

  it("resolves the optional UniProt accession before invoking Gemini", async () => {
    const route: any = apiRouter.stack.find(
      (layer: any) => layer.route && layer.route.path === "/analyze-variant-narrative"
    );
    expect(route).toBeDefined();
    const handler = route.route.stack[route.route.stack.length - 1].handle;

    const resolveSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
    const geminiSpy = vi.spyOn(geminiService, "performGeminiAnalysis").mockResolvedValue({
      analysis: "Resolved narrative output",
      insights: {
        biochemicalShift: "shift",
        structuralImpact: "impact",
        plausibility: "unknown",
        acmgCriteria: []
      }
    } as any);

    let responseBody: any;
    const req: any = {
      body: {
        gene: "PAH",
        variant: "p.Arg408Trp"
      },
      headers: {},
      closed: false
    };
    const res: any = {
      json(body: any) {
        responseBody = body;
        return this;
      },
      getHeader() {
        return undefined;
      }
    };

    try {
      await handler(req, res, () => {});
      expect(resolveSpy).toHaveBeenCalledWith("PAH");
      expect(geminiSpy).toHaveBeenCalledWith(
        "PAH",
        "p.Arg408Trp",
        "P00439",
        "408",
        "Arg",
        "Trp",
        undefined,
        undefined,
        "standard",
        undefined,
        expect.any(AbortSignal),
        undefined,
        undefined,
        undefined
      );
      expect(responseBody.analysis).toBe("Resolved narrative output");
    } finally {
      resolveSpy.mockRestore();
      geminiSpy.mockRestore();
    }
  });
});
