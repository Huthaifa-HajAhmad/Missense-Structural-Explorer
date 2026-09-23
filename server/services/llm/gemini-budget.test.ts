/**
 * Regression tests for the AI-narrative outage.
 *
 * Root cause under test: the narrative call allowed a flat 60s per attempt across up to 5
 * attempts (300s of potential work) behind a 120s outer deadline, always tried the configured
 * primary model first even after it had repeatedly returned 503/504, and spent up to 15s of
 * exponential backoff between models. Two hung models (60s + 60s) consumed the entire deadline,
 * so the caller received a bare "Deadline exceeded or request timed out" instead of a result
 * from the models that were actually healthy.
 */
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
    Type: { OBJECT: "OBJECT", STRING: "STRING", ARRAY: "ARRAY" }
  };
});

vi.mock("./literature-rag.ts", () => ({
  retrieveRelevantLiterature: (...args: any[]) => mockRetrieveRelevantLiterature(...args)
}));

const VALID_RESPONSE = {
  text: JSON.stringify({
    analysis: "Synthesized narrative",
    biochemicalShift: "shift",
    structuralImpact: "impact",
    plausibility: "plausible",
    acmgCriteria: []
  })
};

/** Transient provider failure, shaped like the real SDK rejection. */
const OVERLOAD_ERROR = {
  status: 503,
  message: JSON.stringify({
    error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" }
  })
};

async function runAnalysis(signal?: AbortSignal) {
  const geminiService = await import("./gemini.ts");
  return geminiService.performGeminiAnalysis(
    "PAH", "p.Arg408Trp", "P00439", "408", "R", "W",
    undefined, null, "standard", "dummy-key",
    signal ?? AbortSignal.timeout(30000)
  );
}

