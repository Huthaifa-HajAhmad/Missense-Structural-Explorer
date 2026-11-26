// @vitest-environment jsdom
/**
 * A held PM2 shares the verdict `none` with "between the cut-points", but the frequency is BELOW the
 * PM2 ceiling. Every surface that shows the verdict must say PM2 was withheld, and a saved result that
 * still counts the old PM2 must be recomputed instead of shown beside that wording.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClinicalTab } from "../evidence/ClinicalTab";
import { PopulationRail } from "../inspector/PopulationRail";
import { buildPopulationComparison } from "../../shared/evidenceComparison.ts";
import { frequencyEvidenceForResult, recordsHeldPm2 } from "../../shared/frequencyEvidence.ts";
import { functionEvidenceInputFrom } from "../../shared/functionEvidenceInput.ts";
import { buildInsightsEvidence } from "../../shared/insightsEvidence.ts";

const abcg1 = (over: Record<string, unknown> = {}) => ({
  metadata: { gene: "ABCG1", variant: "p.Gly358Arg", uniprotId: "P45844" },
  gnomadFrequency: {
    maxAF: 651 / 1613518, groupMaxAF: 651 / 1613518, genomeAF: null, exomeAF: null,
    genomeAC: 651, genomeAN: 1613518, exomeAC: null, exomeAN: null, nHomozygous: 6, dataset: "gnomad_r4_local", standIn: "grace",
  },
  serviceStatus: { gnomadFrequency: "stand-in", clinvar: "ok" },
  predictorData: { gnomadVariantId: "21-42287987-G-A", gnomadVariantAssembly: "GRCh38" },
  gnomadConstraint: { pli: 0 },
  ruleBasedInsights: { acmgCriteria: [] },
  ...over,
} as any);

const heldCandidates = () => abcg1({
  gnomadFrequency: {
    maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null, nHomozygous: null, dataset: "gnomad_r4",
    candidates: [
      { id: "4-1804392-G-A", grch37Id: "4-1806119-G-A", outcome: "not-found", frequency: null },
      {
        id: "4-1804392-G-C", grch37Id: "4-1806119-G-C", outcome: "found",
        frequency: { maxAF: 0.0004, groupMaxAF: 0.0004, genomeAF: 0.0004, exomeAF: null, genomeAC: 4, genomeAN: 10000, exomeAC: null, exomeAN: null, nHomozygous: 3, dataset: "gnomad_r4" },
      },
    ],
  },
  serviceStatus: { gnomadFrequency: "ok" },
  predictorData: {
    gnomadVariantId: null, gnomadVariantAssembly: null,
    locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [] },
  },
});

const renderTab = (result: unknown) => render(<ClinicalTab {...({ analysisState: { result } } as any)} />);

describe("a held PM2 on screen", () => {
  it("is carried on the criterion", () => {
    expect(frequencyEvidenceForResult(abcg1()).criterion.pm2Hold?.kind).toBe("homozygotes");
  });

  it("highlights no zone on the frequency scale and says PM2 is withheld", () => {
    renderTab(abcg1());
    const scale = screen.getByTestId("frequency-scale");
    expect(scale.getAttribute("aria-label")).toMatch(/at or below the 0\.1% PM2 ceiling, but PM2 is withheld/);
    expect(scale.querySelector("[data-active]")).toBeNull();
  });

  it("is not worded as between the cut-points in the rail", () => {
    render(<PopulationRail analysisResult={abcg1({ ruleBasedInsights: undefined })} />);
    const trace = screen.getByTestId("rule-trace");
    expect(trace.textContent).toContain("PM2 withheld");
    expect(trace.textContent).toContain("6 homozygotes");
    expect(trace.textContent).not.toContain("between cut-points");
  });

  it("leads Insights with the hold", () => {
    const result = abcg1();
    const lane = buildInsightsEvidence({ result, functionInput: functionEvidenceInputFrom(result), stability: null }).lanes.find(l => l.key === "population")!;
    expect(lane.lead).toBe("PM2 is withheld.");
    expect(lane.rest).toContain("6 homozygotes");
  });

  it("marks the candidate row that holds it", () => {
    const result = heldCandidates();
    renderTab(result);
    const rows = within(screen.getByTestId("candidate-alleles")).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("PM2 · Supporting");
    expect(rows[1].textContent).toContain("PM2 withheld");
    const chart = buildPopulationComparison(frequencyEvidenceForResult(result)).rows.filter(r => r.group === "gnomad-candidate");
    expect(chart[1].facts?.find(f => f.label === "Supports")?.value).toBe("PM2 withheld");
  });

  it("does not claim the All of Us column feeds no criterion", () => {
    const result = heldCandidates();
    result.gnomadFrequency.candidates[0].allOfUs = { localTable: "found", frequency: { aouAC: 4, aouAN: 400000, aouHet: 4, aouHom: 0 } };
    renderTab(result);
    expect(screen.getByRole("columnheader", { name: /All of Us AF/ }).textContent).toContain("can withhold PM2");
  });
});

describe("a saved result that still counts the old PM2", () => {
  const counted = { ruleBasedInsights: { acmgCriteria: [{ code: "PM2" }] } };

  it("is recognised as outdated", () => {
    expect(recordsHeldPm2(abcg1(counted))).toBe(true);
  });

  it("is not outdated once the engine recorded no PM2, or when nothing holds it", () => {
    expect(recordsHeldPm2(abcg1())).toBe(false);
    const rare = abcg1({
      ...counted,
      gnomadFrequency: { maxAF: 1e-6, groupMaxAF: 1e-6, genomeAF: 1e-6, exomeAF: null, nHomozygous: 0, dataset: "gnomad_r4" },
      serviceStatus: { gnomadFrequency: "ok" },
    });
    expect(recordsHeldPm2(rare)).toBe(false);
  });
});
