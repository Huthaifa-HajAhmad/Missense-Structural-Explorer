// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmbeddingShiftChart } from "../EmbeddingShiftChart";

/**
 * The embedding-shift card, pinned against two defects that reached review together:
 *
 *  1. Its header printed "Max: 0.000 / Mean: 0.000" over a *missing* window. Both figures are
 *     statistics of that window, so a coerced zero read as a measured one — directly above the
 *     notice that no window was returned.
 *  2. The empty state blamed "this model" and reassured the reader that "the remaining metrics on
 *     this card are unaffected", when in fact the engine (the serverless masked-token API) withheld
 *     the per-residue embeddings and the card's own EMB. SHIFT figure was affected.
 */

const POINTS = [
  { x: 40, y: 100, position: 485, residue: "A", shift: 0.4 },
  { x: 64, y: 60, position: 486, residue: "S", shift: 0.9 },
  { x: 88, y: 30, position: 489, residue: "S", shift: 1.4 }
];

function renderChart(overrides: Record<string, unknown> = {}) {
  return render(
    <EmbeddingShiftChart
      activeEval={{ embeddingShift: 1.42, provenance: "SaProt (SaProt_650M_AF2 - Remote)" }}
      modelName="SaProt (SaProt_650M_AF2 - Remote)"
      pos={489}
      points={POINTS}
      pathD="M 40 100 L 64 60 L 88 30"
      shiftMetric="Euclidean Distance"
      meanShift={0.9}
      {...overrides}
    />
  );
}

/** The header is the only place these three labels appear. */
function headerText(container: HTMLElement): string {
  return container.querySelector("span.flex.items-center.gap-2")?.textContent || "";
}

describe("EmbeddingShiftChart", () => {
  it("draws the trace and reports the window statistics when a window is present", () => {
    const { container } = renderChart();

    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("path")).not.toBeNull();
    expect(headerText(container)).toContain("Max: 1.420");
    expect(headerText(container)).toContain("Mean: 0.900");
  });

  it("does not report window statistics over an absent window", () => {
    const { container } = renderChart({
      points: [],
      pathD: "",
      meanShift: 0,
      activeEval: { embeddingShift: 0, provenance: "SaProt (SaProt_650M_AF2 - Remote)" }
    });

    const header = headerText(container);
    expect(header).toContain("Max: —");
    expect(header).toContain("Mean: —");
    // The coerced zeros are exactly what this guards: the evaluation returned no window, so no
    // number in the header may read as a measurement of one.
    expect(header).not.toContain("0.000");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("attributes an absent window to the serverless engine rather than to the model", () => {
    const { container } = renderChart({
      points: [],
      pathD: "",
      meanShift: 0,
      activeEval: { embeddingShift: 0, provenance: "SaProt (SaProt_650M_AF2 - Remote)" }
    });

    const text = container.textContent || "";
    expect(text).toContain("SaProt (SaProt_650M_AF2 - Remote) returned no local shift window");
    expect(text).toContain("serverless engine");
    expect(text).toContain("position 489");
    // The claim that the rest of the card was unaffected was false: EMB. SHIFT came from the same
    // failed evaluation.
    expect(text).not.toContain("remaining metrics");
  });

  it("does not blame the engine when the provenance does not name one", () => {
    const { container } = renderChart({
      points: [],
      pathD: "",
      meanShift: 0,
      activeEval: { embeddingShift: 0, provenance: "SaProt (SaProt_35M_AF2 - Local CPU)" }
    });

    const text = container.textContent || "";
    expect(text).toContain("no per-residue shift map for this position");
    expect(text).not.toContain("serverless engine");
  });

  it("still reports KL divergence, which is a separate measurement from the window", () => {
    // ESM-2's remote path returns a real KL divergence with no window at all, so gating it on the
    // window would discard a genuine number.
    const { container } = renderChart({
      points: [],
      pathD: "",
      meanShift: 0,
      activeEval: {
        embeddingShift: 0,
        klDivergence: 0.184,
        provenance: "ESM-2 (esm2_t33_650M_UR50D - Remote)"
      }
    });

    expect(headerText(container)).toContain("KL Div: 0.184");
    expect(headerText(container)).not.toContain("Max: 0.000");
  });

  it("hides KL divergence when the evaluation did not report one", () => {
    const { container } = renderChart({
      activeEval: { embeddingShift: 1.42, klDivergence: null, provenance: "SaProt (SaProt_35M_AF2 - Local CPU)" }
    });

    expect(headerText(container)).not.toContain("KL Div");
  });
});
