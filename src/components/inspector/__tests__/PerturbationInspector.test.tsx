// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PerturbationInspector } from "../PerturbationInspector";

/**
 * Companion-pane coverage for the Structural Perturbation tab.
 *
 * The pane exists to stop the main column implying that a model-native ΔLLR has been
 * calibrated against something. These tests pin that contract, plus the two defects that
 * reached review because this file did not exist: a success-coloured "shared scale" badge
 * over an empty pool, and the pooled mean being described as if it were on one scale.
 */

const METADATA = {
  gene: "MACO1",
  variant: "p.Glu433Lys",
  wildType: "Glu",
  mutant: "Lys",
  residueIndex: 433
};

/** A usable evaluation. `llr` is deliberately model-native: none of these are calibrated. */
function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    llr: -6.2,
    wtProbability: 0.99,
    mutProbability: 0.02,
    mutRank: 18,
    positionalEntropy: 1.4,
    embeddingShift: 0.42,
    preferences: [],
    provenance: "ESMC-6B (Remote)",
    ...overrides
  };
}

function analysisWith(evaluations: Record<string, unknown> = {}) {
  return { metadata: METADATA, ...evaluations } as any;
}

describe("PerturbationInspector", () => {
  it("waits rather than rendering half a pane when there is no analysis", () => {
    render(<PerturbationInspector analysisResult={null} />);
    expect(screen.getByText(/Awaiting variant analysis data/)).toBeInTheDocument();
  });

  it("never states a calibrated verdict for a model that has no cut-point", () => {
    render(
      <PerturbationInspector
        analysisResult={analysisWith({
          esmcEval: evaluation(),
          esm2Eval: evaluation({ llr: -5.1, provenance: "ESM-2 650M (Local)" })
        })}
      />
    );

    // Every model on this tab is uncalibrated, so a calibrated verdict must never appear,
    // and no internal token may reach the reader: the badge maps all five verdicts.
    // Case-sensitive on purpose — the uppercase "Uncalibrated" is the registry's
    // legitimate status label, while the lowercase tokens are the internal enum values.
    for (const token of ["pathogenic", "benign", "intermediate", "unavailable", "uncalibrated"]) {
      expect(screen.queryByText(token)).not.toBeInTheDocument();
    }
    // The status is stated in words, and the reason is spelled out rather than implied
    // by a colour: either the registry's "Uncalibrated" badge or the "No cut-point" verdict.
    expect(screen.getAllByText(/^(Uncalibrated|No cut-point)$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No calibrated cut-point/i)).toBeInTheDocument();
  });

  it("does not claim a shared scale when no model contributed", () => {
    // Regression guard: with an empty pool the badge previously rendered a green "Yes"
    // directly beside "Models contributing 0", reporting success over no data.
    render(<PerturbationInspector analysisResult={analysisWith()} activePerturbationModel="saprot" />);

    expect(screen.getByText("Models contributing")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    // With nothing to compare there is no homogeneity claim to make.
    expect(screen.queryByText(/^Yes$/)).not.toBeInTheDocument();
  });

  it("flags a pool that spans different model families as not sharing a scale", () => {
    render(
      <PerturbationInspector
        analysisResult={analysisWith({
          esmcEval: evaluation({ llr: -8.43, provenance: "ESMC-6B (Remote)" }),
          saprotEval: evaluation({ llr: -0.031, provenance: "SaProt 650M AF2 (Local)" })
        })}
      />
    );

    // ESMC and SaProt are different families, so the pool mixes scales even though the
    // spread heuristic alone would be the only signal without registry families.
    expect(screen.getByText(/No — mixed/)).toBeInTheDocument();
    expect(screen.getByText(/do not share a score scale/)).toBeInTheDocument();
    // And the pooled mean must not be dressed up as a native quantity.
    expect(screen.queryByText(/model-native ΔLLR -4\.2/)).not.toBeInTheDocument();
  });

  it("reports a model that returned an error as absent rather than as a zero score", () => {
    render(
      <PerturbationInspector
        analysisResult={analysisWith({
          saprotEval: { error: "timeout", status: "timeout" },
          esmcEval: evaluation()
        })}
        activePerturbationModel="saprot"
      />
    );

    // A failed model must not fabricate a measurement, and must say so.
    expect(screen.getAllByText(/not returned/).length).toBeGreaterThan(0);
    expect(screen.queryByText("ΔLLR 0.00")).not.toBeInTheDocument();
  });

  it("describes the selected model's within-model rank without inverting it", () => {
    // rank 20 of 20 is the model's LEAST preferred substitution. An earlier revision
    // printed "top 5%" here, which read as strong preference.
    render(
      <PerturbationInspector
        analysisResult={analysisWith({ esmcEval: evaluation({ mutRank: 20, positionalEntropy: 3.9 }) })}
        activePerturbationModel="esmc"
      />
    );

    expect(screen.getByText(/20th of 20 by model preference/)).toBeInTheDocument();
    expect(screen.getByText(/least preferred substitutions/)).toBeInTheDocument();
    expect(screen.queryByText(/top 5%/)).not.toBeInTheDocument();
  });

  it("carries the notices relocated out of the main column", () => {
    render(
      <PerturbationInspector analysisResult={analysisWith({ esmcEval: evaluation(), esm3Eval: { structuralChangeLevel: "none" } })} />
    );

    // Each of these used to sit on the main canvas as inline prose.
    expect(screen.getByText(/Rigid-backbone caveat/i)).toBeInTheDocument();
    expect(screen.getByText(/4 Å heavy-atom cutoff/i)).toBeInTheDocument();
    expect(screen.getByText(/ΔSASA sign/i)).toBeInTheDocument();
    expect(screen.getByText(/hypothesis-generating model predictions/i)).toBeInTheDocument();
    // And the scale guide is reachable from the pane.
    expect(screen.getByRole("button", { name: /How To Read These Scales/i })).toBeInTheDocument();
  });

  it("discloses the scale guide without hiding the values behind it", () => {
    render(<PerturbationInspector analysisResult={analysisWith({ esmcEval: evaluation() })} />);

    const disclosure = screen.getByRole("button", { name: /How To Read These Scales/i });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    // The weights are part of the decomposition, not the guide, so they stay visible.
    expect(screen.getByText(/weight 0\.30/)).toBeInTheDocument();
  });
});
