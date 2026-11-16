// @vitest-environment jsdom
/**
 * FGFR3 p.Gly380Arg on protein-only input: G>A or G>C at one GRCh38 base. gnomAD is read once per
 * candidate, and the Population tab and its rail show one row per allele.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClinicalTab } from "../evidence/ClinicalTab";
import { EvidenceWorkspaceProvider } from "../evidence/EvidenceWorkspace";
import { PopulationRail } from "../inspector/PopulationRail";

const lifted = (alt: string) => ({ grch37Id: `4-1806119-G-${alt}`, id: `4-1804392-G-${alt}`, canonicalBy: "ensembl-lift", retryable: false });
const absent = (alt: string) => ({ id: `4-1804392-G-${alt}`, grch37Id: `4-1806119-G-${alt}`, outcome: "not-found", frequency: null });
const found = (alt: string, af: number, faf95 = af) => ({
  id: `4-1804392-G-${alt}`, grch37Id: `4-1806119-G-${alt}`, outcome: "found",
  frequency: { maxAF: af, groupMaxAF: af, genomeAF: null, exomeAF: af, genomeAC: null, exomeAC: 3, genomeAN: null, exomeAN: 1000000, nHomozygous: 0, dataset: "gnomad_r4", faf95 },
});

function result(readings: unknown[]) {
  return {
    metadata: { gene: "FGFR3", variant: "p.Gly380Arg" },
    serviceStatus: { gnomadFrequency: "ok" },
    gnomadConstraint: { pli: 0.99 },
    gnomadFrequency: { maxAF: null, groupMaxAF: null, genomeAF: null, exomeAF: null, nHomozygous: null, dataset: "gnomad_r4", candidates: readings },
    predictorData: {
      gnomadVariantId: null, gnomadVariantAssembly: null,
      locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [], candidates: [lifted("A"), lifted("C")] },
    },
  } as any;
}

describe("Population tab — several candidate alleles", () => {
  it("lists one row per allele with its GRCh38 id, change and verdict, and no 'provide allele' banner", () => {
    render(<ClinicalTab {...({ analysisState: { result: result([found("A", 0.000003), absent("C")]) }, onNavigateToView: vi.fn() } as any)} />);
    const rows = within(screen.getByTestId("candidate-alleles")).getAllByRole("row").slice(1);
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/4-1804392-G-A.*G>A.*3 \/ 1,000,000.*3\.00e-6.*PM2/),
      expect.stringMatching(/4-1804392-G-C.*G>C.*no record.*PM2/),
    ]);
    expect(screen.queryByRole("button", { name: /Provide nucleotide allele/ })).toBeNull();
    expect(screen.getByTestId("population-finding")).toHaveTextContent(/every candidate allele \(2\)/);
  });

  it("shows each candidate once in the workspace Comparison view: in the chart, not in a second table", () => {
    const r = result([found("A", 0.03, 0.02), found("C", 0.04, 0.03)]);
    render(
      <EvidenceWorkspaceProvider result={r}>
        <ClinicalTab {...({ analysisState: { result: r }, onNavigateToView: vi.fn() } as any)} />
        <PopulationRail analysisResult={r} />
      </EvidenceWorkspaceProvider>,
    );
    // The chart already lists every allele; a second table would print each figure twice.
    expect(screen.queryByTestId("candidate-alleles")).toBeNull();
    expect(screen.getByTestId("frequency-scale")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /chart/ })).toBeInTheDocument();
  });

  it("does not mislabel an unlifted candidate allele as GRCh38", () => {
    const r = result([absent("A"), { id: null, grch37Id: "4-1806119-G-C", outcome: "not-lifted", frequency: null }]);
    r.predictorData.locusResolution.candidates = [
      lifted("A"),
      { grch37Id: "4-1806119-G-C", id: null, canonicalBy: null, retryable: false },
    ];
    render(
      <EvidenceWorkspaceProvider result={r}>
        <ClinicalTab {...({ analysisState: { result: r }, onNavigateToView: vi.fn() } as any)} />
        <PopulationRail analysisResult={r} />
      </EvidenceWorkspaceProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /4-1806119-G-C \(GRCh37\)/ }));
    expect(screen.queryByText("Candidate allele (GRCh38)")).toBeNull();
    expect(screen.getByText("Candidate allele")).toBeInTheDocument();
  });

  it("shows why no criterion applies when the alleles disagree", () => {
    render(<ClinicalTab {...({ analysisState: { result: result([found("A", 0.03), absent("C")]) } } as any)} />);
    expect(screen.getByTestId("population-finding")).toHaveTextContent("Candidate alleles disagree");
    const rows = within(screen.getByTestId("candidate-alleles")).getAllByRole("row").slice(1);
    expect(rows.map(r => r.textContent)).toEqual([expect.stringMatching(/BS1/), expect.stringMatching(/PM2/)]);
  });

  it("shows the warning banner and Re-run action when a candidate lift or query failed", () => {
    const transient = { ...lifted("C"), id: null, canonicalBy: null, retryable: true };
    const r = result([absent("A"), { id: null, grch37Id: "4-1806119-G-C", outcome: "not-lifted", frequency: null, detail: "Ensembl lift timed out" }]);
    r.predictorData.locusResolution.candidates = [lifted("A"), transient];
    r.predictorData.locusResolution.retryable = true;
    render(<ClinicalTab {...({ analysisState: { result: r } } as any)} />);
    expect(screen.getByRole("button", { name: /Re-run analysis/ })).toBeInTheDocument();
  });

  it("displays the gnomAD release and binding homozygote count when BS2 is met across candidates", () => {
    const r = result([
      { ...found("A", 0.02), frequency: { ...found("A", 0.02).frequency, nHomozygous: 3 } },
      { ...found("C", 0.03), frequency: { ...found("C", 0.03).frequency, nHomozygous: 2 } },
    ]);
    r.ruleBasedInsights = { acmgCriteria: [{ code: "BS2", status: "met", source: "Population", reason: "2+ homozygotes" }] };
    render(
      <EvidenceWorkspaceProvider result={r}>
        <ClinicalTab {...({ analysisState: { result: r } } as any)} />
        <PopulationRail analysisResult={r} />
      </EvidenceWorkspaceProvider>,
    );
    expect(screen.getAllByText(/gnomAD v4/).length).toBeGreaterThan(0);
    expect(screen.getByText("gnomAD homozygotes (min across candidates)").closest("p")).toHaveTextContent(/2.*BS2/);
    expect(screen.getByTestId("bs2-recorded")).toHaveTextContent("2 gnomAD homozygotes (minimum across candidates)");
  });
});

describe("Population rail — several candidate alleles", () => {
  it("lists every candidate allele in the lineage and names the per-allele source and release", () => {
    render(<PopulationRail analysisResult={result([absent("A"), absent("C")])} />);
    const list = screen.getByTestId("rail-candidate-alleles");
    expect(within(list).getAllByRole("listitem").map(li => li.textContent)).toEqual([
      expect.stringMatching(/4-1804392-G-A.*G>A.*PM2/),
      expect.stringMatching(/4-1804392-G-C.*G>C.*PM2/),
    ]);
    expect(screen.getByTestId("rule-trace")).toHaveTextContent("gnomAD, read for each of 2 candidate alleles · v4");
  });
});

describe("candidate table details", () => {
  it("shows each allele's cDNA change beside its GRCh38 id", () => {
    const r = result([{ ...absent("A"), cdna: "ENST00000440486.8:c.1138G>A" }, absent("C")]);
    render(<ClinicalTab {...({ analysisState: { result: r } } as any)} />);
    const rows = within(screen.getByTestId("candidate-alleles")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("ENST00000440486.8:c.1138G>A");
  });

  it("describes every column in readable text, not only in a hover title", () => {
    render(<ClinicalTab {...({ analysisState: { result: result([absent("A"), absent("C")]) } } as any)} />);
    const headers = within(screen.getByTestId("candidate-alleles")).getAllByRole("columnheader");
    expect(headers.map(h => h.textContent)).toEqual([
      expect.stringContaining("Candidate allele"),
      expect.stringMatching(/gnomAD AC \/ AN.*allele count over allele number/),
      expect.stringMatching(/gnomAD AF.*frequency PM2 reads/),
      expect.stringMatching(/Supports.*this allele's own reading/),
    ]);
  });

  it("states a missing All of Us table once under the table, with no column of repeated notes", () => {
    const r = result([
      { ...absent("A"), allOfUs: { localTable: "not-installed", frequency: null } },
      { ...absent("C"), allOfUs: { localTable: "not-installed", frequency: null } },
    ]);
    render(<ClinicalTab {...({ analysisState: { result: r } } as any)} />);
    const table = screen.getByTestId("candidate-alleles");
    expect(within(table).queryByRole("columnheader", { name: /All of Us/ })).toBeNull();
    expect(screen.getAllByText(/No local All of Us table in this deployment\./)).toHaveLength(1);
  });
});

describe("All of Us for each candidate allele", () => {
  const counts = { aouAC: 4, aouAN: 400000, aouHet: 4, aouHom: 0 };
  const withAou = () => result([
    { ...absent("A"), allOfUs: { localTable: "found", frequency: counts } },
    { ...absent("C"), allOfUs: { localTable: "absent", frequency: null } },
  ]);

  it("adds an All of Us column to the Population table", () => {
    render(<ClinicalTab {...({ analysisState: { result: withAou() } } as any)} />);
    const table = screen.getByTestId("candidate-alleles");
    expect(within(table).getByRole("columnheader", { name: /All of Us AF/ })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("1.00e-5");
    expect(rows[1]).toHaveTextContent("Not in the local All of Us table.");
  });

  it("names each allele's All of Us figure in the rail", () => {
    render(<PopulationRail analysisResult={withAou()} />);
    const items = within(screen.getByTestId("rail-candidate-alleles")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/All of Us 1\.00e-5/);
    expect(items[1]).not.toHaveTextContent(/All of Us/);
  });
});
