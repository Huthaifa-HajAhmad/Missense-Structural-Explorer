// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterfacesTab } from "../InterfacesTab";
import { trackTicks } from "../interfaces/InterfaceTrack";
import { InterfacesRail } from "../../inspector/InterfacesRail";
import { resetInterfacesLive } from "../interfaces/interfacesLive";
import { SLC12A4 } from "../../../shared/__tests__/fixtures/slc12a4";

/**
 * What the Interfaces & PPI screen may claim (doc/INTERFACES_AUDIT.md), on SLC12A4 p.Gln867His.
 * `useApiClient` pulls in providers the tab does not otherwise need; the store is stubbed so its
 * writes can be asserted.
 */
const { fetchWithAuthMock, setAnalysisStateMock, storeState } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  setAnalysisStateMock: vi.fn(),
  storeState: { analysisState: null as any },
}));
vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: fetchWithAuthMock }),
  extractErrorMessage: vi.fn(async () => "Upstream said no."),
}));
vi.mock("../../../stores/useVariantAnalysisStore", () => ({
  useVariantAnalysisStore: {
    getState: () => ({ setAnalysisState: setAnalysisStateMock, analysisState: storeState.analysisState }),
  },
}));
vi.mock("../../../services/pipeline/variantCache", () => ({ setCachedVariant: vi.fn() }));

afterEach(() => {
  fetchWithAuthMock.mockReset();
  setAnalysisStateMock.mockReset();
  storeState.analysisState = null;
  resetInterfacesLive();
});

function hangingFetch() {
  return vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })
  );
}

const RESULT: any = { ...SLC12A4.result, multimerData: SLC12A4.assembly, ppiBindingData: SLC12A4.ppi };

function renderTab(result: any) {
  const props = { analysisState: { result, isLoading: false }, energyUnit: "kcal/mol", formatDdGValue: (v: number) => `${v}`, onTabChange: vi.fn() } as any;
  const view = render(<InterfacesTab {...props} />);
  return { ...view, props };
}

