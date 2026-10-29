// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StructureTab } from "../StructureTab";
import { EvidenceWorkspaceProvider } from "../EvidenceWorkspace";
import { NAE1_POCKET, NAE1_RESULT } from "../../../shared/__tests__/fixtures/nae1ResidueShifts";

function tabProps(overrides: Record<string, unknown> = {}) {
  return {
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
}

function renderTab(overrides: Record<string, unknown> = {}) {
  const props = tabProps(overrides);
  return { props, ...render(<StructureTab {...props} />) };
}

/** The workspace is always mounted in the app; a bare render exercises the standalone path only.
 *  The comparison figure is a workspace view, so it needs the provider to exist at all. */
function renderComparison(overrides: Record<string, unknown> = {}) {
  const props = tabProps(overrides);
  return { props, ...render(<EvidenceWorkspaceProvider result={props.analysisState.result}><StructureTab {...props} /></EvidenceWorkspaceProvider>) };
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
    expect(screen.getByTestId("residue-pair-sub")).toHaveTextContent("Grantham distance 94, moderately conservative");
    expect(screen.getByTestId("residue-finding-text")).toHaveTextContent(
      "The side chain loses its negative charge and becomes less polar, 23.1 Å from the nearest predicted pocket."
    );
    expect(screen.getByText(/not an ACMG input/i)).toBeInTheDocument();
    expect(within(screen.getByTestId("residue-finding")).getByText("Ligand-site probability")).toBeInTheDocument();
  });

  it("preserves the backend reason and offers recovery without a burial payload", () => {
    const onRetryStructural = vi.fn();
    renderTab({ analysisState: { result: { ...NAE1_RESULT, disruptionPredictor: { level: "unknown", reason: "Target residue not found in structure.", plddt: null } }, isLoading: false }, computedPocket: null, pocketError: "Java not found", onRetryStructural });
    const cause = screen.getByTestId("burial-cause");
    expect(cause).toHaveTextContent("Target residue not found in structure.");
    // The pocket's failure is the pocket section's sentence, never the burial cause.
    expect(cause).not.toHaveTextContent(/cavity scan|pocket/i);
    fireEvent.click(screen.getByRole("button", { name: "Run the structure step again" }));
    expect(onRetryStructural).toHaveBeenCalledOnce();
    expect(screen.getByText("Structure and pocket context").parentElement).toHaveAttribute("open");
  });

  it("says the structure step is running instead of calling it a failure", () => {
    renderTab({ analysisState: { result: { ...NAE1_RESULT, disruptionPredictor: undefined }, isLoading: false }, isBiophysicalLoading: true });
    expect(screen.getByTestId("burial-cause")).toHaveTextContent("Running");
    expect(screen.getByTestId("residue-environment")).toHaveTextContent(/locating this residue/i);
    expect(screen.queryByRole("button", { name: "Run the structure step again" })).not.toBeInTheDocument();
  });

  it("never prints a disruption-level reason as the burial cause", () => {
    const reason = "Proline introduced at position 116 which lies within a secondary structure element.";
    renderTab({ analysisState: { result: { ...NAE1_RESULT, disruptionPredictor: { level: "high", reason, plddt: null } }, isLoading: false }, onRetryStructural: vi.fn() });
    expect(screen.getByTestId("burial-cause")).toHaveTextContent("No structure reading was returned for this residue.");
    expect(screen.getByTestId("residue-environment")).not.toHaveTextContent(reason);
  });

  it("draws each property on its published scale, in native units, largest shift first", () => {
    renderComparison();
    const rows = Array.from(document.querySelectorAll(".mol-property"));
    expect(rows.map(row => row.getAttribute("aria-label"))).toEqual([
      "Net charge, loses its negative charge",
      "Polarity, less polar",
      "Hydropathy, more hydrophobic",
      "Side-chain volume, smaller"
    ]);
    const charge = screen.getByRole("button", { name: "Net charge, loses its negative charge" });
    expect(charge).toHaveTextContent("−1 → 0");
    expect(charge).toHaveTextContent("Electrical charge at pH 7.4.");
    expect(within(charge).getByRole("img", { name: /Asp −1, Gly 0 on a scale from −1 to \+1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Side-chain volume, smaller" })).toHaveTextContent("54 → 3 Å³");
    // The old headline came from the hand table ("polarity −85").
    expect(screen.queryByText(/−85/)).not.toBeInTheDocument();
  });

  it("says what the scales cannot see for a glycine substitution", () => {
    renderComparison();
    expect(screen.getByTestId("backbone-caveat")).toHaveTextContent("glycine frees the backbone");
  });

  it("reports burial as not measured and does not show the stored packing word as a finding", () => {
    renderTab();
    const rsa = screen.getByTestId("burial-rsa-row");
    // The failure is named as the state, and burial stays "Not measured" — no packing estimate.
    expect(rsa).toHaveTextContent("Accessibility didn’t run");
    expect(rsa).toHaveTextContent("Not measured");
    const packing = screen.getByTestId("burial-packing-row");
    expect(packing).toHaveTextContent("a reading only");
    expect(packing).toHaveTextContent("9");
    expect(screen.getByText(/earlier engine estimated from packing density/)).toBeInTheDocument();
    expect(screen.queryByText("Boundary")).not.toBeInTheDocument();
  });

  it("offers a structure retry when accessibility did not run", () => {
    const onRetryStructural = vi.fn();
    renderTab({ onRetryStructural });
    const rsa = screen.getByTestId("burial-rsa-row");
    fireEvent.click(within(rsa).getByRole("button", { name: /Run the structure step again/ }));
    expect(onRetryStructural).toHaveBeenCalledTimes(1);
  });

  it("draws each property scale with the two residues and no filled connecting segment", () => {
    renderComparison();
    expect(document.querySelectorAll(".rsx-track__span")).toHaveLength(0);
    const size = screen.getByRole("button", { name: "Side-chain volume, smaller" });
    expect(size.querySelectorAll(".rsx-track__wt")).toHaveLength(1);
    expect(size.querySelectorAll(".rsx-track__mut")).toHaveLength(1);
  });

  it("keeps both residues visible when their values coincide on a scale", () => {
    // Ala → Gly carries no charge on either side, so both markers land on the same spot.
    renderComparison({
      analysisState: {
        result: { ...NAE1_RESULT, metadata: { ...NAE1_RESULT.metadata, wildType: "Ala", mutant: "Gly", variant: "p.Ala116Gly" } },
        isLoading: false
      }
    });
    const charge = screen.getByRole("button", { name: /^Net charge/ });
    expect(charge.querySelector(".rsx-track__wt")).toHaveAttribute("data-coincident");
    expect(charge.querySelector(".rsx-track__mut")).not.toBeNull();
  });

  it("ends prose-only environment rows on their content, not an empty cell", () => {
    renderTab();
    for (const id of ["pocket-score-row", "pocket-volume-row", "burial-packing-row"]) {
      const row = screen.getByTestId(id);
      const cells = Array.from(row.querySelectorAll("td"));
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell.textContent?.trim()).not.toBe("");
      }
    }
  });

  it("keeps the decorative pair arrow out of the accessible name and at control size", () => {
    renderTab();
    const arrow = screen.getByTestId("residue-pair").querySelector(".rsx-pair__arrow");
    expect(arrow).toHaveAttribute("aria-hidden", "true");
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
