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
    expect(within(section).getByRole("button", { name: /Residue conservation/ })).toBeInTheDocument();
    // The calibrated tools in the fixed order are traced above, not listed as informational.
    expect(within(section).queryByRole("button", { name: /ESM1b|REVEL/ })).toBeNull();
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

  it("traces the fixed order on a candidate run, keeps CADD out of it, and separates CADD vs AlphaMissense sources", () => {
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
    expect(trace.textContent).toContain("First with a score");
    expect(trace.textContent).toContain("REVEL 0.234");
    expect(trace.textContent).not.toContain("CADD");
    // Several candidate alleles: SpliceAI was not asked, so BP4 is withheld and the sentence says why.
    expect(trace.textContent).toContain("No BP4: REVEL 0.234 reads BP4, but the protein change maps to multiple nucleotide alleles");

    const rail = screen.getByTestId("predictors-rail");
    expect(rail.textContent).toContain("ProtVar");
    expect(rail.textContent).toContain("Ensembl VEP (GRCh38)");
  });

  it("shows VCEP specification details and Walker 2023 splicing PP3 wording in the rule trace", () => {
    const ptenResult: any = {
      ...result,
      metadata: { gene: "PTEN", variant: "p.Arg130Gln", acmgWeighting: "standard" },
      conservationData: { ...result.conservationData, revel: 0.95, spliceai: { max_ds: 0.01 } },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3", reason: "PTEN VCEP" }] },
    };
    render(<EvidenceWorkspaceProvider result={ptenResult}><PredictorsRail analysisResult={ptenResult} /></EvidenceWorkspaceProvider>);
    const trace = screen.getByTestId("predictor-rule-trace");
    expect(trace.textContent).toContain("GN003 v3.2");
    expect(trace.textContent).toContain("applies splicing PP3 once when PVS1 is absent");

    const rail = screen.getByTestId("predictors-rail");
    expect(rail.textContent).toContain("active ClinGen VCEP specification");
  });

  it("renders dynamic splicePp3Corroboration, VCEP notes, and marks CADD counted when active on CEP290", () => {
    const gba1Corrob: any = {
      ...result,
      metadata: { gene: "GBA1", variant: "p.Asn370Ser", acmgWeighting: "standard" },
      conservationData: { ...result.conservationData, revel: 0.95, spliceai: { max_ds: 0.45 } },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3_Strong", reason: "REVEL 0.95" }] },
    };
    const first = render(<EvidenceWorkspaceProvider result={gba1Corrob}><PredictorsRail analysisResult={gba1Corrob} /></EvidenceWorkspaceProvider>);
    expect(screen.getByTestId("predictor-rule-trace").textContent).toContain("SpliceAI max Δ 0.45 also supports splicing PP3");
    first.unmount();

    const cep290: any = {
      ...result,
      metadata: { gene: "CEP290", variant: "p.Arg100Gln", acmgWeighting: "standard" },
      predictorData: { caddPhred: 28.5, amPathogenicity: 0.835 },
      conservationData: { ...result.conservationData, revel: 0.90, spliceai: { max_ds: 0.01 } },
      ruleBasedInsights: { acmgCriteria: [{ code: "PP3_Moderate", reason: "CEP290 CADD" }] },
    };
    const second = render(<EvidenceWorkspaceProvider result={cep290}><PredictorsRail analysisResult={cep290} /></EvidenceWorkspaceProvider>);
    expect(screen.getByTestId("predictor-bands-reached").textContent).not.toContain("CADD 28.5 · PP3 Moderate (not counted)");
    second.unmount();

    const palb2: any = {
      ...result,
      metadata: { gene: "PALB2", variant: "p.Leu100Pro", acmgWeighting: "standard" },
      conservationData: { ...result.conservationData, revel: 0.95, spliceai: { max_ds: 0.01 } },
      ruleBasedInsights: { acmgCriteria: [] },
    };
    render(<EvidenceWorkspaceProvider result={palb2}><PredictorsRail analysisResult={palb2} /></EvidenceWorkspaceProvider>);
    const excludedStep = screen.getByTestId("predictor-rule-trace").children[1];
    expect(excludedStep.getAttribute("data-state")).toBe("done");
  });
});