describe("narrative synthesis time budget", () => {
  let oldModel: string | undefined;
  let oldFallbacks: string | undefined;

  beforeEach(async () => {
    mockGenerateContent.mockReset();
    mockRetrieveRelevantLiterature.mockReset();
    mockRetrieveRelevantLiterature.mockResolvedValue([]);
    const geminiService = await import("./gemini.ts");
    geminiService.resetModelHealth();
    oldModel = process.env.GEMINI_MODEL;
    oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
  });

  afterEach(() => {
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
    if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
    else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
  });

  it("bounds the total time even if every candidate hangs", async () => {
    const { sliceForAttempt, NARRATIVE_SYNTHESIS_BUDGET_MS } = await import("./gemini.ts");

    for (const candidates of [1, 2, 3, 4, 7]) {
      let remaining = NARRATIVE_SYNTHESIS_BUDGET_MS;
      let total = 0;
      for (let i = 0; i < candidates; i++) {
        const slice = sliceForAttempt(remaining, candidates - i);
        if (slice === 0) break;
        total += slice;
        remaining -= slice;
      }
      // Two hung models at the old flat 60s allowance consumed the entire 120s deadline.
      expect(total).toBeLessThanOrEqual(NARRATIVE_SYNTHESIS_BUDGET_MS);
      // ...and the plan must leave room to assemble the fallback rather than hit the deadline.
      expect(total).toBeLessThan(130_000);
    }
  });

  it("hands unused time from a fast failure to the next candidate", async () => {
    const { sliceForAttempt, NARRATIVE_SYNTHESIS_BUDGET_MS, MAX_ATTEMPT_TIMEOUT_MS } = await import("./gemini.ts");

    // First candidate 503s after ~1s: the healthy candidate that follows must get the ceiling,
    // not the small leftover share a static split would have given it.
    const afterFastFailure = NARRATIVE_SYNTHESIS_BUDGET_MS - 1_000;
    expect(sliceForAttempt(afterFastFailure, 3)).toBe(MAX_ATTEMPT_TIMEOUT_MS);

    // Right at the start it still reserves a floor for the remaining candidates.
    const first = sliceForAttempt(NARRATIVE_SYNTHESIS_BUDGET_MS, 4);
    expect(first).toBeLessThanOrEqual(MAX_ATTEMPT_TIMEOUT_MS);
    expect(first).toBeGreaterThanOrEqual(15_000);
  });

  it("never allocates a slice below the floor, or any slice at all on an exhausted budget", async () => {
    const { sliceForAttempt, MIN_ATTEMPT_TIMEOUT_MS } = await import("./gemini.ts");

    expect(sliceForAttempt(0, 4)).toBe(0);
    expect(sliceForAttempt(-5, 4)).toBe(0);
    expect(sliceForAttempt(100_000, 0)).toBe(0);

    // A floor is always met while any attempt is still affordable.
    const slice = sliceForAttempt(MIN_ATTEMPT_TIMEOUT_MS * 2, 7);
    expect(slice).toBeGreaterThanOrEqual(MIN_ATTEMPT_TIMEOUT_MS);
  });

  it("still attempts once when the budget only affords a single candidate", async () => {
    const { sliceForAttempt, MIN_ATTEMPT_TIMEOUT_MS } = await import("./gemini.ts");

    // Regression: an over-eager reserve would return 0 here and the caller would never call
    // the provider at all.
    const slice = sliceForAttempt(MIN_ATTEMPT_TIMEOUT_MS * 2, 4);
    expect(slice).toBeGreaterThan(0);
    expect(slice).toBeGreaterThanOrEqual(MIN_ATTEMPT_TIMEOUT_MS);
  });

  it("gives the final candidate everything that is left, not a cap it already exceeds", async () => {
    const { sliceForAttempt, MAX_ATTEMPT_TIMEOUT_MS } = await import("./gemini.ts");

    /*
     * Regression: the fallback that actually answers in production needs ~37s for the
     * full narrative prompt, against a 35s per-attempt ceiling — so the old rule
     * aborted it as it was answering, and whether the user saw a real narrative came
     * down to provider jitter. The last candidate is the last chance, so it may use
     * whatever the budget has left.
     */
    const remaining = 80_000;
    const lastSlice = sliceForAttempt(remaining, 1);
    expect(lastSlice).toBe(remaining);
    expect(lastSlice).toBeGreaterThan(MAX_ATTEMPT_TIMEOUT_MS);

    // ...while a non-final candidate is still capped, so one slow model cannot eat the ladder.
    expect(sliceForAttempt(remaining, 2)).toBeLessThanOrEqual(MAX_ATTEMPT_TIMEOUT_MS);

    // An exhausted budget still allocates nothing, last candidate or not.
    expect(sliceForAttempt(0, 1)).toBe(0);
  });

  it("caps how long a single unresponsive model can hold the request", async () => {
    process.env.GEMINI_MODEL = "empty-primary";
    process.env.GEMINI_MODEL_FALLBACKS = "healthy";
    // Empty completion: not a transport error, but not a usable result either. It must not
    // consume the next model's slice.
    mockGenerateContent.mockImplementation((args: any) =>
      args.model === "empty-primary" ? Promise.resolve({ text: "" }) : Promise.resolve(VALID_RESPONSE)
    );

    const { MAX_ATTEMPT_TIMEOUT_MS, MIN_ATTEMPT_TIMEOUT_MS } = await import("./gemini.ts");
    const result = await runAnalysis();

    expect(result.analysis).toBe("Synthesized narrative");

    const firstSlice = mockGenerateContent.mock.calls[0][0].config.httpOptions.timeout;
    const secondSlice = mockGenerateContent.mock.calls[1][0].config.httpOptions.timeout;

    expect(firstSlice).toBeLessThanOrEqual(MAX_ATTEMPT_TIMEOUT_MS);
    expect(firstSlice).toBeGreaterThanOrEqual(MIN_ATTEMPT_TIMEOUT_MS);
    expect(secondSlice).toBeGreaterThanOrEqual(MIN_ATTEMPT_TIMEOUT_MS);
  });

  it("does not burn multi-second backoff between distinct models", async () => {
    process.env.GEMINI_MODEL = "a";
    process.env.GEMINI_MODEL_FALLBACKS = "b,c,d";
    // Every candidate is overloaded; the loop should exhaust quickly rather than
    // sleeping 1s + 2s + 4s between hops.
    mockGenerateContent.mockRejectedValue(OVERLOAD_ERROR);

    const startedAt = Date.now();
    await expect(runAnalysis()).rejects.toMatchObject({
      code: "PROVIDER_OVERLOADED",
      status: 503
    });
    const elapsed = Date.now() - startedAt;

    expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    // Old behaviour allowed up to 15s of backoff here.
    expect(elapsed).toBeLessThan(4000);
  });
});

