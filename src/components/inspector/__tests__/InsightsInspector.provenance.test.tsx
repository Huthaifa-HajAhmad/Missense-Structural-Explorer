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

describe("Insights rail — ACMG criteria provenance", () => {
  /**
   * The contradiction, reproduced: PP3 is present in the server's merged, tagged list AND in the raw
   * rule-engine list the client also receives. The rail used to dedupe both with a last-wins Map, so
   * the untagged copy won and PP3 rendered as a model suggestion.
   */
  const RESULT = {
    metadata: { gene: "CNNM2", variant: "p.Ser489Cys" },
    insights: {
      model: MODEL,
      acmgCriteria: [
        { code: "PP3", reason: "4/10 predictors agree on pathogenic impact.", source: "database_verified" },
        { code: "PP2", reason: "Missense variant in a gnomAD-constrained gene.", source: "database_verified" },
        { code: "PS3", reason: "Functional assay reported in the literature.", source: "ai_suggested" },
      ],
    },
    ruleBasedInsights: {
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [
        { code: "PP3", reason: "4/10 predictors agree on pathogenic impact." },
        { code: "PP2", reason: "Missense variant in a gnomAD-constrained gene." },
      ],
    },
    attemptedModels: [MODEL],
  } as any;

  function renderRail(result: any = RESULT) {
    return render(
      <SettingsProvider>
        <InsightsInspector analysisResult={result} />
      </SettingsProvider>
    );
  }

  it("labels a rule-engine criterion as database-verified, never as AI-inferred", () => {
    renderRail();

    expect(screen.getByText("PP3")).toBeInTheDocument();
    // The defect: this rail said "AI Inferred" for the rule engine's own codes, contradicting the
    // "DATABASE-VERIFIED" chip the card beside it printed for the same code.
    expect(screen.queryByText(/AI Inferred/i)).not.toBeInTheDocument();
    // Two of the three came from the rule engine; only PS3 is the model's.
    expect(screen.getAllByText("Database-verified")).toHaveLength(2);
    expect(screen.getAllByText("AI-inferred")).toHaveLength(1);
  });

  it("still labels a model-proposed code as AI-inferred", () => {
    renderRail();
    expect(screen.getByText("AI-inferred")).toBeInTheDocument();
  });

  it("counts every criterion it renders, including the ones past a former scroll cut-off", () => {
    renderRail();

    // The header said "3 Met" while the max-height container showed two cards and hid the third.
    expect(screen.getByText("3 Met")).toBeInTheDocument();
    for (const code of ["PP3", "PP2", "PS3"]) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it("renders the rule-engine fallback when no narrative has run yet", () => {
    renderRail({
      metadata: { gene: "CNNM2", variant: "p.Ser489Cys" },
      insights: null,
      ruleBasedInsights: {
        acmgVerdict: "Variant of Uncertain Significance (VUS)",
        acmgCriteria: [{ code: "PM2", reason: "Extremely rare in gnomAD." }],
      },
    });

    expect(screen.getByText("PM2")).toBeInTheDocument();
    expect(screen.getByText("Database-verified")).toBeInTheDocument();
    expect(screen.queryByText("AI-inferred")).not.toBeInTheDocument();
  });
});
