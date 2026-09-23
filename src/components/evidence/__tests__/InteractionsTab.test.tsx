// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteractionsTab } from "../InteractionsTab";

/**
 * `useApiClient` pulls in the settings and auth providers the tab does not
 * otherwise need; the store is stubbed so the cross-store write can be asserted
 * instead of mutating real client state.
 */
const { fetchWithAuthMock, setAnalysisStateMock } = vi.hoisted(() => ({
  fetchWithAuthMock: vi.fn(),
  setAnalysisStateMock: vi.fn()
}));
vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: fetchWithAuthMock }),
  extractErrorMessage: vi.fn()
}));
vi.mock("../../../stores/useVariantAnalysisStore", () => ({
  useVariantAnalysisStore: {
    getState: () => ({ setAnalysisState: setAnalysisStateMock })
  }
}));

afterEach(() => {
  fetchWithAuthMock.mockReset();
  setAnalysisStateMock.mockReset();
});

/**
 * A fetch stub that honours the abort signal the way the real one does — a
 * promise that never settles when nothing aborts, and an AbortError when it does.
 * A plain never-resolving promise would silently skip the abort path the
 * regression test below exists to exercise.
 */
function hangingFetch() {
  return vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    })
  );
}

const PARTNERS = [
  { partner: "PTP4A1", score: 0.97 }, // highest
  { partner: "AS3MT", score: 0.818 }, // high
  { partner: "CBSL", score: 0.5 }, // medium
  { partner: "NOVEL1", score: 0.2 } // low — the band the old code called "Medium"
];

/** CNNM2 p.Ser489Cys as the PPI tab sees it: a curated monomer with no interface. */
const MONOMER_RESULT = {
  metadata: { gene: "CNNM2", variant: "p.Ser489Cys", residueIndex: 489, uniprotId: "Q9H8M5" },
  multimerData: { status: "monomeric", chainCount: 1, oligomericState: "Monomer", interfaceContacts: [] },
  uniprotFeatures: { subunitComment: "Monomer. Interacts with..." },
  ppiBindingData: {
    status: "success",
    gene: "CNNM2",
    variant: "p.Ser489Cys",
    bindingShift: null,
    interfaceResidues: [],
    stringPartners: PARTNERS
  }
} as any;

/** Same variant, but nothing has been fetched yet. */
const UNFETCHED_RESULT = {
  metadata: { gene: "CNNM2", variant: "p.Ser489Cys", residueIndex: 489 },
  multimerData: { status: "monomeric", chainCount: 1, oligomericState: "Monomer", interfaceContacts: [] },
  ppiBindingData: null,
  stringInteractions: null
} as any;

/** A multimer whose mutant complex has not been modelled, so ΔΔG_bind cannot be scored. */
const MULTIMER_RESULT = {
  metadata: { gene: "CNNM2", variant: "p.Ser489Cys", residueIndex: 489 },
  multimerData: { status: "success", chainCount: 2, oligomericState: "Homodimer", interfaceContacts: [] },
  ppiBindingData: {
    status: "success",
    gene: "CNNM2",
    variant: "p.Ser489Cys",
    bindingShift: null,
    interfaceResidues: [],
    stringPartners: [{ partner: "PTP4A1", score: 0.97 }]
  }
} as any;

/** A scored interface shift, with the classification the server pairs with it. */
function scoredResult(ddgBind: number) {
  return {
    metadata: { gene: "CNNM2", variant: "p.Ser489Cys", residueIndex: 489 },
    multimerData: { status: "success", chainCount: 2, oligomericState: "Homodimer", interfaceContacts: [] },
    ppiBindingData: {
      status: "success",
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      bindingShift: {
        ddgBind,
        unit: "kcal/mol",
        classification: ddgBind >= 1.5 ? "INTERFACE_DISRUPTIVE" : ddgBind >= 0.5 ? "ALLOSTERIC_PERTURBATION" : "SURFACE_NEUTRAL",
        provenance: "OpenBind-0 (run 7)"
      },
      interfaceResidues: [],
      stringPartners: [{ partner: "PTP4A1", score: 0.97 }]
    }
  } as any;
}

