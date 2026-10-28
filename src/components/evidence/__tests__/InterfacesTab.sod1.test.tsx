// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterfacesTab } from "../InterfacesTab";
import { InterfacesRail } from "../../inspector/InterfacesRail";
import { SOD1_INTERFACES as F } from "../../../shared/__tests__/fixtures/sod1Interfaces";

/**
 * What the Interfaces & PPI screen may claim on SOD1 p.Ala5Val, the densest real case
 * (doc/INTERFACES_PPI_REVIEW.md): fibrils apart from the native interface, set-aside chains, a folded
 * partner list, the tier chart as a filter, linked highlight, and the view in the URL.
 */
const { fetchWithAuthMock } = vi.hoisted(() => ({ fetchWithAuthMock: vi.fn() }));
vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: fetchWithAuthMock }),
  extractErrorMessage: vi.fn(async () => "Upstream said no."),
}));
vi.mock("../../../stores/useVariantAnalysisStore", () => ({
  useVariantAnalysisStore: { getState: () => ({ setAnalysisState: vi.fn(), analysisState: null }) },
}));
vi.mock("../../../services/pipeline/variantCache", () => ({ setCachedVariant: vi.fn() }));

const RESULT: any = { ...F.result, multimerData: F.assembly, ppiBindingData: F.ppi };

function renderTab() {
  const props = { analysisState: { result: RESULT, isLoading: false }, energyUnit: "kcal/mol", formatDdGValue: (v: number) => `${v}`, onTabChange: vi.fn() } as any;
  return render(<InterfacesTab {...props} />);
}

beforeEach(() => window.history.replaceState(null, "", "/evidence/interfaces"));
afterEach(() => fetchWithAuthMock.mockReset());

describe("InterfacesTab — SOD1 p.Ala5Val finding", () => {
  it("leads with 0 of 142 native structures, never the fibril count as the dimer interface", () => {
    renderTab();
    const finding = screen.getByTestId("interfaces-finding");
    expect(screen.getByTestId("interface-verdict")).toHaveTextContent("Not at an interface");
    expect(finding).toHaveTextContent("0 of 142");
    expect(finding).toHaveTextContent("native solved structures place Ala5 at the interface with the other SOD1 chain");
    expect(finding).not.toHaveTextContent(/of 157|heterozygous carrier makes mixed complexes/);
    expect(screen.getByTestId("interfaces-callout")).toHaveTextContent("In 4 of 15 amyloid fibril structures (7VZF, 9JBO, 9JBP, 9LI1)");
    expect(screen.getByTestId("binding-card")).toHaveTextContent("Ala5 is not at the interface in any solved complex of SOD1");
    expect(within(screen.getByTestId("binding-card")).queryByRole("button", { name: /Estimate binding change/ })).toBeNull();
  });

  it("draws the fibril lane last with its own readout, and the support legend", () => {
    renderTab();
    const track = screen.getByTestId("interface-track");
    expect(within(track).getByRole("img", { name: /^SOD1, other chain: .*Ala5 not at this interface$/ })).toBeInTheDocument();
    expect(within(track).getByRole("img", { name: /^SOD1 fibril: .*Ala5 at the interface in 4 of 15 amyloid fibril structures$/ })).toBeInTheDocument();
    expect(track).toHaveTextContent("4/15");
    expect(screen.getByLabelText("Legend")).toHaveTextContent("Amyloid fibril stacking, read apart");
  });

  it("lists the fibril reading and the set-aside chains in the assembly table, uncounted", () => {
    renderTab();
    const table = screen.getByTestId("assembly-readings");
    expect(table).toHaveTextContent("SOD1 fibril");
    expect(table).toHaveTextContent("Stacking along a fibril, not a native interface.");
    expect(table).toHaveTextContent("Antibody or nanobody, a tool binder, in 6 structures: not a biological partner, not counted.");
    // PDBe lists "Other" in a fibril and a crystal: one set-aside row, not two.
    expect(within(table).getAllByText(/not a biological partner, not counted/)).toHaveLength(2);
  });

  it("lights a lane and its table row together, and the lane's name brings the row into view", () => {
    renderTab();
    const scroll = vi.fn();
    const row = document.getElementById("ifc-row-solved:P00441:fibril")!;
    row.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole("button", { name: "SOD1 fibril" }));
    expect(scroll).toHaveBeenCalled();
    expect(row).toHaveAttribute("data-lit");
    fireEvent.mouseEnter(row.closest("tr")!);
    expect(document.querySelector('.ifc-track__row[data-fibril]')).toHaveAttribute("data-lit");
  });
});

describe("InterfacesTab — Show interface in 3D", () => {
  function renderWith3d() {
    const onSelectResidue = vi.fn();
    const onNavigateToView = vi.fn();
    const props = { analysisState: { result: RESULT, isLoading: false }, active3dModelTab: "alphafold2", onSelectResidue, onNavigateToView } as any;
    render(<InterfacesTab {...props} />);
    return { onSelectResidue, onNavigateToView };
  }

  it("offers no button when the tab cannot reach the structure view", () => {
    renderTab();
    expect(screen.queryByRole("button", { name: /Show interface in 3D/ })).toBeNull();
  });

  it("selects the variant residue and sends the partner's observed interface residues to the structure view", () => {
    const { onSelectResidue, onNavigateToView } = renderWith3d();
    const table = screen.getByTestId("assembly-readings");
    const buttons = within(table).getAllByRole("button", { name: /Show interface in 3D/ });
    fireEvent.click(buttons[0]);
    expect(onSelectResidue).toHaveBeenCalledTimes(1);
    const [index, focus] = onSelectResidue.mock.calls[0];
    expect(index).toBe(5);
    expect(focus.companions.length).toBeGreaterThan(0);
    expect(focus.companions).not.toContain(5);
    expect(focus.label).toMatch(/interface: \d+ residues observed in \d+ solved structures? \(PDBe-KB\), not computed on this model/);
    expect(onNavigateToView).toHaveBeenCalledWith("structure_alphafold");
  });

  it("does not offer a fibril lane, which is not an interface to draw on the monomer", () => {
    renderWith3d();
    const fibrilRow = document.getElementById("ifc-row-solved:P00441:fibril")!.closest("tr")!;
    expect(within(fibrilRow).queryByRole("button", { name: /Show interface in 3D/ })).toBeNull();
  });
});

