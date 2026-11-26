// @vitest-environment jsdom
/** The band-edge labels share one row, so no calibrated tool may print two on top of each other. */
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreRuler } from "./ScoreRuler";
import { buildPredictorEvidence } from "../../../shared/predictorEvidence";

/** The ruler's own estimate of one digit's width, as a share of the track. */
const CHAR_PCT = 1.3;

const calibrated = buildPredictorEvidence({
  result: { metadata: { gene: "G", variant: "p.Gly1Arg" }, conservationData: {}, predictorData: {} } as any,
}).readings.filter(r => r.cutpoints.kind === "calibrated");

describe("ScoreRuler labels", () => {
  it("covers every calibrated tool", () => {
    expect(calibrated.map(r => r.key)).toEqual(expect.arrayContaining(["revel", "bayesdel", "am", "esm", "cadd", "phylop", "gerp"]));
  });

  it.each(calibrated.flatMap(r => (["entry", "all"] as const).map(mode => [r.key, mode, r] as const)))(
    "%s (%s edges): labels stay apart and clear of both axis ends",
    (_key, mode, reading) => {
      const { container } = render(<ScoreRuler reading={reading} thresholds={mode} />);
      const ends = Array.from(container.querySelectorAll(".prd-ruler__axis > span:not([class])")).map(n => (n.textContent ?? "").length * CHAR_PCT);
      const spans = Array.from(container.querySelectorAll<HTMLElement>(".prd-ruler__cut"))
        .map(n => ({ from: parseFloat(n.style.left), to: parseFloat(n.style.left) + (n.textContent ?? "").length * CHAR_PCT }));
      expect(spans.length).toBeGreaterThan(0);
      expect(spans[0].from).toBeGreaterThanOrEqual(ends[0]);
      expect(spans.at(-1)!.to).toBeLessThanOrEqual(100 - ends[1]);
      spans.slice(1).forEach((s, i) => expect(s.from).toBeGreaterThanOrEqual(spans[i].to));
    },
  );
});