describe("provider-health circuit breaker", () => {
  let oldModel: string | undefined;
  let oldFallbacks: string | undefined;

  beforeEach(async () => {
    mockGenerateContent.mockReset();
    mockRetrieveRelevantLiterature.mockReset();
    mockRetrieveRelevantLiterature.mockResolvedValue([]);
    const geminiService = await import("./gemini.ts");
    geminiService.resetModelHealth();
    oldModel = process.env.GEMINI_MODEL;
    oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "flaky";
    process.env.GEMINI_MODEL_FALLBACKS = "reliable";
    mockGenerateContent.mockImplementation((args: any) =>
      args.model === "flaky" ? Promise.reject(OVERLOAD_ERROR) : Promise.resolve(VALID_RESPONSE)
    );
  });

  afterEach(() => {
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
    if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
    else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
  });

  it("tries the configured primary first while it is still healthy", async () => {
    await runAnalysis();
    expect(mockGenerateContent.mock.calls.map((c) => c[0].model)).toEqual(["flaky", "reliable"]);
  });

  it("demotes a model after a transient failure instead of re-paying it every request", async () => {
    await runAnalysis();

    const geminiService = await import("./gemini.ts");
    expect(geminiService.isModelCoolingDown("flaky")).toBe(true);

    mockGenerateContent.mockClear();

    // Second request must not lead with the known-broken model. This is the regression that
    // made the outage look permanent: every request re-paid the broken primary's timeout.
    await runAnalysis();
    expect(mockGenerateContent.mock.calls.map((c) => c[0].model)).toEqual(["reliable"]);
  });

  it("recovers a model once its cooldown lapses", async () => {
    await runAnalysis();
    const geminiService = await import("./gemini.ts");

    const future = Date.now() + 6 * 60 * 1000;
    expect(geminiService.isModelCoolingDown("flaky", future)).toBe(false);
    expect(geminiService.orderModelsByHealth(["reliable", "flaky"], future)).toEqual(["reliable", "flaky"]);
  });

  it("exposes cooling models in the health snapshot", async () => {
    await runAnalysis();
    const geminiService = await import("./gemini.ts");
    const snapshot = geminiService.getModelHealthSnapshot();
    const flaky = snapshot.find((entry) => entry.model === "flaky");

    expect(flaky).toBeDefined();
    expect(flaky?.coolingDown).toBe(true);
    expect(flaky?.lastDetail).toContain("high demand");
  });
});

