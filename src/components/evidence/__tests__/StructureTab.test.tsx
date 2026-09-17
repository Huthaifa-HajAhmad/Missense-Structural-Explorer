// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StructureTab } from "../StructureTab";
import { INSPECTOR_FOCUS_EVENT, INSPECTOR_SECTIONS } from "../../../lib/inspectorFocus";

/** The MACO1 p.Glu433Lys result behind the Residue Shifts tab. */
const RESULT = {
  metadata: {
    gene: "MACO1",
    variant: "p.Glu433Lys",
    wildType: "Glu",
    mutant: "Lys",
    residueIndex: 433
  },
  insights: {
    biochemicalShift: "Charge swap: Negative (Glu) to Positive (Lys). Size increase."
  },
  disruptionPredictor: { level: "low", reason: "Default", plddt: 92, burialStatus: "boundary", neighborCount: 12 }
} as any;

const DISTAL_POCKET = {
  status: "success",
  pocketDistance: 28.14,
  pocketScore: 2,
  pocketVolume: 370,
  likelyCofactor: "None recorded in curated annotations",
  sasPoints: 37,
  surfaceAtoms: 20,
  pocketResidues: [{ name: "HIS", index: 292, distance: 29.9 }]
} as any;

function renderTab(overrides: Record<string, unknown> = {}) {
  const props = {
    analysisState: { result: RESULT, isLoading: false },
    setSelectedMetric: vi.fn(),
    computedPocket: null,
    isPocketLoading: false,
    pocketError: null,
    active3dModelTab: "alphafold2" as const,
    onRetryPocket: vi.fn(),
    onSelectResidue: vi.fn(),
    onNavigateToView: vi.fn(),
    ...overrides
  } as any;

  return render(<StructureTab {...props} />);
}

describe("StructureTab", () => {
  it("renders nothing until an analysis result exists", () => {
    const { container } = renderTab({ analysisState: { result: null, isLoading: false } });
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the quantitative property scales in the main column", () => {
    renderTab();
    expect(screen.getByText("Hydrophobicity")).toBeInTheDocument();
    expect(screen.getByText("Isoelectric Charge Index")).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 axes move|2 of 4 axes move/)).toBeInTheDocument();
  });

  it("no longer renders the biochemical shift narrative, which moved to the inspector", () => {
    renderTab();
    expect(screen.queryByText(/Charge swap: Negative \(Glu\) to Positive \(Lys\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Biochemical Shift Narrative/i)).not.toBeInTheDocument();
  });

  it("gives the reader a working route to the relocated interpretation", () => {
    const seen: string[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent<{ sectionId: string }>).detail.sectionId);
    window.addEventListener(INSPECTOR_FOCUS_EVENT, handler);
    try {
      renderTab();
      fireEvent.click(screen.getByRole("button", { name: /Open the worked interpretation/i }));
    } finally {
      window.removeEventListener(INSPECTOR_FOCUS_EVENT, handler);
    }
    expect(seen).toEqual([INSPECTOR_SECTIONS.residueShiftNarrative]);
  });

  it("routes the reader to the cavity interpretation from the classification badge", () => {
    const seen: string[] = [];
    const handler = (event: Event) => seen.push((event as CustomEvent<{ sectionId: string }>).detail.sectionId);
    window.addEventListener(INSPECTOR_FOCUS_EVENT, handler);
    try {
      renderTab({ computedPocket: DISTAL_POCKET });
      fireEvent.click(screen.getByRole("button", { name: /Open the cavity interpretation in the inspector/i }));
    } finally {
      window.removeEventListener(INSPECTOR_FOCUS_EVENT, handler);
    }
    expect(seen).toEqual([INSPECTOR_SECTIONS.residueShiftPocket]);
  });

  it("classifies a distal pocket with the shared derivation, not a local ternary", () => {
    renderTab({ computedPocket: DISTAL_POCKET });
    expect(screen.getByText("DISTAL_SURFACE")).toBeInTheDocument();
  });

  it("promotes a residue that lines the cavity, matching the inspector", () => {
    renderTab({ computedPocket: { ...DISTAL_POCKET, pocketResidues: [{ name: "GLU", index: 433, distance: 3.4 }] } });
    expect(screen.getByText("ACTIVE_SITE_LINING")).toBeInTheDocument();
  });

  it("bands the KPI cards so the numbers are self-explaining", () => {
    renderTab({ computedPocket: DISTAL_POCKET });
    expect(screen.getByText(/Weak .* P2Rank ranking index/)).toBeInTheDocument();
    expect(screen.getByText(/Distal to cavity .* distance to pocket centroid/)).toBeInTheDocument();
  });

  it("does not label the ranking index as a binding probability and does not print a fabricated volume", () => {
    // The runner writes a rescaled raw score into this field whenever P2Rank's
    // probability rounds to zero, so "%"/"Binding Probability" overclaim; and the
    // payload's volume is sas_points × 10, so Å³ must not be printed for it.
    renderTab({ computedPocket: DISTAL_POCKET });

    expect(screen.getByText("Cavity Ranking Index")).toBeInTheDocument();
    expect(screen.queryByText("Binding Probability")).not.toBeInTheDocument();
    expect(screen.queryByText(/370/)).not.toBeInTheDocument();
    expect(screen.getByText("37 pts")).toBeInTheDocument();
    expect(screen.getByText(/no volume reported/)).toBeInTheDocument();
    // Volume band words are asserted in the shared-module suite; asserting them
    // here would collide with the size axis's own "Small" anchor.
  });

  it("prints Å³ only when the payload declares a measured volume", () => {
    renderTab({
      computedPocket: { ...DISTAL_POCKET, provenance: { engine: "p2rank", volumeSource: "measured" } }
    });
    expect(screen.getByText("Pocket Volume")).toBeInTheDocument();
    expect(screen.getByText("370 Å³")).toBeInTheDocument();
  });

  it("does not present the placeholder cofactor annotation as a ligand", () => {
    renderTab({ computedPocket: DISTAL_POCKET });
    expect(screen.getByText("None recorded")).toBeInTheDocument();
    expect(screen.queryByText("None recorded in curated annotations")).not.toBeInTheDocument();
  });

  it("keeps the standby empty state when no cavity scan has run", () => {
    renderTab();
    expect(screen.getByText(/No active pocket computations found/)).toBeInTheDocument();
  });

  it("names the pocket data source for every pipeline state", () => {
    const { unmount } = renderTab({ computedPocket: DISTAL_POCKET });
    expect(screen.getByText("P2Rank ML")).toBeInTheDocument();
    unmount();

    const { unmount: unmountNone } = renderTab({ computedPocket: { status: "none_detected" } });
    expect(screen.getByText("No Pocket Detected")).toBeInTheDocument();
    unmountNone();

    const { unmount: unmountOffline } = renderTab({ computedPocket: { status: "unavailable" } });
    expect(screen.getByText("Model Offline")).toBeInTheDocument();
    unmountOffline();

    renderTab();
    expect(screen.getByText("Standby")).toBeInTheDocument();
  });
});
