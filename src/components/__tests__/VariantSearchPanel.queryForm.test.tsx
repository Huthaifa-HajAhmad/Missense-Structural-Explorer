// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VariantSearchPanel, { WORKFLOW_STAGE_COUNTS } from "../VariantSearchPanel";
import { ONBOARDING_BENCHMARK_PRESETS } from "../../shared/benchmarkPresets";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { SettingsProvider } from "../../context/SettingsContext";

/**
 * The query form's routing, guidance and layout contracts (UI-3 .. UI-8, PIPE-1).
 *
 * Each block pins one decision: the form says what the submit will do, a history replay lands in the
 * field its notation belongs to, and a card either runs (benchmark) or fills (secondary) — never both.
 */

type PanelProps = Partial<React.ComponentProps<typeof VariantSearchPanel>>;

function renderPanel(props: PanelProps = {}) {
  return render(
    <SettingsProvider>
      <VariantSearchPanel
        isDark={false}
        classCard=""
        classCardHeader=""
        classCardTitle=""
        classInput=""
        classBorderSec=""
        {...props}
      />
    </SettingsProvider>
  );
}

const routeStatus = () => document.getElementById("coordinate-route-status") as HTMLElement;
const geneInput = () => screen.getByPlaceholderText("e.g. CNNM2") as HTMLInputElement;
const genomicInput = () => screen.getByPlaceholderText("e.g. 20-23365054-G-A") as HTMLInputElement;

const GENE_HINT = "Enter a gene symbol above (e.g. NAE1) or prefix a transcript (e.g. NM_003905.4:c.347A>G).";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  act(() => {
    useVariantAnalysisStore.getState().resetVariantAnalysisState();
    useVariantAnalysisStore.setState({
      customGene: "",
      customVariant: "",
      customUniprot: "",
      customGenomic: "",
      numberingBasis: null,
      history: [],
      analysisState: { isLoading: false, error: null, result: null } as any,
    });
  });
});

describe("Recent analyses: replay lands in the field its notation belongs to (UI-6)", () => {
  it("routes a cDNA entry to the protein/cDNA field, not the coordinate field", () => {
    const handle = vi.fn();
    act(() => {
      useVariantAnalysisStore.setState({
        history: [{ gene: "NAE1", variant: "p.Asn116Ser", uniprotId: "Q13564", query: "NM_003905.4:c.347A>G" }],
      });
    });
    renderPanel({ handleSelectHistoryItem: handle });

    fireEvent.click(screen.getByRole("button", { name: "Select recent search NAE1 p.Asn116Ser" }));

    // The replay itself is the handler's job, given the item as stored...
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ gene: "NAE1", query: "NM_003905.4:c.347A>G" }));
    // ...and the form shows the notation in the field it was typed in.
    expect(useVariantAnalysisStore.getState().customVariant).toBe("NM_003905.4:c.347A>G");
    expect(useVariantAnalysisStore.getState().customGenomic).toBe("");
  });

  it("routes a coordinate entry to the genomic field and empties the protein field", () => {
    act(() => {
      useVariantAnalysisStore.setState({
        history: [{ gene: "CNNM2", variant: "p.Arg408Trp", uniprotId: "Q9H8M5", query: "chr20-23365054-G-A" }],
      });
    });
    renderPanel({ handleSelectHistoryItem: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Select recent search CNNM2 p.Arg408Trp" }));

    expect(useVariantAnalysisStore.getState().customGenomic).toBe("chr20-23365054-G-A");
    expect(useVariantAnalysisStore.getState().customVariant).toBe("");
    expect(genomicInput().value).toBe("chr20-23365054-G-A");
  });

  it("routes a dbSNP identifier to the coordinate field, where the form accepts it", () => {
    act(() => {
      useVariantAnalysisStore.setState({
        history: [{ gene: "BRCA1", variant: "p.Cys61Gly", uniprotId: "P38398", query: "rs80357906" }],
      });
    });
    renderPanel({ handleSelectHistoryItem: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "Select recent search BRCA1 p.Cys61Gly" }));

    expect(useVariantAnalysisStore.getState().customGenomic).toBe("rs80357906");
    expect(useVariantAnalysisStore.getState().customVariant).toBe("");
  });
});

