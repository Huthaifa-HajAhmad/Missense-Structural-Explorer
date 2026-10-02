// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClinicalTab } from "../evidence/ClinicalTab";
import VariantHeader from "../VariantHeader";
import { PopulationRail } from "../inspector/PopulationRail";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

function result(retryable: boolean, failureKind?: string) {
  return {
    metadata: { gene: "KCNQ1", variant: "Q867H" },
    serviceStatus: { gnomadFrequency: "not_found" },
    predictorData: {
      gnomadVariantAssembly: "GRCh37",
      locusResolution: { route: "fallback", canonicalBy: null, retryable, failureKind, steps: [] },
    },
  } as any;
}

describe("safe locus recovery controls", () => {
  it("Provide nucleotide allele opens Search, retains original input, and does not run an allele", () => {
    const store = useVariantAnalysisStore.getState();
    store.setCustomVariant("NM_000218.3:c.100A>C");
    store.setCustomGenomic("chr11:100 A>C");
    const before = useVariantAnalysisStore.getState().rerunNonce;
    const navigate = vi.fn();
    render(<ClinicalTab {...({ analysisState: { result: result(false, "ambiguous-allele") }, onNavigateToView: navigate } as any)} />);
    expect(screen.queryByRole("button", { name: /Re-run/ })).toBeNull();
    expect(screen.queryByText("Provider error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Provide nucleotide allele" }));
    expect(navigate).toHaveBeenCalledWith("search");
    expect(useVariantAnalysisStore.getState()).toMatchObject({ customGene: "KCNQ1", customVariant: "NM_000218.3:c.100A>C", customGenomic: "chr11:100 A>C", showCustomInputs: true, rerunNonce: before });
  });

  it("definitive false does not offer input guessing or retry on the card", () => {
    render(<ClinicalTab {...({ analysisState: { result: result(false) }, onNavigateToView: vi.fn() } as any)} />);
    expect(screen.queryByRole("button", { name: /Re-run|Provide nucleotide/ })).toBeNull();
    expect(screen.queryByText("Provider error")).toBeNull();
    expect(screen.getByTestId("population-finding").textContent).not.toMatch(/lookup failure|retry|did not complete/i);
  });

  it("transient outages still offer the safe existing rerun action", () => {
    render(<ClinicalTab {...({ analysisState: { result: result(true, "transient-provider") } } as any)} />);
    const before = useVariantAnalysisStore.getState().rerunNonce;
    fireEvent.click(screen.getByRole("button", { name: "Re-run analysis" }));
    expect(useVariantAnalysisStore.getState().rerunNonce).toBe(before + 1);
  });

  it("the header uses the same ambiguity recovery and never advertises a retry", () => {
    const provide = vi.fn();
    render(<VariantHeader gene="KCNQ1" variant="Q867H" uniprotId="" analysisResult={result(false, "ambiguous-allele")} onProvideAllele={provide} />);
    expect(screen.getByTestId("run-state")).toHaveTextContent("Nucleotide allele needed");
    expect(screen.queryByRole("button", { name: "Re-run" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Provide nucleotide allele" }));
    expect(provide).toHaveBeenCalledOnce();
  });

  it("lineage explains ambiguity rather than alleging a failed provider", () => {
    render(<PopulationRail analysisResult={result(false, "ambiguous-allele")} />);
    expect(screen.getByTestId("fallback-locus-note")).toHaveTextContent("more than one nucleotide allele");
    expect(screen.getByTestId("fallback-locus-note").textContent).not.toMatch(/retry|did not complete/i);
  });
});


describe("All of Us source provenance", () => {
  const bound = {
    predictorData: { gnomadVariantId: "11-2799999-A-C", gnomadVariantAssembly: "GRCh38" },
    aouFrequency: { aouAC: 2, aouAN: 10000, aouHet: 2, aouHom: 0 },
  } as any;

  it.each([
    [null, "source not reported"],
    [{ localTable: "not-installed", remoteDbnsfp: "not-reported" }, "source not reported"],
    [{ localTable: "found", remoteDbnsfp: "not-reported" }, "local frequency table"],
    [{ localTable: "found", remoteDbnsfp: "found" }, "local frequency table"],
    [{ localTable: "not-installed", remoteDbnsfp: "found" }, "remote dbNSFP"],
    [{ localTable: "absent", remoteDbnsfp: "not-reported" }, "local frequency table (no entry)"],
    [{ localTable: "failed", remoteDbnsfp: "not-reported" }, "local frequency table (not read)"],
    [{ localTable: "timed-out", remoteDbnsfp: "not-reported" }, "local frequency table (not read)"],
  ])("names only the reported lookup %#", (aouLookup, expected) => {
    render(<PopulationRail analysisResult={{ ...bound, aouLookup } as any} />);
    expect(screen.getByTestId("aou-source").textContent).toBe(expected);
  });

  it("does not label unbound legacy protein counts as verified remote cohort provenance", () => {
    const unbound = result(false, "ambiguous-allele");
    unbound.predictorData.gnomadVariantId = null;
    unbound.aouFrequency = bound.aouFrequency;
    unbound.aouLookup = { localTable: "not-installed", remoteDbnsfp: "found" };
    render(<PopulationRail analysisResult={unbound} />);
    expect(screen.getByTestId("aou-source").textContent).toBe("source not reported");
  });
});
