// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StructureTab } from "../StructureTab";
import { NAE1_POCKET, NAE1_RESULT } from "../../../shared/__tests__/fixtures/nae1ResidueShifts";

function renderTab(overrides: Record<string, unknown> = {}) {
  const props = {
    analysisState: { result: NAE1_RESULT, isLoading: false },
    setSelectedMetric: vi.fn(),
    computedPocket: NAE1_POCKET,
    isPocketLoading: false,
    pocketError: null,
    active3dModelTab: "alphafold2" as const,
    onRetryPocket: vi.fn(),
    onSelectResidue: vi.fn(),
    onNavigateToView: vi.fn(),
    ...overrides
  } as any;
  return { props, ...render(<StructureTab {...props} />) };
}

/**
 * What the Residue Shifts tab may claim, pinned on NAE1 p.Asp116Gly (the owner's screenshots).
 */
describe("StructureTab", () => {
  it("renders nothing until an analysis result exists", () => {
    const { container } = renderTab({ analysisState: { result: null, isLoading: false } });
    expect(container).toBeEmptyDOMElement();
  });

  it("states one finding and says no ACMG criterion reads this tab", () => {
    renderTab();
    expect(screen.getByTestId("residue-pair")).toHaveTextContent("Asp→Gly");
    expect(screen.getByText(/Grantham distance/)).toHaveTextContent("94, moderately conservative");
    expect(screen.getByTestId("residue-finding-text")).toHaveTextContent(
      "The side chain loses its negative charge and becomes less polar, 23.1 Å from the nearest predicted pocket."
    );
    expect(screen.getByText("Engine record")).toBeInTheDocument();
    expect(screen.getByText("No ACMG criterion reads this tab")).toBeInTheDocument();
  });

  it("draws each property on its published scale, in native units, largest shift first", () => {
    renderTab();
    const rows = within(screen.getByTestId("residue-properties")).getAllByRole("row").slice(1);
    expect(rows.map(r => r.getAttribute("data-testid"))).toEqual([
      "property-row-charge",
      "property-row-polarity",
      "property-row-hydrophobicity",
      "property-row-size"
    ]);
    const charge = screen.getByTestId("property-row-charge");
    expect(charge).toHaveTextContent("Net charge");
    expect(charge).toHaveTextContent("−1");
    expect(charge).toHaveTextContent("loses its negative charge");
    expect(screen.getByTestId("property-row-polarity")).toHaveTextContent("Grantham 1974");
    expect(screen.getByTestId("property-row-polarity")).toHaveTextContent("13.0");
    expect(screen.getByTestId("property-row-hydrophobicity")).toHaveTextContent("Kyte and Doolittle 1982");
    expect(screen.getByTestId("property-row-size")).toHaveTextContent("54");
    // The old headline came from the hand table ("polarity −85").
    expect(screen.queryByText(/−85/)).not.toBeInTheDocument();
  });

  it("says what the scales cannot see for a glycine substitution", () => {
    renderTab();
    expect(screen.getByTestId("backbone-caveat")).toHaveTextContent("glycine frees the backbone");
  });

  it("reports burial as not measured and does not show the stored packing word as a finding", () => {
    renderTab();
    const rsa = screen.getByTestId("burial-rsa-row");
    expect(rsa).toHaveTextContent("Not measured");
    expect(rsa).toHaveTextContent("No result");
    const packing = screen.getByTestId("burial-packing-row");
    expect(packing).toHaveTextContent("a reading only");
    expect(packing).toHaveTextContent("9");
    expect(screen.getByText(/earlier engine estimated from packing density/)).toBeInTheDocument();
    expect(screen.queryByText("Boundary")).not.toBeInTheDocument();
  });

  it("prints one pocket distance, a probability on 0–1, and no invented volume", () => {
    renderTab();
    const distance = screen.getByTestId("pocket-distance-row");
    expect(distance).toHaveTextContent("23.1 Å");
    expect(distance).toHaveTextContent("the cavity centre");
    expect(distance).toHaveTextContent("Distal");
    expect(screen.queryByText(/22\.97/)).not.toBeInTheDocument();
    expect(screen.getByTestId("pocket-score-row")).toHaveTextContent("0.23");
    expect(screen.queryByText(/23 \/ 100|23%/)).not.toBeInTheDocument();
    // Å³ belongs to the side-chain volume scale; the pocket reports surface points, not a volume.
    expect(screen.getByTestId("residue-environment")).not.toHaveTextContent("Å³");
  });

  it("drops the constant co-factor row and raw engine codes", () => {
    renderTab();
    expect(screen.queryByText(/co-factor|cofactor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/DISTAL_SURFACE|ACTIVE_SITE/)).not.toBeInTheDocument();
  });

  it("lists pocket residues nearest first and selects one on click", () => {
    const { props } = renderTab();
    const items = within(screen.getByTestId("pocket-residues")).getAllByRole("button");
    expect(items.map(b => b.textContent)).toEqual([
      "Leu131 A17.8 Å",
      "Ile152 A20.0 Å",
      "Glu133 A21.7 Å",
      "Tyr402 A24.3 Å",
      "Arg154 A24.9 Å",
      "Tyr161 A25.8 Å",
      "Asp433 A25.9 Å",
      "Arg430 A27.9 Å"
    ]);
    fireEvent.click(items[0]);
    expect(props.onSelectResidue).toHaveBeenCalledWith(131);
  });

  it("opens the 3D view at the nearest pocket residue", () => {
    const { props } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /View in 3D/ }));
    expect(props.onSelectResidue).toHaveBeenCalledWith(131);
    expect(props.onNavigateToView).toHaveBeenCalledWith("structure_alphafold");
  });

  it("opens the explanation for each reading", () => {
    const { props } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Explain solvent accessibility/ }));
    fireEvent.click(screen.getByRole("button", { name: /Explain Cα neighbours/ }));
    fireEvent.click(screen.getByRole("button", { name: /Explain P2Rank/ }));
    expect(props.setSelectedMetric.mock.calls.map((c: unknown[]) => c[0])).toEqual(["burial_status", "contact_density", "p2rank"]);
  });

  it("states a failed pocket scan as a sentence and offers a retry", () => {
    const { props } = renderTab({ computedPocket: null, pocketError: "Java not found" });
    const row = screen.getByTestId("pocket-state-row");
    expect(row).toHaveTextContent("Cavity scan failed");
    fireEvent.click(within(row).getByRole("button", { name: /Retry pocket detection/ }));
    expect(props.onRetryPocket).toHaveBeenCalledTimes(1);
  });

  it("says the scan is running while it runs", () => {
    renderTab({ computedPocket: null, isPocketLoading: true });
    expect(screen.getByTestId("pocket-state-row")).toHaveTextContent("Running");
  });

  it("uses the shared state vocabulary, never the legacy words", () => {
    for (const overrides of [{ computedPocket: null }, { computedPocket: { status: "unavailable" } }, {}]) {
      const { unmount } = renderTab(overrides);
      expect(screen.queryByText(/Standby|Model Offline|Model offline|N\/A/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("gives a measured burial word when accessibility was measured", () => {
    renderTab({
      analysisState: {
        result: { ...NAE1_RESULT, disruptionPredictor: { level: "low", reason: "", plddt: null, burialStatus: "surface", rsa: 0.42, neighborCount: 9 } },
        isLoading: false
      }
    });
    const rsa = screen.getByTestId("burial-rsa-row");
    expect(rsa).toHaveTextContent("42.0%");
    expect(rsa).toHaveTextContent("Surface");
  });

  it("uses no red or green: this tab makes no pathogenic or benign call", () => {
    const { container } = renderTab();
    expect(container.innerHTML).not.toMatch(/emerald|rose-|text-red|text-green|data-tone="danger"|data-tone="good"/);
  });
});
