// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FunctionTab } from "../FunctionInteractionsTabs";
import { FunctionRail } from "../../inspector/FunctionRail";
import type { TabComponentProps } from "../types";
import type { AnalysisResult } from "../../../types";
import { NAE1_UNIPROT } from "../../../shared/__tests__/fixtures/nae1FunctionalDomains";

function resultFor(overrides: Record<string, unknown> = {}): AnalysisResult {
  return {
    metadata: { gene: "NAE1", variant: "p.Asp116Gly", residueIndex: 116, wildType: "D", mutant: "G", uniprotId: "Q13564" },
    uniprotFeatures: NAE1_UNIPROT,
    serviceStatus: { uniprotFeatures: "ok" },
    ruleBasedInsights: { acmgCriteria: [{ code: "PM2" }, { code: "PP3" }] },
    ...overrides,
  } as unknown as AnalysisResult;
}

function renderTab(result: AnalysisResult, extra: Partial<TabComponentProps> = {}) {
  const props = {
    analysisState: { isLoading: false, error: null, result },
    energyUnit: "kcal/mol",
    formatDdGValue: () => "",
    setSelectedMetric: () => {},
    isDark: false,
    classCard: "",
    classCardHeader: "",
    classCardTitle: "",
    classBorderSec: "",
    classTextBody: "",
    classTextMute: "",
    foldingDdG: null,
    foldingStatus: null,
    ...extra,
  } as unknown as TabComponentProps;
  return render(<FunctionTab {...props} />);
}

describe("FunctionTab", () => {
  it("states the engine's PM1 record and the finding for NAE1 p.Asp116Gly", () => {
    renderTab(resultFor());
    expect(screen.getByTestId("pm1-verdict").textContent).toBe("PM1 not met");
    const sentence = screen.getByTestId("function-finding-sentence").textContent ?? "";
    expect(sentence).toMatch(/lies inside the THIF-type NAD\/FAD binding fold \(Pfam, 13–530\)/);
    expect(sentence).toMatch(/nearest known disease variant, Arg85Gln, is 31 residues upstream/);
    // The UBA3 region is a functional region, not "disorder".
    const table = screen.getByTestId("annotation-table");
    expect(within(table).queryByText(/Disorder and composition/)).toBeNull();
    expect(screen.getByTestId("not-annotated").textContent).toMatch(/active sites, binding sites, metal binding, disulfide bonds/);
  });

  it("marks the chip unconfirmed when the payload carries no engine record", () => {
    renderTab(resultFor({ ruleBasedInsights: undefined }));
    const chip = screen.getByTestId("pm1-verdict");
    expect(chip.textContent).toBe("PM1 not met · unconfirmed");
    expect(chip.hasAttribute("data-unconfirmed")).toBe(true);
  });

  it("says Running, not 'not annotated', before the record arrives", () => {
    renderTab(resultFor({ uniprotFeatures: null, serviceStatus: { uniprotFeatures: "pending" } }));
    expect(screen.getByTestId("pm1-verdict").textContent).toBe("PM1 not assessed");
    expect(screen.queryByTestId("annotation-table")).toBeNull();
    expect(screen.queryByTestId("not-annotated")).toBeNull();
    expect(screen.getByTestId("function-finding-sentence").textContent).toMatch(/Reading the UniProtKB feature table/);
  });

  it("reports a provider error as an error", () => {
    renderTab(resultFor({ uniprotFeatures: null, serviceStatus: { uniprotFeatures: "timeout" } }));
    expect(screen.getByTestId("function-finding-sentence").textContent).toMatch(/did not answer in time/);
  });

  it("opens a row to its evidence and sends Show in 3D to the structure view", () => {
    const onSelectResidue = vi.fn();
    const onNavigateToView = vi.fn();
    renderTab(resultFor(), { onSelectResidue, onNavigateToView, active3dModelTab: "alphafold2" });
    fireEvent.click(screen.getByRole("button", { name: /Arg85Gln/ }));
    const detail = screen.getByTestId("annotation-detail");
    expect(detail.textContent).toMatch(/ECO:0000269/);
    expect(within(detail).getByRole("link", { name: /PubMed 36608681/ }).getAttribute("href")).toBe("https://pubmed.ncbi.nlm.nih.gov/36608681/");
    fireEvent.click(within(detail).getByRole("button", { name: /Show in 3D/ }));
    expect(onSelectResidue).toHaveBeenCalledWith(85);
    expect(onNavigateToView).toHaveBeenCalledWith("structure_alphafold");
  });

  it("zooms the schematic to the residue ± 50", () => {
    renderTab(resultFor());
    fireEvent.click(screen.getByRole("button", { name: "116 ± 50" }));
    expect(screen.getByTestId("domain-architecture").querySelector("svg")?.getAttribute("data-window")).toBe("66-166");
  });
});

describe("FunctionRail", () => {
  it("traces the rule and names the sources from the payload", () => {
    render(<FunctionRail analysisResult={resultFor()} />);
    const trace = screen.getByTestId("function-rule-trace").textContent ?? "";
    expect(trace).toMatch(/counting only evidence observed in this protein/);
    expect(trace).toMatch(/Engine record: PM1 not met/);
    expect(screen.getByTestId("function-rail").textContent).not.toMatch(/Swiss-Prot Verified|v2024/);
    expect(screen.getByText("InterPro via UniParc")).toBeTruthy();
  });
});

describe("FunctionTab — opening window and nearby rows", () => {
  const long = (residue: number) =>
    resultFor({
      metadata: { gene: "NAE1", variant: `p.Asp${residue}Gly`, residueIndex: residue, wildType: "D", mutant: "G", uniprotId: "Q13564" },
      uniprotFeatures: { ...NAE1_UNIPROT, sequenceLength: 1085 },
    });

  it("opens on the neighbourhood of the variant for a protein over 600 residues, and on the whole protein otherwise", () => {
    const { unmount } = renderTab(long(867));
    expect(screen.getByTestId("domain-architecture").querySelector("svg")?.getAttribute("data-window")).toBe("817-917");
    expect(screen.getByRole("button", { name: "867 ± 50" })).toHaveAttribute("aria-pressed", "true");
    unmount();
    renderTab(resultFor());
    expect(screen.getByTestId("domain-architecture").querySelector("svg")?.getAttribute("data-window")).toBe("1-534");
  });

  it("keeps the choice of window the reader made", () => {
    renderTab(long(867));
    fireEvent.click(screen.getByRole("button", { name: "Whole protein" }));
    expect(screen.getByTestId("domain-architecture").querySelector("svg")?.getAttribute("data-window")).toBe("1-1085");
  });

  it("says when a group has nothing near the variant and offers the rest", () => {
    renderTab(resultFor());
    const more = screen.getAllByRole("button", { name: /None within 50 residues of 116\. Show \d+/ });
    expect(more.length).toBeGreaterThan(0);
    fireEvent.click(more[0]);
    expect(screen.getAllByRole("button", { name: /Show only within 50 residues of 116/ }).length).toBeGreaterThan(0);
  });
});
