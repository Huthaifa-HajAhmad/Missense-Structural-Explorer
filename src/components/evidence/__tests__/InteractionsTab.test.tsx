// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionsTab } from "../InteractionsTab";

/**
 * What the Protein interactions screen may claim. `useApiClient` pulls in providers the tab does not
 * otherwise need; the store is stubbed so its writes can be asserted.
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

afterEach(() => {
  fetchWithAuthMock.mockReset();
  setAnalysisStateMock.mockReset();
  storeState.analysisState = null;
});

/** A fetch stub that honours abort like the real one: never settles, or rejects with AbortError. */
function hangingFetch() {
  return vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })
  );
}

/** NAE1 p.Asp116Gly — the reference variant (user's screenshot; UniProtKB Q13564). */
const PPI = {
  status: "success",
  gene: "NAE1",
  variant: "p.Asp116Gly",
  uniprotId: "Q13564",
  position: 116,
  stringPartners: [
    { partner: "NEDD8", score: 0.999 },
    { partner: "UBE2M", score: 0.999 },
    { partner: "UBA3", score: 0.999 },
    { partner: "APP", score: 0.998 },
    { partner: "UBE2F", score: 0.976 },
  ],
  subunitComment: "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2.",
  curatedInteractions: [
    { accession: "P05067", gene: "APP", experiments: 3 },
    { accession: "P07686", gene: "HEXB", experiments: 3 },
    { accession: "Q8TBC4", gene: "UBA3", experiments: 3 },
  ],
  interactionSites: [
    { type: "Site", start: 211, end: 211, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: false },
    { type: "Region", start: 331, end: 344, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: false },
  ],
  observedInterfaces: [],
  sequenceLength: 534,
  lookups: { stringPartners: "ok", uniprot: "ok", pdbe: "ok" },
} as any;

const RESULT = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", residueIndex: 116, uniprotId: "Q13564" },
  multimerData: {
    status: "success",
    chains: [
      { id: "A", accession: "Q13564", gene: "NAE1", length: 534, carriesVariant: true },
      { id: "B", accession: "Q8TBC4", gene: "UBA3", length: 463, carriesVariant: false },
    ],
  },
  ppiBindingData: PPI,
} as any;

function makeProps(result: any) {
  return {
    analysisState: { result, isLoading: false },
    energyUnit: "kcal/mol" as const,
    formatDdGValue: (v: number) => `${v}`,
    onTabChange: vi.fn(),
  } as any;
}

function renderTab(result: any) {
  const props = makeProps(result);
  const view = render(<InteractionsTab {...props} />);
  return { ...view, props, show: (next: any) => view.rerender(<InteractionsTab {...makeProps(next)} />) };
}

describe("InteractionsTab — the finding", () => {
  it("places Asp116 outside UniProt's two UBA3 sites and says so in one sentence", () => {
    renderTab(RESULT);
    expect(screen.getByText("Outside mapped sites")).toBeInTheDocument();
    expect(screen.getByTestId("interactions-finding-sentence")).toHaveTextContent(
      "Asp116 does not fall in any binding site UniProt maps for NAE1."
    );
  });

  it("never calls a heterodimer a monomer, and never claims the residue is intramolecular", () => {
    // The defect this pins: the tab read "Monomer · Intramolecular · ΔΔG_bind N/A" for NAE1.
    const { container } = renderTab(RESULT);
    expect(container).not.toHaveTextContent(/monomer|intramolecular/i);
    expect(container).not.toHaveTextContent(/N\/A|Pending|Uncharacterized|OpenBind/);
  });

  it("ends the fact strip with the engine record", () => {
    renderTab(RESULT);
    const facts = within(screen.getByTestId("interactions-finding")).getAllByRole("term").map(dt => dt.textContent);
    expect(facts).toEqual(["Curated partners", "Mapped sites", "Binding change", "Engine record"]);
  });
});

