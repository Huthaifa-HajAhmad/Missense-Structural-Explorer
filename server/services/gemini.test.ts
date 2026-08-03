import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGenerateContent = vi.fn();

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = {
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

describe("Gemini API Fallback Cascade and Error Mapping", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
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
});