/** The variant sits inside a modelled quaternary contact. */
const CONTACT_RESULT = {
  metadata: { gene: "CNNM2", variant: "p.Ser489Cys", residueIndex: 489 },
  multimerData: {
    status: "success",
    chainCount: 2,
    oligomericState: "Homodimer",
    interfaceContacts: [{ resA: 489, resB: 112, distance: 3.4 }]
  },
  ppiBindingData: {
    status: "success",
    gene: "CNNM2",
    variant: "p.Ser489Cys",
    bindingShift: null,
    interfaceResidues: [],
    stringPartners: [{ partner: "PTP4A1", score: 0.97 }]
  }
} as any;

/** The variant is a curated subunit interface residue. */
const CURATED_RESULT = {
  metadata: { gene: "CNNM2", variant: "p.Ser489Cys", residueIndex: 489 },
  multimerData: { status: "success", chainCount: 2, oligomericState: "Homodimer", interfaceContacts: [] },
  ppiBindingData: {
    status: "success",
    gene: "CNNM2",
    variant: "p.Ser489Cys",
    bindingShift: null,
    interfaceResidues: [
      { pos: 489, description: "Interface site", isVariantPosition: true },
      { pos: 511, description: "Subunit contact", isVariantPosition: false }
    ],
    stringPartners: [{ partner: "PTP4A1", score: 0.97 }]
  }
} as any;

function makeProps(result: any, overrides: Record<string, unknown> = {}) {
  return {
    analysisState: { result, isLoading: false },
    energyUnit: "kcal/mol" as const,
    formatDdGValue: (val: number | null, unit: string) => `${val} ${unit}`,
    setSelectedMetric: vi.fn(),
    isDark: false,
    classCard: "",
    classCardHeader: "",
    classCardTitle: "",
    classBorderSec: "",
    classTextBody: "",
    classTextMute: "",
    foldingDdG: null,
    foldingStatus: null,
    onTabChange: vi.fn(),
    ...overrides
  } as any;
}

function renderTab(result: any, overrides: Record<string, unknown> = {}) {
  const props = makeProps(result, overrides);
  const view = render(<InteractionsTab {...props} />);
  return {
    ...view,
    props,
    /** Swap the analysis result the way a new query would, without unmounting. */
    show(next: any) {
      view.rerender(<InteractionsTab {...makeProps(next, overrides)} />);
    }
  };
}

