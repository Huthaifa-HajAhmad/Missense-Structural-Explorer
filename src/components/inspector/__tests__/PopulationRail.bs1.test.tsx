// @vitest-environment jsdom
/**
 * The Population rail must describe BS1 the way the engine applies it: BS1 is not counted in this app,
 * so the rail may not say BS1 "read FAF95". BA1 reads FAF95; the BS1 reference value is shown only.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PopulationRail } from "../PopulationRail";

/** UROD p.Gly318Arg as gnomAD r4 serves it: FAF95 1.62% is above the 1% BS1 reference, below the BA1 cut-point. */
const uroD = () => ({
  metadata: { gene: "UROD", variant: "p.Gly318Arg", uniprotId: "P06132" },
  gnomadFrequency: {
    maxAF: 0.004872, groupMaxAF: 1272 / 75018, genomeAF: 0.004872, exomeAF: 0.000638,
    genomeAC: 742, exomeAC: 932, genomeAN: 152292, exomeAN: 1461706, nHomozygous: 15,
    dataset: "gnomad_r4", groupMaxPopulation: "afr", faf95: 0.01618, faf95Population: "afr",
  },
  serviceStatus: { gnomadFrequency: "ok", clinvar: "ok" },
  predictorData: { gnomadVariantId: "1-45015346-G-A", gnomadVariantAssembly: "GRCh38" },
  gnomadConstraint: { pli: 0 },
  curatedInheritance: { source: "GenCC", modes: ["Autosomal dominant"], recessiveOnly: false, sexOrMitoOnly: false, records: 2 },
  ruleBasedInsights: { acmgCriteria: [] },
} as any);

describe("Population rail — BS1 is a reference, not a counted criterion", () => {
  it("does not say BS1 reads FAF95", () => {
    render(<PopulationRail analysisResult={uroD()} />);
    expect(screen.queryByText(/BA1\/BS1 read FAF95/)).toBeNull();
    expect(screen.getByText(/BA1 reads FAF95/)).toBeTruthy();
  });

  it("states that the BS1 reference value is shown and not counted", () => {
    render(<PopulationRail analysisResult={uroD()} />);
    expect(screen.getByText(/BS1 reference value is shown, not counted/)).toBeTruthy();
  });

  it("words the engine's missing criterion as No criterion, the screen's own word", () => {
    render(<PopulationRail analysisResult={uroD()} />);
    expect(screen.getByTestId("rule-trace").textContent).toContain("No criterion");
    expect(screen.getByTestId("rule-trace").textContent).not.toContain("None recorded");
  });
});

/** A PM2 case: the grouped maximum sits between the cut-points' ceiling and BS1, so the ceiling is read. */
const pm2Case = () => ({
  ...uroD(),
  gnomadFrequency: {
    maxAF: 0.0005, groupMaxAF: 0.0005, genomeAF: 0.0005, exomeAF: 0.0003,
    genomeAC: 214, exomeAC: 96, genomeAN: 428482, exomeAN: 320000, nHomozygous: 0,
    dataset: "gnomad_r4", groupMaxPopulation: "afr", faf95: 0.00001, faf95Population: "afr",
  },
});

describe("Population rail — the PM2 inheritance names its source", () => {
  it("says the inheritance comes from the gene-level GenCC record, not the picked disease", () => {
    render(<PopulationRail analysisResult={pm2Case()} />);
    expect(screen.getByTestId("ceiling-basis").textContent).toContain("curated GenCC inheritance includes Autosomal dominant");
    expect(screen.getByTestId("ceiling-source").textContent).toContain("the gene's GenCC record");
    expect(screen.getByTestId("ceiling-source").textContent).toContain("not the disease picked on Gene–disease");
  });
});

describe("Population rail — plain words for the ceiling and the grouped maximum", () => {
  it("says a benign rule decided first, instead of 'fired before the ceiling was consulted'", () => {
    render(<PopulationRail analysisResult={uroD()} />);
    expect(screen.getByText(/A benign rule decided this first, so the PM2 ceiling was not checked\./)).toBeTruthy();
  });

  it("glosses grpmax once, in words a reader can follow", () => {
    render(<PopulationRail analysisResult={pm2Case()} />);
    expect(screen.getByText(/Highest frequency across gnomAD's ancestry groups \(grpmax/)).toBeTruthy();
  });
});
