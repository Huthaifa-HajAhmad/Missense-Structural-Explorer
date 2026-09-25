import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGenerateContent = vi.fn();
const mockRetrieveRelevantLiterature = vi.fn().mockResolvedValue([]);

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 10 }),
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

vi.mock("./literature-rag.ts", () => {
  return {
    retrieveRelevantLiterature: (...args: any[]) => mockRetrieveRelevantLiterature(...args)
  };
});

describe("Gemini API Fallback Cascade and Error Mapping", () => {
  beforeEach(async () => {
    mockGenerateContent.mockReset();
    mockRetrieveRelevantLiterature.mockReset();
    mockRetrieveRelevantLiterature.mockResolvedValue([]);
    // The provider-health circuit breaker is module-global: transient failures recorded by
    // one test would reorder candidate models for the next. Reset it per test.
    const geminiService = await import("./gemini.ts");
    geminiService.resetModelHealth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should attempt fallback models if the primary model fails with model-not-found/unavailable error", async () => {
    const geminiService = await import("./gemini.ts");
    
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

  it("should use supported defaults when model environment variables are omitted", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL_FALLBACKS;
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        analysis: "Default model analysis",
        plausibility: "Insufficient evidence",
        acmgCriteria: []
      })
    });

    try {
      await geminiService.performGeminiAnalysis(
        "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
      );
      expect(mockGenerateContent.mock.calls[0][0].model).toBe("gemini-3.7-flash");
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });

  it("should forward the deadline to optional RAG and the GenAI SDK", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "primary";
    /*
     * A blank GEMINI_MODEL_FALLBACKS now means "use the shipped ladder" rather than "no
     * fallbacks", so a test that wants a single candidate names it. The same list is the
     * retry pool, so a one-entry ladder also pins the attempt count to one.
     */
    process.env.GEMINI_MODEL_FALLBACKS = "primary";
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ analysis: "Signal-aware analysis", plausibility: "Unknown", acmgCriteria: [] })
    });
    const controller = new AbortController();

    try {
      await geminiService.performGeminiAnalysis(
        "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", controller.signal
      );
      expect(mockRetrieveRelevantLiterature).toHaveBeenCalledWith(
        "PAH",
        "PAH p.Arg408Trp functional activity pathogenicity stability",
        "dummy-key",
        expect.any(AbortSignal)
      );
      expect(mockGenerateContent.mock.calls[0][0].config.abortSignal).toBeInstanceOf(AbortSignal);
      // The per-attempt SDK timeout is the model's adaptive slice, not a flat 60s: a screening
      // attempt is capped at the 35s ceiling, and the rest of the budget is reserved so the
      // final attempt can finish a reply the cap would have killed.
      expect(mockGenerateContent.mock.calls[0][0].config.httpOptions.timeout).toBe(35000);
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });

  it("should replace retired configured models with supported defaults", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    process.env.GEMINI_MODEL_FALLBACKS = "gemini-1.5-flash";
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ analysis: "Retired model fallback", plausibility: "Unknown", acmgCriteria: [] })
    });

    try {
      await geminiService.performGeminiAnalysis(
        "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
      );
      expect(mockGenerateContent.mock.calls[0][0].model).toBe("gemini-3.7-flash");
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });

  it("should stop before model generation when the request signal is already aborted", async () => {
    const geminiService = await import("./gemini.ts");
    const controller = new AbortController();
    controller.abort(new Error("Deadline exceeded or request timed out"));

    // A caller that has already aborted is a cancellation, not a provider deadline: the
    // engine cannot tell the route's deadline from a client disconnect (one combined signal),
    // so it reports what it observed — the caller aborted — rather than blaming the provider.
    await expect(
      geminiService.performGeminiAnalysis(
        "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", controller.signal
      )
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED", status: 499, failureKind: "cancelled" });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("carries the verdict on every branch that fails fast", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "primary";
    process.env.GEMINI_MODEL_FALLBACKS = "primary";

    /*
     * One provider error per branch that empties the pool and exits at once. A retryable kind
     * walks the whole ladder instead, which the budget suite covers with fake timers. Without
     * these, deleting one branch's `failureKind` leaves the suite green while the route falls
     * back to classifying the raw error and tells the reader the wrong reason — the defect
     * this field exists to prevent.
     */
    const cases: Array<[string, any, string, string]> = [
      ["auth", { message: "API key not valid", status: 403 }, "API_KEY_INVALID", "auth"],
      ["quota", { message: "quota exceeded", status: 429 }, "QUOTA_EXHAUSTED", "quota"],
      ["unknown", { message: "kaboom", status: 500 }, "MODEL_UNAVAILABLE", "unknown"],
    ];

    try {
      for (const [branch, providerError, code, kind] of cases) {
        geminiService.resetModelHealth();
        mockGenerateContent.mockReset();
        mockGenerateContent.mockRejectedValue(providerError);

        const err: any = await geminiService
          .performGeminiAnalysis(
            "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(8000)
          )
          .catch((e: any) => e);

        expect({ branch, code: err?.code, kind: err?.failureKind }).toEqual({ branch, code, kind });
      }
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });

  it("carries the not_found verdict when every candidate has been retired", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "retired-model";
    process.env.GEMINI_MODEL_FALLBACKS = "retired-model";

    mockGenerateContent.mockRejectedValue({ message: "models/retired-model is not found", status: 404 });

    try {
      // `not_found` reaches the switch's default branch. The verdict — not a literal — has to
      // ride the error, or a retired model is reported as an unclassified failure and the
      // MODEL_UNAVAILABLE mapping row becomes unreachable from the engine.
      await expect(
        geminiService.performGeminiAnalysis(
          "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
        )
      ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE", status: 503, failureKind: "not_found" });

      expect(geminiService.failureKindToFallbackReason("not_found")).toBe("MODEL_UNAVAILABLE");
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });

  it("reports a mid-ladder cancellation with the attempts it actually made", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "primary";
    process.env.GEMINI_MODEL_FALLBACKS = "primary";

    const controller = new AbortController();
    // Abort while the first attempt is in flight: the provider call never returns.
    mockGenerateContent.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            controller.abort(new Error("client disconnected"));
            reject(new Error("This operation was aborted"));
          }, 0);
        })
    );

    try {
      const err: any = await geminiService
        .performGeminiAnalysis(
          "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", controller.signal
        )
        .catch((e: any) => e);

      // A cancellation is named as one, with the attempts it actually made: the old message
      // claimed no model had responded while attaching the model it did try.
      expect(err).toBeInstanceOf(geminiService.GeminiError);
      expect(err.code).toBe("REQUEST_CANCELLED");
      expect(err.status).toBe(499);
      expect(err.failureKind).toBe("cancelled");
      expect(err.attemptedModels).toEqual(["primary"]);
      expect(err.message).toMatch(/cancelled after 1 model attempt/i);
      expect(err.message).not.toMatch(/before any model responded/i);
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });

  it("should preserve a custom-key model error when no system key is configured", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    const oldSystemKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_MODEL = "primary";
    process.env.GEMINI_MODEL_FALLBACKS = "primary";
    delete process.env.GEMINI_API_KEY;
    mockGenerateContent.mockRejectedValueOnce({ message: "model unavailable", status: 500 });

    try {
      await expect(
        geminiService.performGeminiAnalysis(
          "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
        )
      ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE", status: 503 });
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
      if (oldSystemKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = oldSystemKey;
    }
  });

  it("should reject common placeholder keys regardless of case", async () => {
    const geminiService = await import("./gemini.ts");
    expect(geminiService.isGeminiApiKeyPlaceholder("your_free_gemini_api_key_here")).toBe(true);
    expect(geminiService.isGeminiApiKeyPlaceholder("MY_GEMINI_API_KEY")).toBe(true);
    expect(geminiService.isGeminiApiKeyPlaceholder("your-real-ai-studio-api-key")).toBe(true);
    expect(geminiService.isGeminiApiKeyPlaceholder("AIzaSyB1234567890-real")).toBe(false);
  });

  it("should map specific SDK errors to correct GeminiError instances", async () => {
    const geminiService = await import("./gemini.ts");

    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "primary";
    // One candidate: this test is about error → GeminiError mapping, not about the ladder.
    process.env.GEMINI_MODEL_FALLBACKS = "primary";

    /*
     * Assertions are made directly, not inside a `try { … } catch { /* expected *\/ }` wrapper.
     *
     * The previous version wrapped both the `rejects` expectation and the code/status checks in
     * an outer catch, so *every* assertion in it was swallowed: a wrong code, a wrong status or
     * even "did not throw at all" all passed. It asserted `RESOURCE_EXHAUSTED` for a 429, a code
     * this module never throws (it throws `QUOTA_EXHAUSTED`), and the suite was green.
     *
     * The cases below are the non-retryable kinds, which terminate after one attempt. The
     * `timeout` kind is retryable by design (a slice expiry must stay in the pool), so its
     * mapping is pinned through the pure decision functions rather than by burning the budget —
     * `performGeminiAnalysis`'s throw site for it is the same switch these three exercise.
     */
    const expectMapping = async (
      apiErrorMsg: string,
      apiStatus: number,
      expectedCode: string,
      expectedStatus: number
    ) => {
      mockGenerateContent.mockReset();
      mockGenerateContent.mockRejectedValue({ message: apiErrorMsg, status: apiStatus });

      let thrown: any = null;
      try {
        await geminiService.performGeminiAnalysis(
          "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
        );
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(geminiService.GeminiError);
      expect({ code: thrown?.code, status: thrown?.status }).toEqual({ code: expectedCode, status: expectedStatus });
    };

    try {
      await expectMapping("API key is invalid or unauthorized", 403, "API_KEY_INVALID", 403);
      await expectMapping("Resource exhausted or quota exceeded", 429, "QUOTA_EXHAUSTED", 429);
      await expectMapping("Internal server error or unknown code", 500, "MODEL_UNAVAILABLE", 503);

      // The retryable kinds' classification, which is what the throw site switches on.
      expect(geminiService.failureKindToFallbackReason(geminiService.classifyGeminiFailure({ status: 504, message: "Deadline expired" }))).toBe("DEADLINE_EXCEEDED");
      expect(geminiService.failureKindToFallbackReason(geminiService.classifyGeminiFailure({ status: 503, message: "high demand" }))).toBe("PROVIDER_OVERLOADED");
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });

  describe("validateGeminiApiKey", () => {
    it("should succeed when key is valid and generateContent responds", async () => {
      const geminiService = await import("./gemini.ts");
      mockGenerateContent.mockResolvedValueOnce({ text: "OK" });
      await expect(geminiService.validateGeminiApiKey("valid-api-key-12345")).resolves.toBeUndefined();
    });

    it("should immediately reject invalid keys with API_KEY_INVALID (403)", async () => {
      const geminiService = await import("./gemini.ts");
      mockGenerateContent.mockRejectedValueOnce({
        status: 401,
        message: "API key not valid. Please pass a valid API key."
      });
      await expect(geminiService.validateGeminiApiKey("invalid-api-key-12345")).rejects.toMatchObject({
        code: "API_KEY_INVALID",
        status: 403
      });
    });

    it("should map transient timeout errors to TIMEOUT (504)", async () => {
      const geminiService = await import("./gemini.ts");
      mockGenerateContent.mockRejectedValue({
        status: 504,
        message: "Deadline exceeded or request timed out"
      });
      await expect(geminiService.validateGeminiApiKey("timeout-api-key-12345")).rejects.toMatchObject({
        code: "TIMEOUT",
        status: 504
      });
    });
  });
});