describe("bare c. notation requires a gene (UI-6)", () => {
  it("requires the gene and says what to do when it is empty", () => {
    act(() => useVariantAnalysisStore.setState({ customVariant: "c.347A>G", customGene: "" }));
    renderPanel();

    expect(geneInput()).toBeRequired();
    expect(screen.queryByText("Derived")).not.toBeInTheDocument();
    expect(screen.getByText(GENE_HINT)).toBeInTheDocument();
    expect(geneInput()).toHaveAttribute("aria-describedby", "input-gene-symbol-hint");
  });

  it("is valid once a gene is present, and says it resolves on that gene's MANE Select transcript", () => {
    act(() => useVariantAnalysisStore.setState({ customVariant: "c.347A>G", customGene: "NAE1" }));
    renderPanel();

    expect(screen.queryByText(GENE_HINT)).not.toBeInTheDocument();
    expect(screen.getByText("Resolves on NAE1's MANE Select transcript.")).toBeInTheDocument();
  });

  it("does not require a gene when the cDNA names its transcript", () => {
    act(() => useVariantAnalysisStore.setState({ customVariant: "NM_003905.4:c.347A>G", customGene: "" }));
    renderPanel();

    expect(screen.getByText("Derived")).toBeInTheDocument();
    expect(screen.queryByText(GENE_HINT)).not.toBeInTheDocument();
  });
});

describe("coordinate route status strip (UI-3)", () => {
  it("states the accepted formats when the coordinate field is empty", () => {
    renderPanel();
    expect(routeStatus()).toHaveAttribute("role", "status");
    expect(routeStatus()).toHaveAttribute("aria-live", "polite");
    expect(routeStatus()).toHaveTextContent("Accepts chr-pos-ref-alt, VCF rows, rsIDs or ClinVar VCV IDs.");
    expect(screen.queryByRole("button", { name: "Clear coordinate" })).not.toBeInTheDocument();
  });

  it("says the coordinate supplies gene and protein when it is the only route", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "20-23365054-G-A", customVariant: "" }));
    renderPanel();
    expect(routeStatus()).toHaveTextContent(
      "Coordinate route active — gene and canonical protein are derived automatically"
    );
    expect(routeStatus().querySelector(".query-route-status--warn")).toBeNull();
  });

  it("warns that the protein/cDNA field is ignored when both are filled, and clears the coordinate on request", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "20-23365054-G-A", customVariant: "p.Arg408Trp" }));
    renderPanel();

    expect(routeStatus()).toHaveTextContent("Coordinate route active — the protein/cDNA field will be ignored");
    expect(routeStatus().querySelector(".query-route-status--warn")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear coordinate" }));
    expect(useVariantAnalysisStore.getState().customGenomic).toBe("");
    expect(useVariantAnalysisStore.getState().customVariant).toBe("p.Arg408Trp");
  });

  it("does not claim the route is derived for text that is not a coordinate", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "not a coordinate", customVariant: "" }));
    renderPanel();
    expect(routeStatus()).not.toHaveTextContent("derived automatically");
    expect(routeStatus()).toHaveTextContent("Not recognised as a coordinate yet.");
  });

  it("does not claim a coordinate route for unrecognised text beside a protein entry, yet says it still overrides it", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "my notes", customVariant: "p.Arg408Trp" }));
    renderPanel();
    expect(routeStatus()).not.toHaveTextContent("Coordinate route active");
    expect(routeStatus()).toHaveTextContent("Not recognised as a coordinate yet.");
    expect(routeStatus()).toHaveTextContent("the protein/cDNA field is ignored");

    fireEvent.click(screen.getByRole("button", { name: "Clear coordinate" }));
    expect(useVariantAnalysisStore.getState().customGenomic).toBe("");
    expect(useVariantAnalysisStore.getState().customVariant).toBe("p.Arg408Trp");
  });

  it("accepts an rsID and a ClinVar VCV in the coordinate field, as the strip says it does", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "rs113488022", customVariant: "" }));
    renderPanel();
    expect(routeStatus()).toHaveTextContent("Coordinate route active");
    expect(routeStatus()).not.toHaveTextContent("Not recognised");

    act(() => useVariantAnalysisStore.setState({ customGenomic: "VCV000013961" }));
    expect(routeStatus()).toHaveTextContent("Coordinate route active");
  });
});

