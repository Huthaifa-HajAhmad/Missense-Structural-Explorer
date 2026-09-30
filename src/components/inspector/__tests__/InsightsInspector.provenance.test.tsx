// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsightsInspector } from "../InsightsInspector";
import { NarrativeProvenanceRow } from "../NarrativeProvenanceRow";
import { SettingsProvider } from "../../../context/SettingsContext";

/**
 * The Insights rail's telemetry card stated four facts and three were false.
 *
 *     Inference Model:      Clinical LLM Engine     <- a category, not the model that answered
 *     Generation Mode:      Structured Clinical Schema
 *     Sampling Temperature: 0.2 (Deterministic)     <- the call sets 0.0, and 0.2 is not deterministic
 *     Status:               Inference Ready         <- rendered identically with no key and after a failure
 *
 * Beside it, the ACMG audit trace labelled the rule engine's own PP3/PP2/PM2 as "AI Inferred" while
 * the card in the main column labelled the same codes "DATABASE-VERIFIED".
 *
 * This rail is the surface a curator opens to ask *where did this come from*, so both are provenance
 * defects rather than copy defects. Each assertion below is paired with the literal it replaced.
 */

const MODEL = "gemini-3.7-flash";

function renderRow(result: any, isNarrativeLoading = false) {
  return render(
    <SettingsProvider>
      <NarrativeProvenanceRow analysisResult={result} isNarrativeLoading={isNarrativeLoading} />
    </SettingsProvider>
  );
}

describe("Insights rail — inference provenance", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names the model that answered, from the payload", () => {
    renderRow({
      analysis: "A narrative.",
      insights: { model: MODEL, source: "ai_inference" },
    });

    expect(screen.getByText(MODEL)).toBeInTheDocument();
    // The category label it replaced carried no information about which engine produced the text.
    expect(screen.queryByText("Clinical LLM Engine")).not.toBeInTheDocument();
  });

  it("says 'Not recorded' when the payload carries no model, rather than naming the ladder's head", () => {
    renderRow({ analysis: "A narrative.", insights: { biochemicalShift: "x" } });

    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.queryByText(MODEL)).not.toBeInTheDocument();
  });

  it("reports the sampling settings the call actually uses", () => {
    renderRow({ analysis: "A narrative.", insights: { model: MODEL } });

    // Greedy decoding at temperature 0, which is what makes re-synthesis reproducible.
    expect(screen.getByText("0 (greedy, repeatable)")).toBeInTheDocument();
    // The literals that were wrong, in both parts: the value and the claim made about it.
    expect(screen.queryByText(/0\.2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\(Deterministic\)/)).not.toBeInTheDocument();
  });

  it("does not claim 'Inference Ready' before any synthesis has run", () => {
    renderRow(null);

    expect(screen.queryByText("Inference Ready")).not.toBeInTheDocument();
    // With no configured key the honest state is that synthesis is not available yet.
    expect(screen.getByText(/AI not configured|Narrative not generated/i)).toBeInTheDocument();
  });

  it("marks a degraded narrative as rule-based, not as an AI synthesis", () => {
    renderRow({
      analysis: "### Rule-Based Clinical Summary\n\nAssembled from database evidence.",
      isFallback: true,
      fallbackReason: "PROVIDER_OVERLOADED",
      insights: { biochemicalShift: "Not synthesized", structuralImpact: "Not synthesized", acmgCriteria: [], source: "rule_based" },
    });

    expect(screen.queryByText("Inference Ready")).not.toBeInTheDocument();
    // The authored-by row says it outright. `deriveAiStatus`'s own label for this run is "AI service
    // busy", which reports what happened to the provider and says nothing about who wrote the prose.
    expect(screen.getByText("Prose source")).toBeInTheDocument();
    expect(screen.getByText("Rule-based")).toBeInTheDocument();
    expect(screen.getByText(/No model produced this text/i)).toBeInTheDocument();
    // Inference parameters describe a call that never returned, so they are not reported.
    expect(screen.queryByText("Sampling")).not.toBeInTheDocument();
    expect(screen.queryByText(MODEL)).not.toBeInTheDocument();
  });

  it("reports AI authorship and its parameters when a model produced the text", () => {
    renderRow({ analysis: "A narrative.", insights: { model: MODEL, source: "ai_inference" } });

    expect(screen.getByText("AI synthesis")).toBeInTheDocument();
    expect(screen.getByText("Sampling")).toBeInTheDocument();
    expect(screen.queryByText(/No model produced this text/i)).not.toBeInTheDocument();
  });

  it("reports a synthesis in flight as in flight", () => {
    renderRow({ analysis: "", insights: null }, true);
    expect(screen.getByText(/synthesizing/i)).toBeInTheDocument();
    expect(screen.queryByText("Inference Ready")).not.toBeInTheDocument();
  });

  it("lists the models attempted when the payload carries them", () => {
    renderRow({
      analysis: "A narrative.",
      insights: { model: MODEL },
      attemptedModels: ["gemini-3.7-flash", "gemini-3.5-flash"],
    });

    expect(screen.getByText("gemini-3.7-flash \u2192 gemini-3.5-flash")).toBeInTheDocument();
  });
});