describe("InteractionsTab — partner table", () => {
  it("names the population and the ordering the partner rows were drawn from", () => {
    renderTab(MONOMER_RESULT);
    const caption = screen.getByText(/strongest partners by combined association score/i);
    expect(caption).toHaveTextContent("4 strongest partners");
    expect(caption).toHaveTextContent("ranked descending");
    expect(caption).toHaveTextContent("Homo sapiens (TaxID 9606)");
  });

  it("renders the rows in descending score order, not merely saying it does", () => {
    // Describing the ordering in the caption is not the same as having it: with
    // the fixture reversed this was the only assertion that noticed.
    const { container } = renderTab(MONOMER_RESULT);
    const order = Array.from(container.querySelectorAll("tbody th")).map((th) =>
      th.textContent?.replace(/^\d/, "").trim()
    );
    expect(order).toEqual(["PTP4A1", "AS3MT", "CBSL", "NOVEL1"]);
  });

  it("labels each STRING score with the band STRING publishes for it", () => {
    renderTab(MONOMER_RESULT);
    expect(screen.getByText("PTP4A1")).toBeInTheDocument();
    expect(screen.getByText("Highest")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("does not fall back to Medium for a score below STRING's medium cut-off", () => {
    // Regression guard. The bands used to have no floor: anything under 0.700 was
    // labelled "Medium", so the 0.200 partner reported itself as medium-confidence
    // evidence. Under that code this render produced two "Medium" chips and no "Low".
    renderTab(MONOMER_RESULT);
    expect(screen.getAllByText("Medium")).toHaveLength(1);
    expect(screen.getAllByText("Low")).toHaveLength(1);
    expect(screen.getByText("0.200")).toBeInTheDocument();
  });

  it("tones each row's chip and rail by band, and leaves an unbanded score unnamed", () => {
    // `data-tone` is the entire colour contract, and it was previously unasserted:
    // mutating every tone to "neutral" kept the suite green.
    const nonFinite = {
      ...MONOMER_RESULT,
      ppiBindingData: {
        ...MONOMER_RESULT.ppiBindingData,
        stringPartners: [
          { partner: "PTP4A1", score: 0.97 },
          { partner: "AS3MT", score: 0.818 },
          { partner: "WEIRD", score: NaN }
        ]
      }
    };
    const { container } = renderTab(nonFinite);
    const tones = Array.from(container.querySelectorAll("tbody .ev-tier")).map((el) =>
      el.getAttribute("data-tone")
    );
    expect(tones).toEqual(["highest", "high", "neutral"]);

    const fills = Array.from(container.querySelectorAll(".ev-conf-fill")).map((el) =>
      el.getAttribute("data-tone")
    );
    // A score below every band is not the Low band: the classifier declines to
    // name it, so the rail must not borrow Low's tone.
    expect(fills).toEqual(["highest", "high", "none"]);
  });

  it("prints a dash and an unnamed band for a non-finite score", () => {
    const nonFinite = {
      ...MONOMER_RESULT,
      ppiBindingData: { ...MONOMER_RESULT.ppiBindingData, stringPartners: [{ partner: "WEIRD", score: NaN }] }
    };
    renderTab(nonFinite);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Unclassified")).toBeInTheDocument();
  });

  it("marks the partner cell as each row's header", () => {
    // A bare <td> makes the partner a third data cell; a screen reader then reads
    // the row as three unrelated values instead of "PTP4A1 — 0.970 — Highest".
    renderTab(MONOMER_RESULT);
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(4);
    expect(rowHeaders[0]).toHaveTextContent("PTP4A1");
  });

  it("draws one tick per inter-band cut on each strength rail", () => {
    const { container } = renderTab(MONOMER_RESULT);
    // Four bands => three cuts (0.400 / 0.700 / 0.900), on each of four rows.
    const ticks = container.querySelectorAll(".ev-conf-tick");
    expect(ticks).toHaveLength(12);

    const firstRow = container.querySelector("tbody tr")!;
    const positions = Array.from(firstRow.querySelectorAll(".ev-conf-tick")).map(
      (tick) => (tick as HTMLElement).style.left
    );
    expect(positions).toEqual(["90%", "70%", "40%"]);
  });

  it("keeps the partner link pointing at STRING-db and off the current tab", () => {
    renderTab(MONOMER_RESULT);
    const link = screen.getByRole("link", { name: /PTP4A1/ });
    expect(link).toHaveAttribute("href", "https://string-db.org/network/9606.PTP4A1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("makes the horizontal scroller reachable by keyboard", () => {
    const { container } = renderTab(MONOMER_RESULT);
    const scroller = container.querySelector(".ev-table-scroller")!;
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveAttribute("role", "region");
    expect(scroller).toHaveAccessibleName(/interaction partners/i);
  });
});

describe("InteractionsTab — request state", () => {
  it("does not claim a protein has no partners while STRING-db is still being asked", async () => {
    fetchWithAuthMock.mockImplementation(hangingFetch());
    renderTab(UNFETCHED_RESULT);

    expect(await screen.findByText("Querying STRING-db…")).toBeInTheDocument();
    expect(screen.queryByText("No interaction partners")).toBeNull();
    expect(screen.queryByText("No curated interface residues")).toBeNull();
    // The live region is in the document and empty, which is the precondition for
    // its message ever being announced.
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("still shows pending after a superseded request aborts mid-flight", async () => {
    // Regression guard for the abort race: the aborted request's `finally` used to
    // clear the flag the replacement had just set, so while the new query was in
    // flight both `pending` and `unavailable` were false and the tab printed
    // settled-absence copy for a query it had not finished. The stub rejects with
    // AbortError the way the real fetch does, which is what makes the old bug
    // reachable here.
    fetchWithAuthMock.mockImplementation(hangingFetch());
    const view = renderTab(UNFETCHED_RESULT);
    expect(await screen.findByText("Querying STRING-db…")).toBeInTheDocument();

    view.show({ ...UNFETCHED_RESULT, metadata: { ...UNFETCHED_RESULT.metadata, variant: "p.Ala100Val" } });

    // Drain the aborted request's rejection microtask chain. Without this the
    // assertion runs before the old code's `finally` cleared the flag, and the
    // test would pass against the very bug it exists to catch.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText("Querying STRING-db…")).toBeInTheDocument();
    expect(screen.queryByText("No interaction partners")).toBeNull();
    expect(screen.queryByText("No curated interface residues")).toBeNull();
  });

  it("separates a failed query from a genuinely empty result", async () => {
    fetchWithAuthMock.mockRejectedValue(new Error("offline"));
    renderTab(UNFETCHED_RESULT);

    expect(await screen.findByText("Partners not retrieved")).toBeInTheDocument();
    expect(screen.getByText("Curated sites not retrieved")).toBeInTheDocument();
    expect(screen.queryByText("No interaction partners")).toBeNull();
  });

  it("announces a failure through a live region that was already in the document", async () => {
    fetchWithAuthMock.mockRejectedValue(new Error("offline"));
    renderTab(UNFETCHED_RESULT);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("offline");
    // The node is present and empty BEFORE the message arrives — a role="alert"
    // inserted already populated is not reliably announced.
    expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  it("reads the lowest confidence band from the shared table, not a literal", async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "success",
        gene: "CNNM2",
        variant: "p.Ser489Cys",
        bindingShift: null,
        interfaceResidues: [],
        stringPartners: []
      })
    });
    renderTab(UNFETCHED_RESULT);

    const empty = await screen.findByText("No interaction partners");
    expect(empty.parentElement).toHaveTextContent("(0.150)");
  });

  it("renders the payload the endpoint returns and stores it on the analysis result", async () => {
    // The happy path had no test at all: no test ever resolved the fetch mock, so
    // the table's real data source and the cross-store write were unexecuted.
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => MONOMER_RESULT.ppiBindingData });
    renderTab(UNFETCHED_RESULT);

    expect(await screen.findByText("PTP4A1")).toBeInTheDocument();
    expect(setAnalysisStateMock).toHaveBeenCalledTimes(1);
    const next = setAnalysisStateMock.mock.calls[0][0]({ result: { metadata: { gene: "CNNM2" } } });
    expect(next.result.ppiBindingData).toBe(MONOMER_RESULT.ppiBindingData);
  });

  it("sends the zero-synthetic-fallbacks request body", async () => {
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => MONOMER_RESULT.ppiBindingData });
    renderTab({
      ...UNFETCHED_RESULT,
      multimerData: { status: "success", chainCount: 2, chainIds: ["A", "B"], complexPdb: "WT.PDB", interfaceContacts: [] }
    });
    await screen.findByText("PTP4A1");

    const [url, init] = fetchWithAuthMock.mock.calls[0];
    expect(url).toBe("/api/v1/ppi/binding-affinity");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      chainA: "A",
      chainB: "B",
      wtPdb: "WT.PDB",
      // The protocol the comment documents, which nothing asserted.
      mutPdb: null
    });
  });
});