describe("UniProt helper line does not share the label row (UI-5)", () => {
  it("renders the accession in the left fieldset and its state below the input", () => {
    act(() => useVariantAnalysisStore.setState({ customUniprot: "Q9H8M5" }));
    renderPanel();

    const input = document.getElementById("input-uniprot-acc") as HTMLInputElement;
    expect(input.closest(".query-route:not(.query-route--coordinate)")).not.toBeNull();

    const status = document.getElementById("input-uniprot-acc-status") as HTMLElement;
    expect(status).toHaveTextContent("Format OK");
    // The label row keeps only the label and its Hide/Set action: the badge is not in it.
    const labelRow = screen.getByText("UniProt accession").closest("div") as HTMLElement;
    expect(labelRow).not.toHaveTextContent("Format OK");
    expect(input).toHaveAttribute("aria-describedby", "input-uniprot-acc-status");
  });
});

describe("benchmark cards run, like Recent analyses (UI-7)", () => {
  it("runs the benchmark through the same handler a recent analysis uses", () => {
    const handle = vi.fn();
    renderPanel({ handleSelectHistoryItem: handle });

    const preset = ONBOARDING_BENCHMARK_PRESETS[0];
    // Every card says it runs, so the affordance is visible on all of them, not only on hover.
    expect(screen.getAllByText("Run benchmark")).toHaveLength(ONBOARDING_BENCHMARK_PRESETS.length);
    fireEvent.click(screen.getByRole("button", { name: `Run benchmark ${preset.gene} ${preset.variant}` }));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({ gene: preset.gene, variant: preset.variant, uniprotId: preset.uniprotId });
  });

  it("keeps a form-only action that fills without running", () => {
    const handle = vi.fn();
    renderPanel({ handleSelectHistoryItem: handle });

    const preset = ONBOARDING_BENCHMARK_PRESETS[0];
    fireEvent.click(
      screen.getByRole("button", { name: `Fill the form with ${preset.gene} ${preset.variant} without running` })
    );

    expect(handle).not.toHaveBeenCalled();
    const state = useVariantAnalysisStore.getState();
    expect(state.customGene).toBe(preset.gene);
    expect(state.customVariant).toBe(preset.variant);
  });
});

describe("the Enter hint is a fact about the form (UI-8)", () => {
  it("shows the Enter hint without a Gemini key", () => {
    renderPanel();
    expect(screen.getByText("runs from a query field")).toBeInTheDocument();
    expect(screen.getByText("Enter", { selector: "kbd" })).toBeInTheDocument();
    // The keyless note still follows it.
    expect(screen.getByRole("button", { name: /^add a key$/i })).toBeInTheDocument();
  });
});

describe("stage counts agree across idle and running states (PIPE-1)", () => {
  it("idles with the automatic count and the on-demand count, both from the stage list", () => {
    renderPanel();
    act(() => { document.querySelector<HTMLElement>("[role='tab'][id='tab-pipeline']")?.click(); });
    expect(screen.getByText("6 core · 1 on-demand")).toBeInTheDocument();
    expect(WORKFLOW_STAGE_COUNTS).toEqual({ core: 6, onDemand: 1 });
  });

  it("keeps the denominator at the core count once the reader opens literature", () => {
    act(() => {
      useVariantAnalysisStore.getState().setAnalysisState({
        isLoading: false,
        error: null,
        result: {
          metadata: {
            gene: "SLC12A4",
            variant: "p.Gln867His",
            uniprotId: "Q9UP95",
            pipelineStages: { core: "complete", landscape: "complete", literature: "complete" },
          },
          ruleBasedInsights: { acmgVerdict: "Uncertain Significance" },
          landscapeData: [{ position: 867 }],
        } as any,
      });
      useVariantAnalysisStore.getState().setPdbText("ATOM coordinates");
    });
    renderPanel();
    act(() => { document.querySelector<HTMLElement>("[role='tab'][id='tab-pipeline']")?.click(); });

    // Literature is complete, but it is on-demand: the count must not become "N of 7".
    expect(screen.getByText(/of 6 settled$/)).toBeInTheDocument();
    expect(screen.queryByText(/of 7 settled/)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "6");
  });
});
