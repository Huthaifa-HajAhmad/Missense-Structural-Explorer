// @vitest-environment jsdom
/**
 * What the Hotspots view may show, on the live SOD1 p.Ala5Val capture: six definitions with their grades,
 * the PM1 boundary, residues one click from the viewer, and failure as a provider error.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HotspotsView } from "../function/HotspotsView";
import { buildHotspotEvidence, hotspotContextSchema } from "../../../shared/hotspotEvidence";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { hotspotsSlot } from "../../../shared/evidenceKeys";
import sod1Raw from "../../../shared/__tests__/fixtures/hotspotsSod1.json";

// The Try again button reads through the API client; a request that never settles keeps the test deterministic.
const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn(() => new Promise<Response>(() => {})) }));
vi.mock("../../../apiClient", () => ({ useApiClient: () => ({ fetchWithAuth, apiClient: {} }), extractErrorMessage: async () => "unavailable" }));
vi.mock("../../knowledge/ResearchGuideButton", () => ({
  ResearchGuideButton: ({ topic, label }: { topic: string; label?: string }) => <button type="button" data-explanation-topic={topic}>{label}</button>,
}));
afterEach(cleanup);

const sod1 = hotspotContextSchema.parse(sod1Raw);
const ev = buildHotspotEvidence({ context: sod1, loadState: "ready", residue: 5, residueLabel: "Ala5" });

describe("HotspotsView — SOD1 p.Ala5Val", () => {
  it("lists the six definitions, each led by its grade, with a reading guide for each", () => {
    render(<HotspotsView ev={ev} onShow3d={null} />);
    for (const [key, grade] of [["cspec", "Expert specification"], ["regional", "Calibrated (preprint)"], ["per-published", "Published region"], ["per-rerun", "Published method, not validated here"], ["spatial", "Published method, benchmarked here"], ["distribution", "Measurement"]]) {
      expect(within(screen.getByTestId(`hotspot-rung-${key}`)).getByText(grade)).toHaveClass("hsp-grade");
    }
    expect(document.querySelector('[data-explanation-topic="hotspots"]')).not.toBeNull();
    expect(document.querySelector('[data-explanation-topic="hotspot_spatial"]')).not.toBeNull();
  });

  it("keeps the PM1 boundary on screen", () => {
    render(<HotspotsView ev={ev} onShow3d={null} />);
    expect(screen.getByTestId("hotspots-pm1")).toHaveTextContent(/critical functional site only/);
  });

  it("shows the twelve nearest P/LP residues, then all on request", () => {
    render(<HotspotsView ev={ev} onShow3d={null} />);
    expect(screen.getAllByTestId("hotspot-row")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: `Show all ${ev.rows.length}` }));
    expect(screen.getAllByTestId("hotspot-row")).toHaveLength(ev.rows.length);
  });

  it("sends every P/LP residue to the viewer as companions of the variant, labelled with their source", () => {
    const onShow3d = vi.fn();
    render(<HotspotsView ev={ev} onShow3d={onShow3d} />);
    fireEvent.click(screen.getByTestId("hotspots-show-all-3d"));
    const [index, focus] = onShow3d.mock.calls[0];
    expect(index).toBe(5);
    expect(focus.companions).not.toContain(5);
    expect(focus.companions.length).toBe(ev.rows.length - 1);
    expect(focus.label).toMatch(/^ClinVar P\/LP missense residues, germline/);
  });

  it("sends one residue with the variant beside it", () => {
    const onShow3d = vi.fn();
    render(<HotspotsView ev={ev} onShow3d={onShow3d} />);
    fireEvent.click(screen.getByRole("button", { name: `Show ${ev.rows[1].label} in 3D` }));
    expect(onShow3d).toHaveBeenCalledWith(ev.rows[1].residue, expect.objectContaining({ companions: [5] }));
  });

  it("states a failed read as a provider error, never as 'no hot spot'", () => {
    render(<HotspotsView ev={buildHotspotEvidence({ context: null, loadState: "error", loadError: "Request timed out.", residue: 5, residueLabel: "Ala5" })} onShow3d={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Provider error: Request timed out.");
  });
});

describe("HotspotsView — the added columns", () => {
  const withColumns = buildHotspotEvidence({
    context: sod1, loadState: "ready", residue: 5, residueLabel: "Ala5",
    annotations: [{ start: 7, end: 7, isPair: false, name: "Metal binding (Cu²⁺)", evidence: "Experimental" }],
    interfaces: { status: "ok", reason: null, byResidue: new Map([[7, [{ label: "CCS", k: 3, n: 3 }, { label: "SOD1, other chain", k: 104, n: 118 }]]]) },
  });
  const rowFor = (label: string) => screen.getAllByTestId("hotspot-row").find((r) => r.textContent?.startsWith(label))!;

  it("prints RSA as a percent of the maximum, with its unit and method in the header, and no burial word", () => {
    render(<HotspotsView ev={withColumns} onShow3d={null} />);
    expect(screen.getAllByRole("columnheader").some((h) => /^RSA relative solvent accessibility, percent of the Tien 2013 maximum/.test(h.textContent ?? ""))).toBe(true);
    expect(within(rowFor("Ala5")).getByText("2%")).toBeTruthy(); // 0.0166
    expect(document.querySelector(".hsp-table")!.textContent).not.toMatch(/\bcore\b|\bboundary\b|\bsurface\b/i);
  });

  it("lists a residue's UniProt site with its evidence level, and its interface partners with k/n", () => {
    render(<HotspotsView ev={withColumns} onShow3d={null} />);
    const row = rowFor("Cys7");
    expect(within(row).getByText(/Metal binding \(Cu²⁺\)/)).toBeTruthy();
    expect(within(row).getByText(/· Experimental/)).toBeTruthy();
    expect(within(row).getByText(/· 3\/3/)).toBeTruthy();
    expect(within(row).getByText(/· 104\/118/)).toBeTruthy();
  });

  it("shows a dash with the reason on hover where a source was not read, and 'None' only where it was read and empty", () => {
    render(<HotspotsView ev={withColumns} onShow3d={null} />);
    expect(within(rowFor("Ala5")).getAllByText("None").length).toBe(2); // site and interface, both read, nothing at Ala5
    cleanup();
    const unread = buildHotspotEvidence({ context: hotspotContextSchema.parse({ ...sod1Raw, accessibility: { status: "unavailable", reason: "The accessibility run failed: no venv.", values: [] } }), loadState: "ready", residue: 5, residueLabel: "Ala5" });
    render(<HotspotsView ev={unread} onShow3d={null} />);
    const cells = within(rowFor("Ala5")).getAllByText("—");
    expect(cells.length).toBeGreaterThanOrEqual(3); // RSA, site, interface
    expect(within(rowFor("Ala5")).getAllByText("—").some((c) => c.closest("td")?.getAttribute("title") === "The accessibility run failed: no venv.")).toBe(true);
  });
});

describe("HotspotsView — repairing a read", () => {
  const read = { gene: "SOD1", uniprot: "P00441", transcript: null };
  const slot = hotspotsSlot("SOD1", "P00441", null);

  it("offers Try again on a failed read, and pressing it re-reads the same slot", () => {
    fetchWithAuth.mockClear();
    useVariantAnalysisStore.setState({ extraContexts: { [slot]: { status: "error", data: null, error: "Request timed out." } } });
    const failed = buildHotspotEvidence({ context: null, loadState: "error", loadError: "Request timed out.", residue: 5, residueLabel: "Ala5" });
    render(<HotspotsView ev={failed} onShow3d={null} read={read} />);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/v1/evidence-context/SOD1/hotspots?uniprot=P00441", { timeout: 120000 });
    expect(useVariantAnalysisStore.getState().extraContexts[slot].status).toBe("loading");
  });

  it("offers no retry without an identity to re-read, and none while the read is still running", () => {
    const failed = buildHotspotEvidence({ context: null, loadState: "error", loadError: "x", residue: 5, residueLabel: "Ala5" });
    render(<HotspotsView ev={failed} onShow3d={null} />);
    expect(screen.queryByTestId("hotspots-retry")).toBeNull();
    cleanup();
    render(<HotspotsView ev={buildHotspotEvidence({ context: null, loadState: "loading", residue: 5, residueLabel: "Ala5" })} onShow3d={null} read={read} />);
    expect(screen.queryByTestId("hotspots-retry")).toBeNull();
  });

  it("offers Read again when an answer came back with a source that failed, and names the source", () => {
    const degraded = buildHotspotEvidence({ context: hotspotContextSchema.parse({ ...sod1Raw, cspec: { status: "error", reason: "registry unreachable", sourceUrl: "https://cspec.genome.network/", retrievedAt: null, specs: [] } }), loadState: "ready", residue: 5, residueLabel: "Ala5" });
    render(<HotspotsView ev={degraded} onShow3d={null} read={read} />);
    expect(screen.getByTestId("hotspots-incomplete")).toHaveTextContent(/clingen expert panel pm1\) did not answer/);
    expect(screen.getByRole("button", { name: /Read again/ })).toBeTruthy();
  });

  it("offers no repair on a complete answer", () => {
    render(<HotspotsView ev={ev} onShow3d={null} read={read} />);
    expect(screen.queryByTestId("hotspots-retry")).toBeNull();
  });
});

describe("HotspotsView — map geometry and linked pinning", () => {
  it("clamps C-terminal bands (including start === end === L) and bars to 100% width and flips the variant label near the C-terminus", () => {
    const cTermCtx = {
      ...sod1,
      perRerun: {
        ...sod1.perRerun,
        regions: [
          { start: 140, end: 154, minAdjP: 0.001 },
          { start: 154, end: 154, minAdjP: 0.001 },
        ],
      },
      distribution: {
        ...sod1.distribution,
        plp: [...sod1.distribution.plp.filter((p) => p.pos !== 154), { pos: 154, n: 2, maxStars: 2, changes: ["p.Gln154Arg"] }],
        gnomad: [...sod1.distribution.gnomad.filter((g) => g.pos !== 154), { pos: 154, variants: 1, pass: 1 }],
      },
    };
    const cTermEv = buildHotspotEvidence({ context: cTermCtx, loadState: "ready", residue: 120, residueLabel: "Gly120" });
    const { container } = render(<HotspotsView ev={cTermEv} onShow3d={null} />);
    expect(container.querySelector(".hsp-map__variant")?.hasAttribute("data-flip")).toBe(true);
    const bands = Array.from(container.querySelectorAll<HTMLElement>(".hsp-map__band"));
    expect(bands.length).toBeGreaterThanOrEqual(2);
    for (const b of bands) {
      const left = parseFloat(b.style.left);
      const width = parseFloat(b.style.width);
      expect(left + width).toBeLessThanOrEqual(100.0001);
      expect(width).toBeGreaterThan(0);
    }
    const bars = Array.from(container.querySelectorAll<HTMLElement>(".hsp-map__lane > i"));
    for (const bar of bars) {
      const left = parseFloat(bar.style.left);
      const width = parseFloat(bar.style.width);
      expect(left + width).toBeLessThanOrEqual(100.0001);
    }
  });

  it("links residue hover, keyboard focus, and click between the ClinVar P/LP table, map bars, and definition rungs", () => {
    const cTermCtx = {
      ...sod1,
      perRerun: { ...sod1.perRerun, regions: [{ start: 140, end: 154, minAdjP: 0.001 }] },
    };
    const cTermEv = buildHotspotEvidence({ context: cTermCtx, loadState: "ready", residue: 5, residueLabel: "Ala5" });
    const { container } = render(<HotspotsView ev={cTermEv} onShow3d={null} />);
    const ala5Row = screen.getAllByTestId("hotspot-row").find((r) => r.getAttribute("data-row-key") === "hs:5")!;
    const ala5Pin = within(ala5Row).getByRole("button", { name: "Ala5" });
    const ala5Bar = container.querySelector('.hsp-map__row--up i[data-pos="5"]')!;

    // Mouse enter and leave toggle data-lit.
    fireEvent.mouseEnter(ala5Row);
    expect(ala5Bar.hasAttribute("data-lit")).toBe(true);
    fireEvent.mouseLeave(ala5Row);
    expect(ala5Bar.hasAttribute("data-lit")).toBe(false);

    // Keyboard focus and blur on the pin button also toggle data-lit on the map bar.
    fireEvent.focus(ala5Pin);
    expect(ala5Bar.hasAttribute("data-lit")).toBe(true);
    fireEvent.blur(ala5Pin);
    expect(ala5Bar.hasAttribute("data-lit")).toBe(false);

    // Clicking the pin button selects both row and bar; clicking again clears selection.
    fireEvent.click(ala5Pin);
    expect(ala5Row.hasAttribute("data-selected")).toBe(true);
    expect(ala5Bar.hasAttribute("data-selected")).toBe(true);
    fireEvent.click(ala5Pin);
    expect(ala5Row.hasAttribute("data-selected")).toBe(false);
    expect(ala5Bar.hasAttribute("data-selected")).toBe(false);

    // Clicking a map bar selects the corresponding table row.
    fireEvent.click(ala5Bar);
    expect(ala5Row.hasAttribute("data-selected")).toBe(true);

    // Clicking a map band selects the definition rung and its lane.
    const band = container.querySelector<HTMLElement>(".hsp-map__band")!;
    fireEvent.click(band);
    expect(screen.getByTestId("hotspot-rung-per-rerun").hasAttribute("data-selected")).toBe(true);

    // Clicking a definition rung button selects both the rung and its lane on the map.
    fireEvent.click(screen.getByRole("button", { name: "3D proximity to pathogenic residues" }));
    expect(screen.getByTestId("hotspot-rung-spatial").hasAttribute("data-selected")).toBe(true);
    expect(container.querySelector('.hsp-map__row[data-lane="spatial"]')?.hasAttribute("data-selected")).toBe(true);
  });

  it("supports keyboard activation for map bands and PathProx markers", () => {
    const bandCtx = {
      ...sod1,
      perRerun: { ...sod1.perRerun, regions: [{ start: 140, end: 154, minAdjP: 0.001 }] },
    };
    const bandEv = buildHotspotEvidence({ context: bandCtx, loadState: "ready", residue: 5, residueLabel: "Ala5" });
    const { container } = render(<HotspotsView ev={bandEv} onShow3d={null} />);
    const band = container.querySelector<HTMLButtonElement>("button.hsp-map__band")!;
    expect(band).not.toBeNull();
    band.focus();
    fireEvent.click(band);
    expect(screen.getByTestId("hotspot-rung-per-rerun").hasAttribute("data-selected")).toBe(true);

    const ala5Dot = screen.getByRole("button", { name: /^Ala5: PathProx/i });
    expect(ala5Dot).toHaveAttribute("tabindex", "0");
    ala5Dot.focus();
    fireEvent.keyDown(ala5Dot, { key: "Enter" });
    expect(ala5Dot.hasAttribute("data-selected")).toBe(true);
  });
});
