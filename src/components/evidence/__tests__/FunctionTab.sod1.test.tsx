// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FunctionTab } from "../FunctionInteractionsTabs";
import type { TabComponentProps } from "../types";
import type { AnalysisResult } from "../../../types";
import { NAE1_UNIPROT } from "../../../shared/__tests__/fixtures/nae1FunctionalDomains";
import { SOD1_UNIPROT } from "../../../shared/__tests__/fixtures/sod1FunctionalDomains";

const sod1 = (): AnalysisResult =>
  ({
    metadata: { gene: "SOD1", variant: "p.Ala5Val", residueIndex: 5, wildType: "A", mutant: "V", uniprotId: "P00441" },
    uniprotFeatures: SOD1_UNIPROT,
    serviceStatus: { uniprotFeatures: "ok" },
    ruleBasedInsights: { acmgCriteria: [{ code: "PM2" }] },
  }) as unknown as AnalysisResult;

const propsFor = (result: AnalysisResult) =>
  ({
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
  }) as unknown as TabComponentProps;

function renderTab(result: AnalysisResult) {
  return render(<FunctionTab {...propsFor(result)} />);
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("FunctionTab - SOD1 p.Ala5Val (dense protein, exact variant)", () => {
  it("names the exact change and what UniProt says it does, not the first variant at the residue", () => {
    renderTab(sod1());
    const sentence = screen.getByTestId("function-finding-sentence").textContent ?? "";
    expect(sentence).toMatch(/UniProt lists this exact change, Ala5Val, as a disease variant \(In ALS1; severe form/);
    expect(sentence).toMatch(/Other changes here: Ala5Ser, Ala5Thr/);
    expect(screen.getAllByText("Older literature may call this A4V.").length).toBe(1);
  });

  it("draws the bar track, not pins, and lets the legend switch the layer off and on", () => {
    renderTab(sod1());
    expect(screen.getAllByTestId("arch-dens-bar").length).toBe(58);
    const toggle = screen.getByTestId("layer-variants");
    expect(toggle.textContent).toMatch(/Disease variants\s*81/);
    fireEvent.click(toggle);
    expect(screen.queryAllByTestId("arch-dens-bar").length).toBe(0);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("arch-dens-bar").length).toBe(58);
  });

  it("folds the three variants at residue 5 into one row that opens to each change", () => {
    renderTab(sod1());
    fireEvent.click(screen.getByRole("button", { name: /Ala5 → Ser, Thr, Val/ }));
    const parts = screen.getByTestId("variant-parts");
    expect(parts.textContent).toMatch(/Ala5Ser/);
    expect(parts.textContent).toMatch(/Ala5Val.*Severe form; reduces structural stability/);
    expect(within(parts).getByRole("link", { name: /PubMed 10400992/ })).toBeTruthy();
  });

  it("does not say metal binding is unannotated for a protein with eight Cu/Zn ligands", () => {
    renderTab(sod1());
    expect(screen.getByTestId("not-annotated").textContent).not.toMatch(/metal binding/);
  });

  it("links a bar to its table row by hover and selects the row on click", () => {
    renderTab(sod1());
    const bar = screen.getAllByTestId("arch-dens-bar").find((b) => b.getAttribute("data-start") === "5")!;
    fireEvent.mouseEnter(bar);
    expect(document.querySelector('tr[data-row-key="variants-5"]')?.hasAttribute("data-lit")).toBe(true);
    fireEvent.click(bar);
    expect(document.querySelector('tr[data-row-key="variants-5"]')?.hasAttribute("data-selected")).toBe(true);
  });

  it("steps through the marks with the arrow keys and announces the one selected", () => {
    renderTab(sod1());
    const drawing = screen.getByTestId("domain-architecture");
    fireEvent.keyDown(drawing, { key: "ArrowRight" });
    expect(document.querySelector("tr[data-selected]")).not.toBeNull();
    expect(drawing.querySelector('[role="status"]')?.textContent).toMatch(/N-acetylalanine/);
  });
});

describe("FunctionTab - window and open row in the address bar", () => {
  it("opens on the window and row the URL names, writes the choice back, and removes both on unmount", () => {
    window.history.replaceState(null, "", "/?gene=SOD1&fnd=40-100&fsel=variants-5");
    const { unmount } = renderTab(sod1());
    expect(screen.getByTestId("domain-architecture").querySelector("svg")?.getAttribute("data-window")).toBe("40-100");
    expect(document.querySelector('tr[data-row-key="variants-5"]')?.hasAttribute("data-selected")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Whole protein" }));
    expect(new URLSearchParams(window.location.search).get("fnd")).toBe("whole");
    expect(new URLSearchParams(window.location.search).get("gene")).toBe("SOD1");
    unmount();
    const q = new URLSearchParams(window.location.search);
    expect(q.has("fnd")).toBe(false);
    expect(q.has("fsel")).toBe(false);
    expect(q.get("gene")).toBe("SOD1");
  });

  it("ignores a window outside the protein", () => {
    window.history.replaceState(null, "", "/?fnd=900-9000");
    renderTab({
      metadata: { gene: "NAE1", variant: "p.Asp116Gly", residueIndex: 116, wildType: "D", mutant: "G", uniprotId: "Q13564" },
      uniprotFeatures: NAE1_UNIPROT,
      serviceStatus: { uniprotFeatures: "ok" },
    } as unknown as AnalysisResult);
    expect(screen.getByTestId("domain-architecture").querySelector("svg")?.getAttribute("data-window")).toBe("1-534");
  });
});

describe("FunctionTab - a new variant does not inherit the last one's window or open row", () => {
  it("drops the window and row from the address bar when the analysis changes", () => {
    const nae1 = {
      metadata: { gene: "NAE1", variant: "p.Asp116Gly", residueIndex: 116, wildType: "D", mutant: "G", uniprotId: "Q13564" },
      uniprotFeatures: NAE1_UNIPROT,
      serviceStatus: { uniprotFeatures: "ok" },
    } as unknown as AnalysisResult;
    const { rerender } = renderTab(sod1());
    fireEvent.click(screen.getByRole("button", { name: "5 ± 50" }));
    fireEvent.click(screen.getByRole("button", { name: /Ala5 → Ser, Thr, Val/ }));
    let q = new URLSearchParams(window.location.search);
    expect(q.get("fnd")).toBe("near");
    expect(q.get("fsel")).toBe("variants-5");
    rerender(<FunctionTab {...propsFor(nae1)} />);
    q = new URLSearchParams(window.location.search);
    expect(q.has("fnd")).toBe(false);
    expect(q.has("fsel")).toBe(false);
    expect(screen.getByTestId("domain-architecture").querySelector("svg")?.getAttribute("data-window")).toBe("1-534");
  });
});
