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
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockRetrieveRelevantLiterature.mockReset();
    mockRetrieveRelevantLiterature.mockResolvedValue([]);
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
    process.env.GEMINI_MODEL_FALLBACKS = "";
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
      expect(mockGenerateContent.mock.calls[0][0].config.httpOptions.timeout).toBe(60000);
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

  it("should stop before model generation when the narrative deadline is already expired", async () => {
    const geminiService = await import("./gemini.ts");
    const controller = new AbortController();
    controller.abort(new Error("Deadline exceeded or request timed out"));

    await expect(
      geminiService.performGeminiAnalysis(
        "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", controller.signal
      )
    ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED", status: 504 });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("should preserve a custom-key model error when no system key is configured", async () => {
    const geminiService = await import("./gemini.ts");
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    const oldSystemKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_MODEL = "primary";
    process.env.GEMINI_MODEL_FALLBACKS = "";
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
    process.env.GEMINI_MODEL_FALLBACKS = "";
    
    const testErrorMapping = async (apiErrorMsg: string, apiStatus: number, expectedCode: string, expectedStatus: number) => {
      mockGenerateContent.mockReset();
      mockGenerateContent.mockRejectedValue({
        message: apiErrorMsg,
        status: apiStatus
      });
      
      try {
        await expect(
          geminiService.performGeminiAnalysis(
            "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
          )
        ).rejects.toThrowError(geminiService.GeminiError);
        
        try {
          await geminiService.performGeminiAnalysis(
            "PAH", "p.Arg408Trp", "P00439", "408", "R", "W", undefined, null, "standard", "dummy-key", AbortSignal.timeout(5000)
          );
        } catch (err: any) {
          expect(err.code).toBe(expectedCode);
          expect(err.status).toBe(expectedStatus);
        }
      } catch (e) {
        // expected to throw
      }
    };
    
    try {
      await testErrorMapping("API key is invalid or unauthorized", 403, "API_KEY_INVALID", 403);
      await testErrorMapping("Resource exhausted or quota exceeded", 429, "RESOURCE_EXHAUSTED", 429);
      await testErrorMapping("Deadline exceeded or request timed out", 504, "TIMEOUT", 504);
      await testErrorMapping("Internal server error or unknown code", 500, "MODEL_UNAVAILABLE", 503);
    } finally {
      process.env.GEMINI_MODEL = oldModel;
      process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
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