describe("InterfacesTab — SOD1 partners", () => {
  it("draws the tiers as a chart with counts, STRING's cap marked", () => {
    renderTab();
    const tiers = screen.getByTestId("partner-tiers");
    expect(within(tiers).getByRole("group", { name: "Binding evidence" })).toBeInTheDocument();
    expect(within(tiers).getByRole("button", { name: /Binary screen only\s*66/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(tiers).getByRole("button", { name: /Functional association only\s*369\+/ })).toBeInTheDocument();
    // Every bar carries a fill whose length is the tier's share of the largest — a bare rail would
    // read as a loading skeleton (the regression where the fill's positioning rule was dropped).
    const widths = [...tiers.querySelectorAll<HTMLElement>(".ifc-tier__fill")].map(f => {
      expect(f.style.width).toMatch(/^max\(2px, [\d.]+%\)$/);
      return parseFloat(f.style.width.replace(/^max\(2px, /, ""));
    });
    expect(Math.max(...widths)).toBeGreaterThan(90);
  });

  it("heads each band with its running total and marks binding apart from association", () => {
    renderTab();
    const tiers = screen.getByTestId("partner-tiers");
    const binding = within(tiers).getByRole("group", { name: "Binding evidence" });
    const assoc = within(tiers).getByRole("group", { name: "Association only" });
    expect(binding.querySelector(".ifc-tiers__band-count")?.textContent).toMatch(/^\d+\+? entries$/);
    // STRING's functional list is capped, so the association band's total carries the plus.
    expect(assoc.querySelector(".ifc-tiers__band-count")?.textContent).toMatch(/\+\s*entries$/);
    expect(tiers.querySelector('.ifc-tiers__band[data-band="binding"]')).toBeTruthy();
    expect(tiers.querySelector('.ifc-tiers__band[data-band="association"]')).toBeTruthy();
  });

  it("folds the 63-row screen tail behind one line and lists names on request", () => {
    renderTab();
    const grid = screen.getByTestId("partner-grid");
    expect(grid).toHaveTextContent("Yeast two-hybrid in one study (PubMed 32814053), no other method");
    expect(grid).toHaveTextContent("63 more partners from the same screen");
    expect(within(grid).queryByText("ZXDC")).toBeNull();
    const toggle = within(grid).getByRole("button", { name: "Show 63 names" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(grid).getByRole("list", { name: /Binary screen only: 63 more partners/ })).toHaveTextContent("ZXDC");
    // Never the old wall: one sentence 66 times.
    expect((grid.textContent ?? "").match(/PubMed 32814053/g)?.length ?? 0).toBeLessThan(5);
  });

  it("narrows the grid to one tier from the chart and writes it to the URL", () => {
    const view = renderTab();
    fireEvent.click(within(screen.getByTestId("partner-tiers")).getByRole("button", { name: /Reported binding/ }));
    const grid = screen.getByTestId("partner-grid");
    expect(grid.querySelectorAll("tbody")).toHaveLength(1);
    expect(grid.querySelector("tbody")).toHaveAttribute("data-group", "curated");
    expect(window.location.search).toContain("ppit=curated");
    view.unmount();
    expect(window.location.search).not.toContain("ppit");
  });

  it("finds a partner by name across folded rows, and reads the query from the URL", () => {
    window.history.replaceState(null, "", "/evidence/interfaces?ppiq=zxdc");
    renderTab();
    const grid = screen.getByTestId("partner-grid");
    expect(screen.getByRole("searchbox")).toHaveValue("zxdc");
    expect(within(grid).getByText("ZXDC")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nothing-like-this" } });
    expect(screen.getByText("No partner matches")).toBeInTheDocument();
  });

  it("names other species and links only human genes to STRING", () => {
    renderTab();
    const grid = screen.getByTestId("partner-grid");
    const mouse = within(grid).getByText("Sod1").closest("tr")!;
    expect(mouse).toHaveTextContent("Mouse");
    expect(within(mouse).queryByRole("link")).toBeNull();
    expect(mouse).toHaveTextContent("Not scored (Mouse)");
  });
});

describe("InterfacesRail — SOD1", () => {
  it("traces the fibril split and the set-aside chains, and names RCSB as the entry-kind source", () => {
    render(<InterfacesRail analysisResult={RESULT} />);
    const trace = screen.getByTestId("interfaces-trace");
    expect(trace).toHaveTextContent("Amyloid fibrils read apart: SOD1 fibril, 15 entries.");
    expect(trace).toHaveTextContent("Set aside, not biological: NB1 (antibody or nanobody, a tool binder); Other (chain with no UniProt record).");
    expect(trace).toHaveTextContent("Not at the interface in any of 142 native structures");
    expect(screen.getByTestId("interfaces-rail")).toHaveTextContent("RCSB PDB keywords, titles and assemblies");
  });
});