describe("Insights rail — how the case was built", () => {
  const RESULT = {
    metadata: { gene: "CNNM2", variant: "p.Ser489Cys", acmgWeighting: "standard" },
    analysis: "A narrative.",
    predictorData: { caddPhred: 26.3, amPathogenicity: 0.362, amClass: "ambiguous" },
    conservationData: { revel: 0.231, metarnn: 0.529, clinpred: 0.977 },
    ruleBasedInsights: {
      plausibility: "",
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree" }],
      partialEvidence: { available: [], unavailable: [] },
    },
    insights: {
      model: MODEL,
      source: "ai_inference",
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [
        { code: "PP3", reason: "3/6 predictors agree", source: "database_verified" },
        { code: "PM2", reason: "counts not provided in the prompt", source: "ai_suggested" },
        { code: "PS3", reason: "assay in an abstract", source: "ai_suggested" },
      ],
    },
  } as any;

  const renderRail = (result: any = RESULT) =>
    render(
      <SettingsProvider>
        <InsightsInspector analysisResult={result} />
      </SettingsProvider>
    );

  it("counts only the engine's criteria and says which proposals were left out or listed", () => {
    renderRail();
    const trace = screen.getByTestId("insights-trace");
    expect(trace).toHaveTextContent("PP3");
    expect(trace).toHaveTextContent(/Left out, because the engine decides them:\s*PM2/);
    expect(trace).toHaveTextContent(/Listed, not counted:\s*PS3/);
    expect(trace).toHaveTextContent("It proposed 2 criteria.");
  });

  it("does not claim the prose was reconciled with the rules", () => {
    renderRail();
    expect(screen.getByText(/The prose is not checked against the criteria/)).toBeInTheDocument();
    expect(screen.queryByText(/reconciled with rule-based/i)).not.toBeInTheDocument();
  });

  it("reads the in-silico vote live from the predictor model", () => {
    renderRail();
    expect(screen.getByText("Pathogenic")).toBeInTheDocument();
    expect(screen.getByText(/REVEL/)).toBeInTheDocument();
  });

  it("warns when the recorded tier differs from the current combining rule", () => {
    renderRail({ ...RESULT, ruleBasedInsights: { ...RESULT.ruleBasedInsights, acmgVerdict: "Likely Pathogenic" } });
    expect(screen.getByText(/an earlier engine classified this payload/)).toBeInTheDocument();
  });

  it("says the synthesis directions shown are the search box's, not the run's", () => {
    renderRail();
    expect(screen.getByText(/The run does not record the directions it used/)).toBeInTheDocument();
  });

  it("says so when there is nothing to show", () => {
    renderRail(null);
    expect(screen.getByText(/Run a variant/)).toBeInTheDocument();
  });
});
