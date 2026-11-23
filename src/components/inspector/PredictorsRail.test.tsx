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
    dann: 0.999, popeve: -3.931, gerp: 5.0, phylop: 4.91, scorecons: null,
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
    for (const heading of ["Other scores", "Not scored"]) {
      expect(within(section).getByRole("heading", { level: 4, name: heading })).toBeInTheDocument();
    }
    expect(within(section).getByRole("button", { name: /ESM1b/ })).toBeInTheDocument();
    expect(within(section).getByText(/never change PP3 \/ BP4/)).toBeInTheDocument();
  });

  it("shows no retired language-model rows or sources for an analysis saved with their results", () => {
    const saved: any = {
      ...result,
      esm2Eval: { llr: -4.78, provenance: "VESM-150M (Local Fallback)" },
      esmcEval: { llr: -9.55, provenance: "VESM-150M (Local Fallback - ESMC remote failed)" },
      saprotEval: { llr: -3.16, provenance: "VESM-150M (Local Fallback - SaProt unavailable)" },
    };
    const { container } = render(<EvidenceWorkspaceProvider result={saved}><PredictorsRail analysisResult={saved} /></EvidenceWorkspaceProvider>);
    expect(container.textContent).not.toMatch(/ESM-2|ESMC|VESM|SaProt/);
    expect(container.textContent).toContain("ESM1b");
  });

  it("explains candidate CADD disagreement under Not counted and separates CADD vs AlphaMissense sources", () => {
    const candidateResult: any = {
      ...result,
      predictorData: {
        caddPhred: null,
        amPathogenicity: 0.835,
        amClass: "likely_pathogenic",
        source: "Ensembl VEP (GRCh38)",
        locusResolution: {
          route: "fallback",
          canonicalBy: null,
          retryable: false,
          failureKind: "multiple-candidates",
          steps: [],
          candidates: [
            { grch37Id: null, id: "4-1804392-G-C", canonicalBy: "protvar", retryable: false, caddPhred: 24.5, caddSource: "ProtVar" },
            { grch37Id: null, id: "4-1804392-G-A", canonicalBy: "protvar", retryable: false, caddPhred: 25.7, caddSource: "ProtVar" },
          ],
        },
      },
    };
    render(<EvidenceWorkspaceProvider result={candidateResult}><PredictorsRail analysisResult={candidateResult} /></EvidenceWorkspaceProvider>);
    const trace = screen.getByTestId("predictor-rule-trace");
    expect(trace.textContent).toContain("Not counted:");
    expect(trace.textContent).toContain("CADD (Candidates disagree)");
    expect(trace.textContent).not.toContain("No score:");

    const rail = screen.getByTestId("predictors-rail");
    expect(rail.textContent).toContain("ProtVar");
    expect(rail.textContent).toContain("Ensembl VEP (GRCh38)");
  });
});