describe("InterfacesTab — the finding", () => {
  it("states the support, 1 of 8 solved structures, and never 'in 8 solved structures'", () => {
    const { container } = renderTab(RESULT);
    const finding = screen.getByTestId("interfaces-finding");
    expect(screen.getByTestId("interface-verdict")).toHaveTextContent("At an interface");
    expect(screen.getByTestId("interfaces-finding-sentence")).toHaveTextContent(
      "Gln867 is at the interface with the other SLC12A4 chain in 1 of 8 solved structures (7AIQ)."
    );
    expect(within(finding).getByText("1 of 8", { selector: ".ifc-figure" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/in 8 solved structures/);
    expect(fetchWithAuthMock).not.toHaveBeenCalled();
  });

  it("states the engine record once, in the foot, not as a fact cell", () => {
    renderTab(RESULT);
    const finding = screen.getByTestId("interfaces-finding");
    expect(within(finding).getByText("Engine record: none. No ACMG criterion reads this tab.")).toBeInTheDocument();
    expect(within(finding).queryByText("Engine record", { selector: "dt" })).toBeNull();
  });

  it("has no permanent Run again / Read again button", () => {
    renderTab(RESULT);
    expect(screen.queryByRole("button", { name: /run again|read again/i })).toBeNull();
  });
});

describe("InterfacesTab — sequence track", () => {
  it("draws topology, the scissor helix and the solved interface; no empty domains lane; legend lists only drawn marks", () => {
    renderTab(RESULT);
    const track = screen.getByTestId("interface-track");
    expect(track).toHaveTextContent("Membrane topology");
    // 17 residues of 1085 is too short for an inline name; it is in the lane's accessible summary.
    expect(within(track).getByRole("img", { name: "Scissor helix 665–681" })).toBeInTheDocument();
    expect(track).not.toHaveTextContent("No domains annotated");
    expect(within(track).getByRole("img", { name: /Gln867 at the interface in 1 of 8 solved structures/ })).toBeInTheDocument();
    const legend = screen.getByLabelText("Legend");
    expect(legend).toHaveTextContent("bar height = share of the pair's structures");
    expect(legend).not.toHaveTextContent("Predicted interface");
  });

  it("never hides an axis tick under the variant ruler's label, and re-reads the axis when that leaves it bare", () => {
    // SOD1's short axis: the ruler label at residue 5 covers nothing.
    expect(trackTicks(154, 5)).toEqual([50, 100]);
    // RGS9's axis (674): the base step is 200, and the label would cover "200" — finer step instead.
    const rgs9 = trackTicks(674, 182);
    expect(rgs9).not.toContain(200);
    expect(rgs9.length).toBeGreaterThanOrEqual(2);
    // No variant, no label, no re-read: the base step stands.
    expect(trackTicks(674, null)).toEqual([200, 400]);
  });
});

describe("InterfacesTab — assembly", () => {
  it("shows both SUBUNIT statements, the second with UniProt's 'Probable'", () => {
    renderTab(RESULT);
    const table = screen.getByTestId("assembly-readings");
    expect(table).toHaveTextContent("Heterodimer with other K-Cl cotransporters (Probable)");
    expect(within(table).getAllByText("Probable").length).toBeGreaterThan(0);
  });

  it("runs the complex model only when asked, with model: true", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => ({ ...SLC12A4.assembly, status: "running", jobId: "j1" }) });
    renderTab(RESULT);
    const table = screen.getByTestId("assembly-readings");
    await act(async () => {
      fireEvent.click(within(table).getByRole("button", { name: "Model the complex" }));
    });
    const [url, init] = fetchWithAuthMock.mock.calls[0];
    expect(url).toBe("/api/v1/structure/multimer");
    expect(JSON.parse(init.body)).toEqual({ gene: "SLC12A4", variant: "p.Gln867His", uniprotId: "Q9UP95", model: true });
    expect(table).toHaveTextContent(/Boltz-2 is modelling 2 chains/);
  });

  it("sets a crystal-packing contact aside in the solved-structures table and the callout", () => {
    const self = SLC12A4.assembly.experimental.partners[0];
    const native = { ...self, variantAtInterface: false, variantEntries: [] };
    const crystal = { ...self, context: "crystal", variantAtInterface: true, variantEntries: ["7aiq"] };
    renderTab({ ...RESULT, multimerData: { ...SLC12A4.assembly, experimental: { status: "ok", partners: [native, crystal], crystalChecked: true } } });
    const table = screen.getByTestId("assembly-readings");
    expect(table).toHaveTextContent("Outside assembly");
    expect(table).toHaveTextContent("deposited biological assembly is a monomer");
    expect(screen.getByTestId("interfaces-callout")).toHaveTextContent("outside the deposited assembly");
    // A crystal contact never feeds the rule-input highlight, even when the residue is at it.
    expect(document.getElementById("ifc-row-solved:Q9UP95:crystal")).not.toHaveAttribute("data-rule-input");
  });

  it("folds a long set-aside list behind one line and lists names on request", () => {
    const base = { accession: "P0AEX9", name: "MBP", residues: [1], support: [1], pdbEntries: ["9zzz"], homomeric: false, artefact: "maltose-binding protein fusion tag", context: "native", variantAtInterface: false, variantEntries: [] };
    const partners = Array.from({ length: 6 }, (_, i) => ({ ...base, accession: `P0AEY${i}`, name: `Tag ${i}` }));
    renderTab({ ...RESULT, multimerData: { ...SLC12A4.assembly, experimental: { status: "ok", partners, crystalChecked: true } } });
    const table = screen.getByTestId("assembly-readings");
    expect(table).toHaveTextContent("2 more chains set aside");
    expect(within(table).queryByText("Tag 4")).toBeNull();
    fireEvent.click(within(table).getByRole("button", { name: "Show 2 names" }));
    expect(within(table).getByRole("list", { name: /2 more set-aside chains/ })).toHaveTextContent("Tag 4");
  });

  it("offers Try again in place when the model failed transiently", () => {
    renderTab({ ...RESULT, multimerData: { ...SLC12A4.assembly, status: "failed", failure: { kind: "timeout" }, error: "Boltz-2 did not answer in time." } });
    const table = screen.getByTestId("assembly-readings");
    expect(table).toHaveTextContent("Boltz-2 did not answer in time.");
    expect(within(table).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("InterfacesTab — partners", () => {
  it("groups the eight IntAct partners as one two-hybrid screen and lists STRING's physical partners apart", () => {
    renderTab(RESULT);
    const grid = screen.getByTestId("partner-grid");
    expect(grid).toHaveTextContent("Binary screen only");
    expect(grid).toHaveTextContent("Yeast two-hybrid in one study (PubMed 32296183)");
    expect(grid).toHaveTextContent("Physical association only");
    expect(grid).not.toHaveTextContent(/Curated physical interaction|top five|No curated interaction/);
    // No mapped sites for SLC12A4: the column is not drawn.
    expect(within(grid).queryByRole("columnheader", { name: "Mapped site" })).toBeNull();
  });

  it("makes the horizontal scroller reachable by keyboard", () => {
    renderTab(RESULT);
    expect(screen.getByRole("region", { name: "Interaction partners of SLC12A4" })).toHaveAttribute("tabindex", "0");
  });

  it("shows the search field at open, and Escape clears it", () => {
    renderTab(RESULT);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "krt" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("keeps the query in the field after blur, so the active filter stays visible", () => {
    renderTab(RESULT);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "krt" } });
    fireEvent.blur(input);
    expect(screen.getByRole("searchbox")).toHaveValue("krt");
  });

  it("clears the query from an in-input button, keeping the field focused", () => {
    renderTab(RESULT);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "krt" } });
    const clear = screen.getByRole("button", { name: "Clear search" });
    fireEvent.mouseDown(clear);
    fireEvent.click(clear);
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("keeps the band hierarchy in the tier chart, and the grid to one heading per tier", () => {
    renderTab(RESULT);
    const chart = screen.getByTestId("partner-tiers");
    expect(chart).toHaveTextContent("Binding evidence");
    expect(chart).toHaveTextContent("Association only");
    // The grid does not repeat the chart's band labels; the tier headings carry it.
    const grid = screen.getByTestId("partner-grid");
    expect(grid.querySelectorAll(".ifc-band")).toHaveLength(0);
    expect(grid).toHaveTextContent("Binary screen only");
    expect(grid).toHaveTextContent("Physical association only");
  });
});

describe("InterfacesTab — binding change", () => {
  it("plans DDMut-PPI on the solved complex and does not run it on open", async () => {
    renderTab(RESULT);
    const card = screen.getByTestId("binding-card");
    expect(card).toHaveTextContent("solved complex where Gln867 is at the interface (7AIQ)");
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok", gene: "SLC12A4", variant: "p.Gln867His", ddgBind: -0.42, unit: "kcal/mol", signConvention: "negative-weakens", predictor: "DDMut-PPI", mutation: "Q867H",
        wildType: { source: "experimental", provenance: "PDB 7AIQ, electron microscopy 3.72 Å", ipTm: null, chains: [], pdbId: "7aiq", method: "Electron Microscopy", resolution: 3.72, chain: "A", authorResidue: 867 },
      }),
    });
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /Estimate binding change/ }));
    });
    const [url, init] = fetchWithAuthMock.mock.calls[0];
    expect(url).toBe("/api/v1/ppi/binding-shift");
    expect(JSON.parse(init.body)).toEqual({ gene: "SLC12A4", variant: "p.Gln867His", uniprotId: "Q9UP95" });
    expect(card).toHaveTextContent("−0.42 kcal/mol");
    expect(card).toHaveTextContent("Weaker binding, inside the method's error");
    expect(card).toHaveTextContent("solved complex 7AIQ (chain A, residue 867");
    expect(card).not.toHaveTextContent(/disruptive|allosteric|surface neutral/i);
    expect(within(card).getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("inside the method's error"));
  });
});