describe("InteractionsTab — partner grid", () => {
  it("lists curated binders before STRING-only associations", () => {
    renderTab(RESULT);
    const grid = screen.getByTestId("partner-grid");
    const groups = Array.from(grid.querySelectorAll("tbody")).map(tb => tb.getAttribute("data-group"));
    expect(groups).toEqual(["physical", "functional"]);
    const functional = grid.querySelector('tbody[data-group="functional"]')!;
    expect(within(functional as HTMLElement).getByText("UBE2F")).toBeInTheDocument();
    expect(within(grid.querySelector('tbody[data-group="physical"]') as HTMLElement).getByText("HEXB")).toBeInTheDocument();
  });

  it("shows UBA3's mapped sites and that Asp116 is outside them", () => {
    renderTab(RESULT);
    const row = screen.getByRole("link", { name: "UBA3" }).closest("tr")!;
    expect(row).toHaveTextContent("211, 331–344");
    expect(row).toHaveTextContent("Asp116 outside");
    expect(row).not.toHaveAttribute("data-hit");
  });

  it("draws STRING association in neutral ink: no benign-green chip", () => {
    const { container } = renderTab(RESULT);
    expect(container.querySelector('[data-tone="good"]')).toBeNull();
    expect(screen.getAllByText("Highest confidence").length).toBeGreaterThan(0);
  });

  it("links partners with STRING's documented URL form", () => {
    renderTab(RESULT);
    const link = screen.getByRole("link", { name: "UBA3" });
    expect(link).toHaveAttribute("href", "https://string-db.org/cgi/network?identifiers=NAE1%0dUBA3&species=9606");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("makes the horizontal scroller reachable by keyboard", () => {
    renderTab(RESULT);
    expect(screen.getByRole("region", { name: "Interaction partners of NAE1" })).toHaveAttribute("tabindex", "0");
  });
});

describe("InteractionsTab — binding energy change", () => {
  it("does not run DDMut-PPI on open; it offers it on the modelled chains", async () => {
    renderTab(RESULT);
    const card = screen.getByTestId("binding-card");
    expect(card).toHaveTextContent("Not measured yet");
    expect(fetchWithAuthMock).not.toHaveBeenCalled();

    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok", gene: "NAE1", variant: "p.Asp116Gly", ddgBind: -1.42, unit: "kcal/mol", signConvention: "negative-weakens",
        predictor: "DDMut-PPI", mutation: "D116G",
        wildType: { source: "boltz-2-model", provenance: "Boltz-2 via JapanFold", ipTm: 0.86, chains: [{ id: "A", accession: "Q13564", gene: "NAE1" }, { id: "B", accession: "Q8TBC4", gene: "UBA3" }] },
      }),
    });
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /Estimate binding change/ }));
    });
    const [url, init] = fetchWithAuthMock.mock.calls[0];
    expect(url).toBe("/api/v1/ppi/binding-shift");
    expect(JSON.parse(init.body).chains.map((c: any) => c.accession)).toEqual(["Q13564", "Q8TBC4"]);
    // DDMut-PPI's sign: negative is weaker binding. No class word is attached.
    expect(card).toHaveTextContent("−1.42 kcal/mol");
    expect(card).toHaveTextContent("Weaker binding to UBA3");
    expect(card).not.toHaveTextContent(/disruptive|allosteric|surface neutral/i);
    expect(within(card).getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("negative is weaker binding"));
  });

  it("does not render a value stored by the earlier service, which scored the variant model as its wild type", () => {
    renderTab({ ...RESULT, multimerData: null, ppiBindingData: { ...PPI, bindingShift: { ddgBind: 2.14, classification: "INTERFACE_DISRUPTIVE" } } });
    const card = screen.getByTestId("binding-card");
    expect(card).not.toHaveTextContent("2.14");
    expect(card).toHaveTextContent("earlier version");
  });

  it("points to the Multimer tab when no complex has been modelled", () => {
    const { props } = renderTab({ ...RESULT, multimerData: null });
    fireEvent.click(screen.getByRole("button", { name: /Open Multimer assembly/ }));
    expect(props.onTabChange).toHaveBeenCalledWith("multimers");
  });
});

describe("InteractionsTab — request state", () => {
  const FRESH = { ...RESULT, ppiBindingData: null };

  it("does not claim absence while the lookups are still running", () => {
    fetchWithAuthMock.mockImplementation(hangingFetch());
    const { container } = renderTab(FRESH);
    expect(screen.getByText("Reading partners")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/No partners listed|UniProt maps no/);
  });

  it("still shows pending after a superseded request aborts mid-flight", async () => {
    fetchWithAuthMock.mockImplementation(hangingFetch());
    const { show } = renderTab(FRESH);
    await act(async () => {
      show({ ...FRESH, metadata: { ...FRESH.metadata, variant: "p.Asp116Asn" } });
    });
    expect(screen.getByText("Reading partners")).toBeInTheDocument();
  });

  it("separates a failed lookup from an empty answer", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: false });
    await act(async () => {
      renderTab(FRESH);
    });
    expect(screen.getByText("Partners not retrieved")).toBeInTheDocument();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
  });

  it("sends only gene, variant and accession, and stores the answer on the result", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => PPI });
    await act(async () => {
      renderTab(FRESH);
    });
    const [url, init] = fetchWithAuthMock.mock.calls[0];
    expect(url).toBe("/api/v1/ppi/binding-affinity");
    expect(JSON.parse(init.body)).toEqual({ gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564" });
    const updater = setAnalysisStateMock.mock.calls[0][0];
    expect(updater({ result: { a: 1 } }).result.ppiBindingData).toBe(PPI);
  });

  it("re-reads a stored payload written before the sites rewrite instead of rendering it", async () => {
    fetchWithAuthMock.mockImplementation(hangingFetch());
    renderTab({ ...RESULT, ppiBindingData: { ...PPI, lookups: { stringPartners: "ok", interfaceResidues: "ok" } } });
    expect(fetchWithAuthMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Read again in the tab order while busy", () => {
    fetchWithAuthMock.mockImplementation(hangingFetch());
    renderTab(FRESH);
    const btn = screen.getByRole("button", { name: /Reading/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
  });

  it("renders nothing until an analysis result exists", () => {
    const { container } = renderTab(null);
    expect(container).toBeEmptyDOMElement();
  });
});
