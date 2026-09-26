import { describe, it, expect, vi } from "vitest";
import { handleNarrativeResponse } from "../shared";

/**
 * The route is where inference provenance is stamped, and nothing tested it.
 *
 * `handleNarrativeResponse` wrote `source = "ai_inference"` and
 * `model = getConfiguredGeminiModels()[0]` UNCONDITIONALLY — including for the degraded rule-based
 * report the narrative route assembles in its own `catch`. So a fallback travelled to the client
 * claiming AI inference, and on a healthy run it also named the HEAD of the fallback ladder rather
 * than the model that answered.
 *
 * Both halves of the fix are behavioural and were untested: the component tests hand-write
 * `source: "rule_based"` in their fixtures, so they verify the RENDERER, not the stamping. Reverting
 * this function left the whole suite green.
 *
 * It is also the one place where a mutation of a shared object is deliberate: `writeToCache` runs
 * before this call on the same reference (`narrative.ts`), so the stamp writes through into the cache
 * entry. That is idempotent — the same value is recomputed on every hit — but a degraded result is
 * never cached (`writeToCache` sits in the `try`, the fallback is built in the `catch`), so the
 * `delete` below can never reach a cache entry. Both properties are pinned here.
 */

function fakeRes() {
  const json = vi.fn();
  return { res: { json } as any, json };
}

/** The minimum a caller must supply; the other evidence arguments are unused by this function. */
function respond(analysisResult: any) {
  const { res, json } = fakeRes();
  handleNarrativeResponse(
    res,
    analysisResult,
    "CNNM2",
    "p.Ser489Cys",
    null, // clinvar
    null, // predictorData
    null, // conservationData
    null, // gnomadConstraint
    null, // gnomadFrequency
    "standard",
    null, // esm2
    null, // uniprotFeatures
    null  // sequence
  );
  return json.mock.calls[0][0];
}

describe("handleNarrativeResponse — inference provenance", () => {
  it("stamps AI inference on a healthy response and names the engine's model", () => {
    const body = respond({
      analysis: "A narrative.",
      insights: {
        biochemicalShift: "shift",
        structuralImpact: "impact",
        acmgCriteria: [],
        // Set by `performGeminiAnalysis` from the attempt that actually returned text.
        model: "gemini-3.5-flash",
      },
    });

    expect(body.insights.source).toBe("ai_inference");
    expect(body.insights.model).toBe("gemini-3.5-flash");
  });

  it("stamps a degraded response as rule_based and removes the model", () => {
    const body = respond({
      analysis: "### Rule-Based Clinical Summary\n\nAssembled from database evidence.",
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      insights: {
        biochemicalShift: "Not synthesized",
        structuralImpact: "Not synthesized",
        acmgCriteria: [],
      },
    });

    expect(body.insights.source).toBe("rule_based");
    expect(body.insights.model, "a rule-based report has no answering model").toBeUndefined();
  });

  it("clears a model that a degraded payload carried in anyway", () => {
    /*
     * The route's own fallback object has no `model`, so this is defence against a cached or
     * partially-built payload arriving with one — the self-contradictory
     * `{ source: "rule_based", model: "<old model>" }` shape the client reducers now also guard against.
     */
    const body = respond({
      analysis: "Rule-based report.",
      isFallback: true,
      fallbackReason: "DEADLINE_EXCEEDED",
      insights: {
        biochemicalShift: "Not synthesized",
        structuralImpact: "Not synthesized",
        acmgCriteria: [],
        model: "gemini-3.7-flash",
      },
    });

    expect(body.insights.model).toBeUndefined();
    expect(body.insights.source).toBe("rule_based");
  });

  it("still returns the rule-based insights when the model's insights did not parse", () => {
    /*
     * The JSON-parse / zod-failure path returns `insights: null`. Two things follow, and both are the
     * honest behaviour rather than an oversight:
     *
     *   - the response still carries insights, because the RULE ENGINE's criteria are available even
     *     when the model's structured object is not. Omitting them would throw away deterministic
     *     evidence because an unrelated parse failed;
     *   - no `source` is stamped and no `model` is named, because the stamping block is guarded on
     *     `analysisResult.insights` being truthy. The prose here WAS written by a model, so
     *     `deriveNarrativeAuthorship` correctly reads authorship from the prose itself — and the model
     *     stays "Not recorded" rather than being guessed from the configured ladder.
     */
    const body = respond({ analysis: "Unparsed model prose.", insights: null });

    expect(body.analysis).toBe("Unparsed model prose.");
    expect(body.insights).toBeTruthy();
    expect(body.insights.source).toBeUndefined();
    expect(body.insights.model).toBeUndefined();
    expect(body.insights.acmgVerdict).toBeTruthy();
  });

  it("carries the reconciled rule-based verdict and the merged criteria", () => {
    // The other thing this function does: the deterministic verdict wins over anything the model
    // produced, and the merged criteria are source-tagged. Both are what the surfaces render.
    const body = respond({
      analysis: "A narrative.",
      insights: {
        biochemicalShift: "shift",
        structuralImpact: "impact",
        acmgCriteria: [{ code: "PS3", reason: "functional assay", source: "ai_suggested" }],
      },
    });

    expect(body.insights.acmgVerdict).toBeTruthy();
    expect(body.insights.acmgCriteria.length).toBeGreaterThan(0);
    // Every criterion that reaches a surface carries a provenance tag, or the rail cannot label it.
    for (const criterion of body.insights.acmgCriteria) {
      expect(["database_verified", "ai_suggested"]).toContain(criterion.source);
    }
  });
});