describe("InterfacesTab — request state", () => {
  it("re-reads stored payloads that predate per-structure support and the IntAct/STRING fields", () => {
    fetchWithAuthMock.mockImplementation(hangingFetch());
    const oldAsm = { ...SLC12A4.assembly, experimental: { status: "ok", partners: [{ accession: "Q9UP95", name: "x", residues: [867], pdbEntries: ["7aiq"], homomeric: true, variantAtInterface: true }] } };
    const oldPpi = { ...SLC12A4.ppi, string: undefined, lookups: { stringPartners: "ok", uniprot: "ok", pdbe: "ok" } };
    const { container } = renderTab({ ...RESULT, multimerData: oldAsm, ppiBindingData: oldPpi });
    expect(fetchWithAuthMock.mock.calls.map(c => c[0]).sort()).toEqual(["/api/v1/ppi/binding-affinity", "/api/v1/structure/multimer"]);
    expect(JSON.parse(fetchWithAuthMock.mock.calls.find(c => c[0] === "/api/v1/structure/multimer")![1].body)).not.toHaveProperty("model");
    expect(screen.getByText("Reading partners")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/No partners listed/);
  });

  it("separates a failed lookup from an empty answer and offers Try again", async () => {
    fetchWithAuthMock.mockImplementation(async (u: string) => (u.includes("binding-affinity") ? { ok: false } : { ok: true, json: async () => SLC12A4.assembly }));
    await act(async () => {
      renderTab({ ...RESULT, ppiBindingData: null });
    });
    expect(screen.getByText("Partners not retrieved")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
  });

  it("renders nothing until an analysis result exists", () => {
    const { container } = renderTab(null);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("InterfacesRail", () => {
  it("renders the same model as a trace that ends with the engine record, with STRING's release", () => {
    render(<InterfacesRail analysisResult={RESULT} />);
    const steps = within(screen.getByTestId("interfaces-trace")).getAllByRole("listitem");
    expect(steps[2]).toHaveTextContent("At the interface in 1 of 8 solved structures");
    expect(steps[steps.length - 1]).toHaveTextContent("Engine record");
    expect(steps[steps.length - 1]).toHaveTextContent("None");
    expect(screen.getByTestId("interfaces-rail")).toHaveTextContent("STRING 12.5");
    expect(screen.getByTestId("interfaces-rail")).toHaveTextContent("None published; error ± 1.33 kcal/mol");
  });
});

/** The tab's props, without rendering the tab, so the rail can be rendered beside it. */
function tabProps(result: any) {
  return { analysisState: { result, isLoading: false }, energyUnit: "kcal/mol", formatDdGValue: (v: number) => `${v}`, onTabChange: vi.fn() } as any;
}

/** The trace step whose label starts with `label` — its value text may include the pending marker. */
function stepFor(label: string): HTMLLIElement {
  const trace = screen.getByTestId("interfaces-trace");
  const step = Array.from(trace.querySelectorAll<HTMLLIElement>(".ifc-step")).find(
    el => el.querySelector(".ifc-step__label")?.textContent?.startsWith(label)
  );
  expect(step, `trace step "${label}"`).toBeTruthy();
  return step!;
}

describe("InterfacesTab & rail — one readiness source", () => {
  it("shows every trace step done once the tab's stored data has landed, with no pending marker", async () => {
    await act(async () => {
      render(<><InterfacesTab {...tabProps(RESULT)} /><InterfacesRail analysisResult={RESULT} /></>);
    });
    const trace = screen.getByTestId("interfaces-trace");
    expect(trace.querySelectorAll('.ifc-step[data-state="pending"]')).toHaveLength(0);
    expect(trace.querySelectorAll('.ifc-step[data-state="failed"]')).toHaveLength(0);
    expect(trace.querySelectorAll('.ifc-step[data-state="done"]').length).toBeGreaterThan(3);
  });

  it("flips a failed lookup to failed with the reason, never a permanent Running", async () => {
    fetchWithAuthMock.mockImplementation(async (u: string) => (u.includes("binding-affinity") ? { ok: false } : { ok: true, json: async () => SLC12A4.assembly }));
    const result = { ...RESULT, ppiBindingData: null };
    await act(async () => {
      render(<><InterfacesTab {...tabProps(result)} /><InterfacesRail analysisResult={result} /></>);
    });
    const partners = stepFor("Partners");
    expect(partners).toHaveAttribute("data-state", "failed");
    expect(partners).toHaveTextContent("Provider error");
    expect(partners).not.toHaveTextContent("Reading…");
  });

  it("keeps a genuinely in-flight lookup pending, with the Reading marker and no animation", async () => {
    fetchWithAuthMock.mockImplementation(hangingFetch());
    const result = { ...RESULT, ppiBindingData: null };
    await act(async () => {
      render(<><InterfacesTab {...tabProps(result)} /><InterfacesRail analysisResult={result} /></>);
    });
    const partners = stepFor("Partners");
    expect(partners).toHaveAttribute("data-state", "pending");
    expect(partners).toHaveTextContent("Reading…");
  });
});
