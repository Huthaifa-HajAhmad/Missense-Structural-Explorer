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

  it("never plans more than the budget it has, however many attempts hang", async () => {
    const { planAttemptTimeout, NARRATIVE_SYNTHESIS_BUDGET_MS, MAX_ATTEMPTS_PER_REQUEST } = await import("./gemini.ts");

    for (const maxAttempts of [1, 2, 3, 4, 7, MAX_ATTEMPTS_PER_REQUEST]) {
      let remaining = NARRATIVE_SYNTHESIS_BUDGET_MS;
      let total = 0;
      for (let i = 0; i < maxAttempts; i++) {
        const slice = planAttemptTimeout(remaining, i, maxAttempts);
        if (slice === 0) break;
        // Every attempt actually consumes its slice: the worst case is a hung provider.
        total += slice;
        remaining -= slice;
      }
      // Two hung models at the old flat 60s allowance consumed the entire 120s deadline.
      expect(total).toBeLessThanOrEqual(NARRATIVE_SYNTHESIS_BUDGET_MS);
      // ...and the plan must leave room to assemble the fallback rather than hit the deadline.
      expect(total).toBeLessThan(130_000);
    }
  });

  it("hands unused time from a fast failure back to the pool", async () => {
    const {
      planAttemptTimeout,
      NARRATIVE_SYNTHESIS_BUDGET_MS,
      MAX_ATTEMPT_TIMEOUT_MS,
      MAX_ATTEMPTS_PER_REQUEST
    } = await import("./gemini.ts");

    // Right at the start a screening attempt is capped, so one slow model cannot eat the
    // long-shot reserve.
    const first = planAttemptTimeout(NARRATIVE_SYNTHESIS_BUDGET_MS, 0, MAX_ATTEMPTS_PER_REQUEST);
    expect(first).toBeLessThanOrEqual(MAX_ATTEMPT_TIMEOUT_MS);
    expect(first).toBeGreaterThanOrEqual(15_000);

    // A candidate that 503s after ~1s returns ~104s, so the next attempt may screen again
    // rather than being handed the leftovers: the retry loop only ends when the budget does.
    const afterFastFailure = NARRATIVE_SYNTHESIS_BUDGET_MS - 1_000;
    expect(planAttemptTimeout(afterFastFailure, 1, MAX_ATTEMPTS_PER_REQUEST)).toBe(MAX_ATTEMPT_TIMEOUT_MS);
    expect(planAttemptTimeout(afterFastFailure, 4, MAX_ATTEMPTS_PER_REQUEST)).toBe(MAX_ATTEMPT_TIMEOUT_MS);
  });

  it("never plans a slice on an exhausted budget, and still attempts once on a thin one", async () => {
    const { planAttemptTimeout, MIN_ATTEMPT_TIMEOUT_MS, MAX_ATTEMPTS_PER_REQUEST } = await import("./gemini.ts");

    expect(planAttemptTimeout(0, 0, 4)).toBe(0);
    expect(planAttemptTimeout(-5, 0, 4)).toBe(0);

    // Regression: an over-eager reserve would return 0 here and the caller would never call
    // the provider at all. Whatever is left is spent on the attempt rather than wasted.
    const slice = planAttemptTimeout(MIN_ATTEMPT_TIMEOUT_MS * 2, 0, MAX_ATTEMPTS_PER_REQUEST);
    expect(slice).toBeGreaterThan(0);
    expect(slice).toBeGreaterThanOrEqual(MIN_ATTEMPT_TIMEOUT_MS);
  });

  it("reserves the end of the budget for one attempt long enough to answer", async () => {
    const {
      planAttemptTimeout,
      MAX_ATTEMPT_TIMEOUT_MS,
      MAX_ATTEMPTS_PER_REQUEST,
      FINAL_ATTEMPT_RESERVE_FRACTION,
      NARRATIVE_SYNTHESIS_BUDGET_MS
    } = await import("./gemini.ts");

    /*
     * Regression: the fallback that answers in production needs ~37s for the full narrative
     * prompt (43-60s during a load spike) against a 35s screening ceiling, so a capped attempt
     * aborted it as it was answering and whether the user saw a real narrative came down to
     * provider jitter. The last attempt is the last chance, so it gets whatever is left.
     */
    const remaining = 80_000;
    const lastSlice = planAttemptTimeout(remaining, MAX_ATTEMPTS_PER_REQUEST - 1, MAX_ATTEMPTS_PER_REQUEST);
    expect(lastSlice).toBe(remaining);
    expect(lastSlice).toBeGreaterThan(MAX_ATTEMPT_TIMEOUT_MS);

    // ...while a screening attempt is still capped.
    expect(planAttemptTimeout(remaining, 0, MAX_ATTEMPTS_PER_REQUEST)).toBeLessThanOrEqual(MAX_ATTEMPT_TIMEOUT_MS);

    // The reserve is proportional, so the smaller biophysical budget still gets a ladder
    // instead of handing its first attempt everything.
    const smallBudget = 45_000;
    const biophysicalFirst = planAttemptTimeout(smallBudget, 0, MAX_ATTEMPTS_PER_REQUEST);
    expect(biophysicalFirst).toBeGreaterThanOrEqual(15_000);
    expect(biophysicalFirst).toBeLessThan(smallBudget);
    expect(biophysicalFirst).toBeLessThan(NARRATIVE_SYNTHESIS_BUDGET_MS * FINAL_ATTEMPT_RESERVE_FRACTION);
  });

  it("retries the ladder instead of giving up while budget remains", async () => {
    /*
     * The defect this pins: a 503 storm made every candidate fail in about a second, the old
     * loop stopped after MAX_MODELS_PER_REQUEST=4 *distinct models* (~20s of a 105s budget),
     * and the caller reported "AI service busy" with ~85s unspent — while a probe a moment
     * later got a complete narrative from `gemini-3.5-flash-lite`, one of the models that had
     * just returned 503. Attempts are now bounded by the budget, not by the ladder length.
     */
    process.env.GEMINI_MODEL = "a";
    process.env.GEMINI_MODEL_FALLBACKS = "b";
    mockGenerateContent.mockRejectedValue(OVERLOAD_ERROR);

    const { MAX_ATTEMPTS_PER_REQUEST, NARRATIVE_SYNTHESIS_BUDGET_MS } = await import("./gemini.ts");

    const startedAt = Date.now();
    await expect(runAnalysis()).rejects.toMatchObject({ code: "PROVIDER_OVERLOADED" });
    const elapsed = Date.now() - startedAt;

    expect(MAX_ATTEMPTS_PER_REQUEST).toBeGreaterThan(2);
    expect(mockGenerateContent).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_REQUEST);
    // ...and the retry spacing stays a small fraction of the budget rather than the old
    // 1s + 2s + 4s + 8s escalation.
    expect(elapsed).toBeLessThan(NARRATIVE_SYNTHESIS_BUDGET_MS * 0.35);
  });

  it("round-robins the ladder so a retry does not re-pay the same 503", async () => {
    const { pickModelForAttempt, MAX_ATTEMPTS_PER_REQUEST } = await import("./gemini.ts");

    const models = ["alpha", "beta", "gamma"];
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (let i = 0; i < MAX_ATTEMPTS_PER_REQUEST; i++) {
      const model = pickModelForAttempt(models, counts);
      expect(model).not.toBeNull();
      order.push(model!);
      counts.set(model!, (counts.get(model!) ?? 0) + 1);
    }

    // Every candidate is tried before any is tried a second time...
    expect(order.slice(0, 3).sort()).toEqual(["alpha", "beta", "gamma"]);
    // ...and the last four attempts are spread evenly rather than piling onto one model.
    const perModel = [...counts.values()];
    expect(Math.max(...perModel) - Math.min(...perModel)).toBeLessThanOrEqual(1);
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

  it("does not burn multi-second backoff between attempts", async () => {
    process.env.GEMINI_MODEL = "a";
    process.env.GEMINI_MODEL_FALLBACKS = "b,c,d";
    // Every candidate is overloaded; the retry spacing must stay well under the second-scale
    // escalation the budget could not afford (1s + 2s + 4s + 8s = 15s of a 105s budget).
    mockGenerateContent.mockRejectedValue(OVERLOAD_ERROR);

    const startedAt = Date.now();
    const { MAX_ATTEMPTS_PER_REQUEST } = await import("./gemini.ts");
    await expect(runAnalysis()).rejects.toMatchObject({
      code: "PROVIDER_OVERLOADED",
    });
    const elapsed = Date.now() - startedAt;

    // 12 attempts at roughly a second of spacing each, not at 12 × the old escalation.
    expect(mockGenerateContent).toHaveBeenCalledTimes(MAX_ATTEMPTS_PER_REQUEST);
    expect(elapsed).toBeLessThan(MAX_ATTEMPTS_PER_REQUEST * 1_400);
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
    // Present in the list, which is what the retry loop walks — not merely inside some
    // fixed prefix of it.
    expect(ladder).toContain(DEFAULT_GEMINI_MODEL);
  });

  it("lists the models measured answering a full narrative when their siblings were 503ing", async () => {
    /*
     * During the storm that produced "All of these models are busy", the candidates that
     * completed the narrative prompt were 3.5-flash-lite, flash-lite-latest, 3-flash-preview
     * and 2.5-flash. The shipped ladder named two of those and omitted the other two, so the
     * request had no healthy candidate to reach even if it had kept trying.
     */
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL_FALLBACKS;

    const { getConfiguredGeminiModels } = await import("./gemini.ts");
    const ladder = getConfiguredGeminiModels();

    for (const model of ["gemini-flash-lite-latest", "gemini-3-flash-preview", "gemini-2.5-flash"]) {
      expect(ladder).toContain(model);
    }
    // The key is not entitled to the pro tier (429 "exceeded your current quota"), so spending
    // one of the attempt slots on a pro model can only fail.
    expect(ladder.some(model => model.includes("-pro"))).toBe(false);
  });

  it("drops models the provider has retired, however they were configured", async () => {
    /*
     * The API answers gemini-2.5-pro and gemini-2.5-flash-lite with 404 "no longer
     * available to new users", so an attempt spent on either can only fail. 2.5-flash is
     * *not* retired — it answered a full narrative during the storm — so the retired list
     * must not be widened by name prefix.
     */
    process.env.GEMINI_MODEL = "gemini-2.5-pro";
    process.env.GEMINI_MODEL_FALLBACKS = "gemini-2.5-flash-lite,gemini-2.5-flash";

    const { getConfiguredGeminiModels, DEFAULT_GEMINI_MODEL } = await import("./gemini.ts");
    const ladder = getConfiguredGeminiModels();

    expect(ladder).not.toContain("gemini-2.5-pro");
    expect(ladder).not.toContain("gemini-2.5-flash-lite");
    expect(ladder).toContain("gemini-2.5-flash");
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
      /*
       * The diagnostics list is what the degraded panel now renders ("Attempted: a -> b -> a"),
       * so it must name the models in the order they were tried, repeats included — that list
       * is how a reader sees that every candidate was retried rather than tried once.
       */
      let thrown: any = null;
      try {
        await runAnalysis();
      } catch (err) {
        thrown = err;
      }

      expect(thrown?.code).toBe("PROVIDER_OVERLOADED");
      expect(thrown?.providerDetail).toBe("This model is currently experiencing high demand.");
      expect(Array.isArray(thrown?.attemptedModels)).toBe(true);
      expect(thrown.attemptedModels.length).toBe(geminiService.MAX_ATTEMPTS_PER_REQUEST);
      expect(new Set(thrown.attemptedModels)).toEqual(new Set(["a", "b"]));
      // Spread evenly across the two candidates, not four attempts at the first one.
      const counts = thrown.attemptedModels.reduce((acc: Record<string, number>, m: string) => {
        acc[m] = (acc[m] ?? 0) + 1;
        return acc;
      }, {});
      expect(Math.abs(counts.a - counts.b)).toBeLessThanOrEqual(1);
    } finally {
      if (oldModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = oldModel;
      if (oldFallbacks === undefined) delete process.env.GEMINI_MODEL_FALLBACKS;
      else process.env.GEMINI_MODEL_FALLBACKS = oldFallbacks;
    }
  });
});
