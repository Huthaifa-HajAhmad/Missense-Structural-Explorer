// @vitest-environment jsdom
/**
 * The "ACMG rules" row counts criteria from every evidence tab, not only Population data. The row must
 * name the codes it counts, so a reader can tell which benign rule the "1" is.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PopulationRail } from "../PopulationRail";

const railResult = (criteria: Array<{ code: string }>) => ({
  metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" },
  gnomadFrequency: {
    maxAF: 0.0001, groupMaxAF: 0.0001, genomeAF: null, exomeAF: 0.0001,
    genomeAC: null, exomeAC: 3, genomeAN: null, exomeAN: 30000, nHomozygous: 0, dataset: "gnomad_r4",
  },
  serviceStatus: { gnomadFrequency: "ok", clinvar: "ok" },
  predictorData: { gnomadVariantAssembly: "GRCh38" },
  gnomadConstraint: { pli: 0 },
  ruleBasedInsights: { acmgCriteria: criteria },
} as any);

describe("Population rail — the ACMG rules row names the codes it counts", () => {
  it("lists each benign and pathogenic code rather than a bare count", () => {
    render(<PopulationRail analysisResult={railResult([{ code: "BP4" }, { code: "PM2" }, { code: "PP3" }])} />);
    const row = screen.getByText(/ACMG rules/).closest("div")!;
    expect(row.textContent).toContain("1 benign (BP4)");
    expect(row.textContent).toContain("2 pathogenic (PM2, PP3)");
  });

  it("says the row covers every evidence tab", () => {
    render(<PopulationRail analysisResult={railResult([{ code: "BP4" }])} />);
    expect(screen.getByText(/ACMG rules, all tabs/)).toBeTruthy();
  });
});