describe("InteractionsTab — interface affinity panel", () => {
  it("says why ΔΔG_bind is absent for a monomer, instead of only showing N/A", () => {
    renderTab(MONOMER_RESULT);
    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(
      screen.getByText(/curated as a single-chain monomer, so there is no inter-chain interface/i)
    ).toBeInTheDocument();
    expect(screen.getByText("Monomer: no inter-chain interface to score")).toBeInTheDocument();
  });

  it.each([
    [1.6, "danger", "Interface disruptive"],
    [0.7, "warning", "Allosteric perturbation"],
    [0.4, "good", "Surface neutral"]
  ])("tones a computed shift of %s as %s", (ddgBind: number, tone: string, classification: string) => {
    // The computed branch — the value, its tone cut-points and its classification
    // chip — was entirely unasserted.
    renderTab(scoredResult(ddgBind));
    const value = screen.getByText(`${ddgBind} kcal/mol`);
    expect(value).toHaveAttribute("data-tone", tone);
    expect(screen.getByText(classification)).toHaveAttribute("data-tone", tone);
  });

  it("explains a computed shift and drops the quaternary CTA", () => {
    renderTab(scoredResult(1.6));
    expect(
      screen.getByText(/predicts an interface binding shift of 1.6 kcal\/mol/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open Quaternary Assembly/i })).toBeNull();
  });

  it("offers the quaternary-assembly tab when no complex exists to score", () => {
    const { props } = renderTab(MULTIMER_RESULT);
    const cta = screen.getByRole("button", { name: /Open Quaternary Assembly/i });
    fireEvent.click(cta);
    expect(props.onTabChange).toHaveBeenCalledWith("multimers");
  });

  it("does not offer the quaternary-assembly tab when the protein is a monomer", () => {
    // Nothing to model: sending the reader to the Multimers tab would be a dead end.
    renderTab(MONOMER_RESULT);
    expect(screen.queryByRole("button", { name: /Open Quaternary Assembly/i })).toBeNull();
  });

  it("reports a direct quaternary contact as the danger case", () => {
    // The most consequential claim in the tab — "this substitution sits at the
    // interface" — carried a danger tone and had no assertion behind it.
    renderTab(CONTACT_RESULT);
    expect(screen.getByText("Direct contact < 5 Å")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText(/modelled quaternary contact/i)).toBeInTheDocument();
  });

  it("reports a curated interface residue as the danger case", () => {
    renderTab(CURATED_RESULT);
    expect(screen.getByText("Interface residue")).toHaveAttribute("data-tone", "danger");
  });

  it("lists curated interface residues and marks the variant's own position", () => {
    renderTab(CURATED_RESULT);
    expect(screen.getByText("Residue 489")).toBeInTheDocument();
    expect(screen.getByText("Residue 511")).toBeInTheDocument();
    expect(screen.getAllByText("Mutation site")).toHaveLength(1);
  });

  it("reports the curated subunit annotation when no interface residues are annotated", () => {
    renderTab(MONOMER_RESULT);
    expect(screen.getByText("No curated interface residues")).toBeInTheDocument();
    expect(screen.getByText("Curated SUBUNIT annotation")).toBeInTheDocument();
  });

  it("disables Refresh for assistive tech without dropping keyboard focus", () => {
    // `disabled` removes the control from the tab order, so activating Refresh
    // with the keyboard used to send focus to <body>. Asserted on the attributes
    // rather than with toBeDisabled(), whose aria-disabled handling would report
    // this deliberately-focusable control as disabled.
    fetchWithAuthMock.mockImplementation(hangingFetch());
    renderTab(UNFETCHED_RESULT);
    const refresh = screen.getByRole("button", { name: /Analyzing/i });
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    expect(refresh).not.toHaveAttribute("disabled");
  });

  it("renders nothing until an analysis result exists", () => {
    const { container } = renderTab(null);
    expect(container).toBeEmptyDOMElement();
  });
});
