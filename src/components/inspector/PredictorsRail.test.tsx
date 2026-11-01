// @vitest-environment jsdom
/**
 * PredictorsRail.test.tsx — the inspector renders the SAME informational summary as the tab.
 *
 * The rail is the second surface the polish task names; before this test only the tab's copy of the
 * summary was exercised, so a rail-only regression (or a heading-level break) went unnoticed.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { alphagenomeApiKey: "" }, openSettingsTab: vi.fn() }),
}));

import { PredictorsRail } from "./PredictorsRail";
import { EvidenceWorkspaceProvider } from "../evidence/EvidenceWorkspace";

const result: any = {
  metadata: { gene: "GZF1", variant: "p.Arg591Trp", uniprotId: "Q9H7S9", residueIndex: 591 },
  predictorData: { caddPhred: 29.5, amPathogenicity: 0.835, amClass: "likely_pathogenic" },
  conservationData: {
    revel: 0.234, bayesdel: 0.092, metarnn: 0.767, clinpred: 0.998, eigenPhred: 6.3,
    dann: 0.999, popeve: -3.931, gerp: 5.0, phylop: 4.91, consurf: null, gpnStar: -8.81,
    alphagenome: { status: "live", aviPhred: 26.4, topPercentile: 0.23, topModality: "AlphaMissense" },
    source: "Public dbNSFP (dbnsfp.org)",
  },
  esmcEval: { llr: -9.55 }, esm2Eval: { llr: -4.78 }, saprotEval: { llr: -3.16 },
};

describe("PredictorsRail", () => {
  it("shares the grouped informational summary with the tab, at the rail's heading level", () => {
    render(<EvidenceWorkspaceProvider result={result}><PredictorsRail analysisResult={result} /></EvidenceWorkspaceProvider>);
    const section = screen.getByRole("region", { name: "Local informational agreement" });
    expect(within(section).getByRole("heading", { level: 3, name: "Local agreement / informational" })).toBeInTheDocument();
    for (const heading of ["Published bands / not counted", "Sequence preference", "Not scored"]) {
      expect(within(section).getByRole("heading", { level: 4, name: heading })).toBeInTheDocument();
    }
    expect(within(section).getByRole("button", { name: /ESM-2/ })).toBeInTheDocument();
    expect(within(section).getByText(/never change PP3 \/ BP4/)).toBeInTheDocument();
  });
});
