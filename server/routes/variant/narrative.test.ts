import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRouter } from "../../routes.ts";
import * as externalServices from "../../services/external.ts";
import * as geminiService from "../../services/gemini.ts";
import { geminiCache } from "../shared.ts";

function getNarrativeHandler(): any {
  const route: any = apiRouter.stack.find(
    (layer: any) => layer.route && layer.route.path === "/analyze-variant-narrative"
  );
  expect(route).toBeDefined();
  return route.route.stack[route.route.stack.length - 1].handle;
}

/**
 * Fake req/res that record where listeners are attached, so we can prove the route no longer
 * listens for a client disconnect on the request object.
 */
function makeHarness() {
  const reqListeners = new Map<string, Array<() => void>>();
  const resListeners = new Map<string, Array<() => void>>();

  const req: any = {
    body: { gene: "PAH", variant: "p.Arg408Trp" },
    headers: {},
    on(event: string, cb: () => void) {
      const list = reqListeners.get(event) ?? [];
      list.push(cb);
      reqListeners.set(event, list);
      return this;
    },
  };

  const res: any = {
    writableEnded: false,
    body: undefined as any,
    json(body: any) {
      this.body = body;
      return this;
    },
    getHeader() {
      return undefined;
    },
    on(event: string, cb: () => void) {
      const list = resListeners.get(event) ?? [];
      list.push(cb);
      resListeners.set(event, list);
      return this;
    },
  };

  return {
    req,
    res,
    /** Simulate Node emitting the body-completed 'close' on the request stream. */
    emitRequestClose: () => (reqListeners.get("close") ?? []).forEach((cb) => cb()),
    requestCloseListenerCount: () => (reqListeners.get("close") ?? []).length,
  };
}

describe("Variant narrative route wiring", () => {
  beforeEach(() => {
    geminiCache.clear();
    geminiService.resetModelHealth();
  });

  it("resolves the optional UniProt accession before invoking Gemini", async () => {
    const handler = getNarrativeHandler();

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

    const { req, res } = makeHarness();
    const responseBody = () => res.body;

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
      expect(responseBody().analysis).toBe("Resolved narrative output");
    } finally {
      resolveSpy.mockRestore();
      geminiSpy.mockRestore();
    }
  });

  /**
   * Root-cause regression test.
   *
   * Node emits 'close' on `req` as soon as its body has been fully read, and express.json() has
   * already done that before the handler runs. The old code registered
   * `req.on("close", () => { if (!res.writableEnded) controller.abort(); })`, so the guard passed
   * on the next tick and every synthesis was cancelled before it reached the provider — which is
   * why the report was permanently "AI Explanation Service Offline / Deadline exceeded".
   */
  it("does not cancel synthesis when the request stream closes after its body is read", async () => {
    const handler = getNarrativeHandler();

    const resolveSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");

    let capturedSignal: AbortSignal | undefined;
    let releaseAnalysis: (value: any) => void = () => {};
    const analysisGate = new Promise((resolve) => {
      releaseAnalysis = resolve;
    });

    const geminiSpy = vi.spyOn(geminiService, "performGeminiAnalysis").mockImplementation(
      (async (...args: any[]) => {
        capturedSignal = args[10];
        return analysisGate;
      }) as any
    );

    const { req, res, emitRequestClose, requestCloseListenerCount } = makeHarness();

    try {
      const handlerPromise = handler(req, res, () => {});
      // Let the handler reach the provider call.
      await new Promise((resolve) => setImmediate(resolve));

      // The route must not be listening for a request-stream close at all.
      expect(requestCloseListenerCount()).toBe(0);

      // Even if Node's body-completed 'close' fires, the signal must stay live.
      emitRequestClose();
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      releaseAnalysis({
        analysis: "Live narrative",
        insights: { biochemicalShift: "s", structuralImpact: "i", plausibility: "p", acmgCriteria: [] },
      });
      await handlerPromise;

      expect(res.body.isFallback).toBe(false);
      expect(res.body.analysis).toBe("Live narrative");
    } finally {
      resolveSpy.mockRestore();
      geminiSpy.mockRestore();
    }
  });

  it("returns a structured, prose-free fallback when synthesis fails", async () => {
    const handler = getNarrativeHandler();

    const resolveSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
    const geminiSpy = vi.spyOn(geminiService, "performGeminiAnalysis").mockRejectedValue(
      new geminiService.GeminiError(
        "PROVIDER_OVERLOADED",
        "Gemini reports that the requested models are overloaded.",
        503,
        {
          providerDetail: "This model is currently experiencing high demand.",
          attemptedModels: ["gemini-3.5-flash", "gemini-2.5-flash"],
        }
      )
    );

    const { req, res } = makeHarness();

    try {
      await handler(req, res, () => {});
      const body = res.body;

      // Structured degradation contract the Report UI branches on.
      expect(body.isFallback).toBe(true);
      expect(body.fallbackReason).toBe("PROVIDER_OVERLOADED");
      expect(body.fallbackRetryable).toBe(true);
      expect(body.fallbackMessage).toBeTruthy();
      expect(body.attemptedModels).toEqual(["gemini-3.5-flash", "gemini-2.5-flash"]);
      expect(body.providerDetail).toContain("high demand");

      // The report body must stay a clinical document.
      expect(body.analysis).toContain("Rule-Based Clinical Summary");
      expect(body.analysis).not.toContain("AI Explanation Service Offline");
      expect(body.analysis).not.toContain("Fallback Report Loaded");
      // ...and must not leak provider plumbing.
      expect(body.analysis).not.toContain("high demand");
      expect(body.analysis).not.toContain('{"error"');
      expect(body.analysis).not.toContain("503");

      expect(body.insights.biochemicalShift).toBe("Not synthesized");
      expect(Array.isArray(body.insights.acmgCriteria)).toBe(true);
    } finally {
      resolveSpy.mockRestore();
      geminiSpy.mockRestore();
    }
  });

  it("marks a missing credential as non-retryable and unconfigured", async () => {
    const handler = getNarrativeHandler();

    const resolveSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
    const geminiSpy = vi.spyOn(geminiService, "performGeminiAnalysis").mockRejectedValue(
      new geminiService.GeminiError("API_KEY_MISSING", "No Gemini API key is configured.", 401)
    );

    const { req, res } = makeHarness();

    try {
      await handler(req, res, () => {});
      const body = res.body;

      expect(body.isFallback).toBe(true);
      expect(body.fallbackReason).toBe("API_KEY_MISSING");
      // Retrying without changing the configuration cannot help.
      expect(body.fallbackRetryable).toBe(false);
      expect(body.analysis).not.toContain("Gemini API Key Not Configured");
      expect(body.analysis).toContain("Rule-Based Clinical Summary");
    } finally {
      resolveSpy.mockRestore();
      geminiSpy.mockRestore();
    }
  });

  it("treats an unexpected transport failure as a retryable service error", async () => {
    const handler = getNarrativeHandler();

    const resolveSpy = vi.spyOn(externalServices, "resolveGeneToUniprot").mockResolvedValue("P00439");
    const geminiSpy = vi
      .spyOn(geminiService, "performGeminiAnalysis")
      .mockRejectedValue(new Error("socket hang up"));

    const { req, res } = makeHarness();

    try {
      await handler(req, res, () => {});
      const body = res.body;

      expect(body.isFallback).toBe(true);
      expect(body.fallbackReason).toBe("NETWORK_ERROR");
      expect(body.fallbackRetryable).toBe(true);
      expect(body.analysis).not.toContain("socket hang up");
    } finally {
      resolveSpy.mockRestore();
      geminiSpy.mockRestore();
    }
  });
});
