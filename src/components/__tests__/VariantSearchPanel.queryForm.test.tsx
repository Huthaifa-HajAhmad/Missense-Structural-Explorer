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
  it("keeps the empty route quiet until there is actionable feedback", () => {
    renderPanel();
    expect(routeStatus()).toHaveAttribute("role", "status");
    expect(routeStatus()).toHaveAttribute("aria-live", "polite");
    expect(routeStatus()).toBeEmptyDOMElement();
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

  /**
   * "Both filled" is not a conflict. Amber needs evidence of a DISAGREEMENT, and the only evidence a
   * submit has not yet produced is this session's own resolution of the coordinate (history holds the
   * submitted notation beside the substitution it resolved to).
   *
   * The bug this pins: the app fills the protein/cDNA field with the coordinate's resolution, so the
   * ordinary both-filled state AGREES with itself — and it still wore an alarm-styled card plus a
   * button that deletes the input the run actually uses.
   */
  it("says which route runs — quietly — when both fields hold the same substitution", () => {
    act(() => {
      useVariantAnalysisStore.setState({
        customGenomic: "16-66823281-T-C",
        customVariant: "p.Asp116Gly",
        history: [{ gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", query: "16-66823281-T-C" }],
      });
    });
    renderPanel();

    expect(routeStatus()).toHaveTextContent("Using the coordinate; the protein/cDNA field is not analysed.");
    expect(routeStatus().querySelector(".query-route-status--warn")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear coordinate" })).not.toBeInTheDocument();
  });

  it("warns when the coordinate is known to resolve to a DIFFERENT change, names both, and clears on request", () => {
    act(() => {
      useVariantAnalysisStore.setState({
        customGenomic: "16-66823281-T-C",
        customVariant: "p.Ala1Val",
        history: [{ gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", query: "16-66823281-T-C" }],
      });
    });
    renderPanel();

    const status = routeStatus();
    expect(status.querySelector(".query-route-status--warn")).not.toBeNull();
    // Both sides are named: one of them alone leaves the reader guessing which is which.
    expect(status).toHaveTextContent("This coordinate resolves to p.Asp116Gly, not p.Ala1Val");

    fireEvent.click(screen.getByRole("button", { name: "Clear coordinate" }));
    expect(useVariantAnalysisStore.getState().customGenomic).toBe("");
    expect(useVariantAnalysisStore.getState().customVariant).toBe("p.Ala1Val");
  });

  it("does not mistake the same change written another way for a conflict", () => {
    act(() => {
      useVariantAnalysisStore.setState({
        customGenomic: "16-66823281-T-C",
        customVariant: "p.D116G",
        history: [{ gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", query: "16-66823281-T-C" }],
      });
    });
    renderPanel();

    // Identity is the parsed substitution (residue + change), not the spelling.
    expect(routeStatus().querySelector(".query-route-status--warn")).toBeNull();
    expect(routeStatus()).toHaveTextContent("Using the coordinate");
  });

  it("does not call a never-resolved coordinate a conflict", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "20-23365054-G-A", customVariant: "p.Arg408Trp" }));
    renderPanel();

    // Nothing known is not a disagreement: amber here would be the same false alarm in a new costume.
    expect(routeStatus().querySelector(".query-route-status--warn")).toBeNull();
    expect(routeStatus()).toHaveTextContent("Using the coordinate");
    expect(screen.queryByRole("button", { name: "Clear coordinate" })).not.toBeInTheDocument();
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

/**
 * The UniProt field's state lives in the LABEL ROW's one slot — where every other field in this form
 * states "Derived", "Optional", "Protein HGVS" — and that slot used to hold a Hide/Set link instead.
 *
 * Two decisions are pinned here:
 *
 * 1. The state is in that slot, not on a helper line under the input. Under the input it had NO gap
 *    above it (the wrapper was a plain div while the collapsed toggle was a flex child), so the inline
 *    chip landed exactly on the input's bottom border and covered its rounded corner.
 * 2. There is no collapse affordance any more, so there is no Hide/Set control: closed, the field was
 *    a 40px summary button printing the same accession the input prints, and it cost a click to edit.
 * 3. Only a MALFORMED accession wears a chip. A well-formed one is the ordinary case and reads as
 *    muted text — a green chip there was the loudest colour in an otherwise grey row.
 */
describe("UniProt state takes the label-row slot (UI-5)", () => {
  it("states the accession's state in the label row and keeps the field always editable", () => {
    act(() => useVariantAnalysisStore.setState({ customUniprot: "Q9H8M5" }));
    renderPanel();
    fireEvent.click(screen.getByText("Edit parsed fields"));

    const input = document.getElementById("input-uniprot-acc") as HTMLInputElement;
    // The accession sits in the one fields grid, on the gene's row.
    expect(input.closest("#workspace-accepted-inputs")).not.toBeNull();
    // No reveal step: the input is there on first paint, empty or filled.
    expect(input).toBeVisible();

    const status = document.getElementById("input-uniprot-acc-status") as HTMLElement;
    expect(status).toHaveTextContent("Format OK");
    // The state is the label row's content, next to the label it describes.
    const labelRow = screen.getByText("UniProt accession").closest("label") as HTMLElement;
    expect(labelRow).toContainElement(status);
    // ...and it still describes the input for assistive tech.
    expect(input).toHaveAttribute("aria-describedby", "input-uniprot-acc-status");

    // The slot's old occupant is gone: nothing to hide, nothing to set.
    expect(screen.queryByRole("button", { name: /UniProt accession/ })).not.toBeInTheDocument();
  });

  it("wears a chip only for a malformed accession", () => {
    act(() => useVariantAnalysisStore.setState({ customUniprot: "Q9H8M5" }));
    renderPanel();

    const status = document.getElementById("input-uniprot-acc-status") as HTMLElement;
    // Neutral tone = muted text, no chip surface.
    expect(status.className).not.toContain("cs-bg-success");
    expect(status.className).not.toContain("cs-bg-warning");

    act(() => useVariantAnalysisStore.setState({ customUniprot: "123456" }));
    expect(status).toHaveTextContent("Check format");
    // A typo is the state worth a chip: warn is the only loud tone this slot has.
    expect(status.className).toContain("cs-bg-warning");
  });
});

/**
 * The deck's bottom edges. Three cards on one page: the form, the rail beside it, and Recent
 * analyses under the form. The recent card used to live INSIDE the form's column, which made that
 * column taller than its own first card — the rail was then pinned to a fixed 672px floor against a
 * content-sized form, so its bottom corner hung ~11px below the form's and floated beside the card.
 * Row 1 is now shared, so the two stretch together.
 */
describe("workspace deck: the recent card is a row of its own, not the form's column (UI-9)", () => {
  it("puts the form and the rail on one grid row and the recent card on the next", () => {
    renderPanel();
    const form = document.getElementById("variant-input-card") as HTMLElement;
    const rail = document.getElementById("workspace-stage-rail") as HTMLElement;
    const recent = document.querySelector('[data-tour="recent-benchmarks"]') as HTMLElement;

    expect(recent).not.toBeNull();
    // Siblings in the grid, so row 1's height is the tallest of form/rail and nothing depends on
    // the recent card being present.
    expect(recent.parentElement).toBe(form.parentElement);
    expect(rail.parentElement).toBe(form.parentElement);
    expect(recent.className).toContain("lg:row-start-2");
    expect(rail.className).toContain("lg:row-start-1");
    // Stretched to the row, not pinned to its own floor: the near-miss corner.
    expect(rail.className).not.toContain("lg:self-start");
  });
});

/**
 * The fields are one grid, so a row shares its baseline by construction. The old two-column layout reserved a
 * helper band (`data-help-lines`) to keep the columns level, and gave the coordinate a column of its own with a
 * "Genome build" row that read "Follows the coordinate you enter" until a build existed.
 */
describe("form layout: one grid, no reserved band, no separate coordinate column (UI-10)", () => {
  const band = () => document.getElementById("workspace-accepted-inputs") as HTMLElement;

  it("holds all four fields in one group, without a reserved helper band", () => {
    act(() => useVariantAnalysisStore.setState({ customGene: "NAE1", customVariant: "p.Asp116Gly" }));
    renderPanel();
    for (const id of ["input-gene-symbol", "input-uniprot-acc", "input-variant-notation", "input-genomic-coords"]) {
      expect(band()).toContainElement(document.getElementById(id));
    }
    expect(band()).not.toHaveAttribute("data-help-lines");
    expect(band().querySelector("fieldset, legend")).toBeNull();
  });

  it("does not print a build row for a coordinate that cannot carry one", () => {
    renderPanel();
    expect(screen.queryByText("Genome build")).not.toBeInTheDocument();
    expect(screen.queryByText(/Follows the coordinate you enter/)).not.toBeInTheDocument();
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

describe("query footer", () => {
  it("omits redundant keyboard guidance while retaining key setup", () => {
    renderPanel();
    expect(screen.queryByText("runs from a query field")).not.toBeInTheDocument();
    expect(screen.queryByText("Enter", { selector: "kbd" })).not.toBeInTheDocument();
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

describe("Quick entry: one line over the four fields", () => {
  const quick = () => document.getElementById("input-quick-entry") as HTMLInputElement;

  it("fills gene and protein change from one line, and keeps a trailing space while typing", () => {
    renderPanel();
    fireEvent.change(quick(), { target: { value: "NAE1 " } });
    expect(geneInput().value).toBe("NAE1");
    expect(quick().value).toBe("NAE1 ");
    fireEvent.change(quick(), { target: { value: "NAE1 p.Asp116Gly" } });
    expect((screen.getByPlaceholderText("e.g. p.Gly380Arg") as HTMLInputElement).value).toBe("p.Asp116Gly");
  });

  it("sends a coordinate to the coordinate field", () => {
    renderPanel();
    fireEvent.change(quick(), { target: { value: "20-23365054-G-A" } });
    expect(genomicInput().value).toBe("20-23365054-G-A");
    expect(geneInput().value).toBe("");
  });

  it("follows the fields when they change from elsewhere", () => {
    renderPanel();
    act(() => {
      useVariantAnalysisStore.setState({ customGene: "CNNM2", customVariant: "p.Ser489Cys" });
    });
    expect(quick().value).toBe("CNNM2 p.Ser489Cys");
  });
});

describe("Parsed fields speak the composer's grammar", () => {
  it("draws fields as composer boxes and field states as toned dots, not tinted pills", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "20-23365054-G-A" }));
    renderPanel();

    // Every editable field wears the one field box; no caller-supplied fill is mixed in.
    for (const input of [geneInput(), genomicInput()]) {
      expect(input.classList.contains("qe-input")).toBe(true);
      expect(input.className).not.toContain("surface-2");
    }

    // The coordinate states the gene, so the label says "Derived" with the ticket's clay dot.
    const derived = screen.getByText("Derived");
    expect(derived.querySelector('.qe__kind[data-tone="clay"]')).not.toBeNull();
    expect(derived.className).not.toContain("bg-");
  });

  it("puts the genome-build select in the coordinate label's slot, named for assistive tech", () => {
    act(() => useVariantAnalysisStore.setState({ customGenomic: "20-23365054-G-A" }));
    renderPanel();

    const select = document.getElementById("input-genomic-build") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.closest(".qe-select")).not.toBeNull();
    expect(select).toHaveAccessibleName("Genome build this coordinate is expressed in");
    // Beside the label it describes, the way the notation field carries its build: not a row of its own.
    const labelRow = screen.getByText("Genomic coordinates").closest(".qe-field-label") as HTMLElement;
    expect(labelRow).toContainElement(select);
  });
});