describe("configured model ladder", () => {
  let oldModel: string | undefined;
  let oldFallbacks: string | undefined;

  beforeEach(() => {
    oldModel = process.env.GEMINI_MODEL;
    oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
  });

  afterEach(() => {
    if (oldModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldModel;
    if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
    else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
  });

  it("ships the built-in default model inside its own fallback ladder", async () => {
    /*
     * The outage's configuration half: `.env` pinned the overloaded gemini-3.5-flash as
     * primary, and the shipped ladder did not contain gemini-3.7-flash at all — the model
     * this repository defaults to and the one the synthesis budget was sized against. A
     * single bad pin therefore removed the only measured-fast model from the request.
     */
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL_FALLBACKS;

    const { getConfiguredGeminiModels, DEFAULT_GEMINI_MODEL } = await import("./gemini.ts");
    expect(getConfiguredGeminiModels()).toContain(DEFAULT_GEMINI_MODEL);
  });

  it("keeps the built-in default in the ladder even when the primary is pinned elsewhere", async () => {
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    delete process.env.GEMINI_MODEL_FALLBACKS;

    const { getConfiguredGeminiModels, DEFAULT_GEMINI_MODEL } = await import("./gemini.ts");
    const ladder = getConfiguredGeminiModels();

    expect(ladder[0]).toBe("gemini-3.5-flash");
    // Within the four attempts a request is allowed, not merely present in the list.
    expect(ladder.slice(0, 4)).toContain(DEFAULT_GEMINI_MODEL);
  });

  it("drops models the provider has retired, however they were configured", async () => {
    // The API answers gemini-2.5-pro and gemini-2.5-flash-lite with 404 "no longer
    // available to new users", so an attempt spent on either can only fail.
    process.env.GEMINI_MODEL = "gemini-2.5-pro";
    process.env.GEMINI_MODEL_FALLBACKS = "gemini-2.5-flash-lite,gemini-3.7-flash";

    const { getConfiguredGeminiModels, DEFAULT_GEMINI_MODEL } = await import("./gemini.ts");
    const ladder = getConfiguredGeminiModels();

    expect(ladder).not.toContain("gemini-2.5-pro");
    expect(ladder).not.toContain("gemini-2.5-flash-lite");
    // A retired primary falls back to the built-in default rather than to nothing.
    expect(ladder[0]).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("treats a blank fallback list as unset rather than as 'no fallbacks'", async () => {
    process.env.GEMINI_MODEL = "custom-primary";
    process.env.GEMINI_MODEL_FALLBACKS = "   ";

    const { getConfiguredGeminiModels } = await import("./gemini.ts");
    expect(getConfiguredGeminiModels().length).toBeGreaterThan(1);
  });
});

describe("provider failure classification", () => {
  it("maps provider signatures onto stable failure kinds", async () => {
    const { classifyGeminiFailure } = await import("./gemini.ts");

    expect(classifyGeminiFailure({ status: 401, message: "API key not valid" })).toBe("auth");
    expect(classifyGeminiFailure({ status: 403, message: "permission denied" })).toBe("auth");
    expect(classifyGeminiFailure({ status: 429, message: "Resource exhausted" })).toBe("quota");
    expect(classifyGeminiFailure({ status: 503, message: "high demand" })).toBe("overload");
    expect(classifyGeminiFailure({ status: 504, message: "Deadline expired" })).toBe("timeout");
    expect(classifyGeminiFailure({ message: "fetch failed" })).toBe("network");
    expect(classifyGeminiFailure({ status: 404, message: "model not found" })).toBe("not_found");
    expect(classifyGeminiFailure({ status: 500, message: "kaboom" })).toBe("unknown");
  });

  it("maps failure kinds onto narrative fallback reason codes", async () => {
    const { failureKindToFallbackReason, isTransientFailure } = await import("./gemini.ts");

    expect(failureKindToFallbackReason("overload")).toBe("PROVIDER_OVERLOADED");
    expect(failureKindToFallbackReason("timeout")).toBe("DEADLINE_EXCEEDED");
    expect(failureKindToFallbackReason("quota")).toBe("QUOTA_EXHAUSTED");
    expect(failureKindToFallbackReason("network")).toBe("NETWORK_ERROR");
    expect(failureKindToFallbackReason("not_found")).toBe("MODEL_UNAVAILABLE");
    expect(failureKindToFallbackReason("auth")).toBe("API_KEY_INVALID");

    // Only genuinely transient kinds are worth a cooldown / retry.
    expect(isTransientFailure("overload")).toBe(true);
    expect(isTransientFailure("timeout")).toBe(true);
    expect(isTransientFailure("auth")).toBe(false);
    expect(isTransientFailure("not_found")).toBe(false);
  });

  it("unwraps the SDK's stringified JSON body instead of leaking it verbatim", async () => {
    const { sanitizeProviderError } = await import("./gemini.ts");

    expect(sanitizeProviderError(OVERLOAD_ERROR)).toBe(
      "This model is currently experiencing high demand."
    );
    expect(sanitizeProviderError(new Error("plain failure"))).toBe("plain failure");
    expect(sanitizeProviderError(undefined)).toBe("unknown provider error");
    // Long payloads are truncated so they cannot flood the console.
    expect(sanitizeProviderError(new Error("x".repeat(400))).length).toBeLessThanOrEqual(240);
  });

  it("surfaces attempted models and sanitized detail on the thrown error", async () => {
    const oldModel = process.env.GEMINI_MODEL;
    const oldFallbacks = process.env.GEMINI_MODEL_FALLBACKS;
    process.env.GEMINI_MODEL = "a";
    process.env.GEMINI_MODEL_FALLBACKS = "b";
    mockGenerateContent.mockReset();
    mockRetrieveRelevantLiterature.mockReset();
    mockRetrieveRelevantLiterature.mockResolvedValue([]);
    mockGenerateContent.mockRejectedValue(OVERLOAD_ERROR);
    const geminiService = await import("./gemini.ts");
    geminiService.resetModelHealth();

    try {
      await expect(runAnalysis()).rejects.toMatchObject({
        code: "PROVIDER_OVERLOADED",
        attemptedModels: ["a", "b"],
        providerDetail: "This model is currently experiencing high demand."
      });
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });
});
