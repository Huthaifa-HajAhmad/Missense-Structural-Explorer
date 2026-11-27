// @vitest-environment jsdom
/**
 * A gnomAD homozygote count must read the same on every surface: "1,234", not "1234" on one line
 * and "1,234" on another. The rail and the PM2 hold sentence both print the count.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PopulationRail } from "../PopulationRail";

const railResult = (nHomozygous: number, over: Record<string, unknown> = {}) => ({
  metadata: { gene: "ABCG1", variant: "p.Gly358Arg", uniprotId: "P45844" },
  gnomadFrequency: {
    maxAF: 0.0004, groupMaxAF: 0.0004, genomeAF: null, exomeAF: null,
    genomeAC: 400, genomeAN: 1000000, exomeAC: null, exomeAN: null, nHomozygous, dataset: "gnomad_r4",
  },
  serviceStatus: { gnomadFrequency: "ok", clinvar: "ok" },
  predictorData: { gnomadVariantId: "21-42287987-G-A", gnomadVariantAssembly: "GRCh38" },
  gnomadConstraint: { pli: 0 },
  ...over,
} as any);

describe("homozygote counts on the population rail", () => {
  it("prints the BS2 homozygote count with a thousands separator, as the table does", () => {
    render(<PopulationRail analysisResult={railResult(1234, { ruleBasedInsights: { acmgCriteria: [{ code: "BS2" }] } })} />);
    expect(screen.getByTestId("bs2-recorded").textContent).toContain("1,234 gnomAD homozygotes");
  });

  it("prints the PM2 hold's homozygote count with a thousands separator", () => {
    render(<PopulationRail analysisResult={railResult(1234, { ruleBasedInsights: undefined })} />);
    expect(screen.getByTestId("rule-trace").textContent).toContain("1,234 homozygotes");
  });
});
