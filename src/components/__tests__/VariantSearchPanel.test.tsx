// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VariantSearchPanel, { WORKFLOW_STAGES, formatVariantForDisplay } from "../VariantSearchPanel";
import { ONBOARDING_BENCHMARK_PRESETS } from "../../shared/benchmarkPresets";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { SettingsProvider } from "../../context/SettingsContext";
import { ACCEPTED_NOTATION_EXAMPLES, classifyNotation } from "../../shared/variantNotation";

function renderPanel() {
  return render(
    <SettingsProvider>
      <VariantSearchPanel
        isDark={false}
        classCard=""
        classCardHeader=""
        classCardTitle=""
        classInput=""
        classBorderSec=""
      />
    </SettingsProvider>
  );
}

describe("VariantSearchPanel numbering choice", () => {
  const CHOICES = [
    { variant: "p.Asp85Phe", basisId: "Q9Y305", basisKind: "canonical" as const, canonicalPosition: 85, label: "Canonical numbering (Q9Y305)" },
    { variant: "p.Asp76Phe", basisId: "Q9Y305-4", basisKind: "isoform" as const, canonicalPosition: 76, label: "MANE/isoform numbering (Q9Y305-4)" },
  ];

  const seedRefusal = (over: Record<string, unknown> = {}) =>
    act(() => {
      useVariantAnalysisStore.setState({
        customGene: "ACOT9",
        customVariant: "p.Asp85Phe",
        customUniprot: "Q9Y305",
        customGenomic: "",
        numberingBasis: null,
        analysisState: {
          isLoading: false,
          error: "Analysis query error: ambiguous numbering",
          result: {
            metadata: { gene: "ACOT9", uniprotId: "Q9Y305" },
            numberingNotation: "p.Asp85Phe",
            numberingChoices: CHOICES,
          },
        } as any,
        ...over,
      });
    });

  beforeEach(() => {
    act(() => {
      useVariantAnalysisStore.getState().resetVariantAnalysisState();
      useVariantAnalysisStore.setState({
        customGene: "",
        customVariant: "",
        customUniprot: "",
        customGenomic: "",
        numberingBasis: null,
        history: [],
        analysisState: { isLoading: false, error: null, result: null } as any
      });
    });
  });

  it("offers the readings, and records the reader's decision when they choose canonical", () => {
    seedRefusal();
    renderPanel();

    expect(screen.getByTestId("numbering-choice-prompt")).toBeTruthy();
    fireEvent.click(screen.getByTestId("numbering-choice-Q9Y305"));

    // The canonical reading keeps the same notation, so the DECISION is what has to reach the request —
    // otherwise the route refuses it again and the prompt loops.
    const state = useVariantAnalysisStore.getState();
    expect(state.customVariant).toBe("p.Asp85Phe");
    expect(state.numberingBasis).toBe("canonical");
  });

  it("records no decision for the isoform reading, whose notation is already canonical", () => {
    seedRefusal();
    renderPanel();

    fireEvent.click(screen.getByTestId("numbering-choice-Q9Y305-4"));

    const state = useVariantAnalysisStore.getState();
    expect(state.customVariant).toBe("p.Asp76Phe");
    expect(state.numberingBasis).toBeNull();
  });

  it("hides the prompt once the inputs no longer match the refused run", () => {
    seedRefusal({ customVariant: "p.Phe508del" });
    renderPanel();

    // The choices belong to the PREVIOUS notation; answering them against new inputs would submit the
    // old candidates for a different query.
    expect(screen.queryByTestId("numbering-choice-prompt")).toBeNull();
  });

  it("clears a decision when the notation changes", () => {
    seedRefusal();
    renderPanel();
    fireEvent.click(screen.getByTestId("numbering-choice-Q9Y305"));
    expect(useVariantAnalysisStore.getState().numberingBasis).toBe("canonical");

    act(() => {
      useVariantAnalysisStore.getState().setCustomVariant("p.Arg64Ala");
    });

    // A decision is about ONE notation: a stale one would silently suppress the refusal for a
    // different query.
    expect(useVariantAnalysisStore.getState().numberingBasis).toBeNull();
  });
});

describe("VariantSearchPanel Input & Paste Tests", () => {
  beforeEach(() => {
    act(() => {
      useVariantAnalysisStore.getState().resetVariantAnalysisState();
      useVariantAnalysisStore.setState({
        customGene: "",
        customVariant: "",
        customUniprot: "",
        customGenomic: "",
        gene: "",
        variant: "",
        uniprotId: "",
        history: [],
        isFolding: false,
        isBiophysicalLoading: false,
        isClinicalLoading: false,
        isNarrativeLoading: false,
        isPocketLoading: false,
        analysisState: { isLoading: false, error: null, result: null } as any
      });
    });
  });

  it("allows entering text in gene, variant, genomic, and uniprot fields", () => {
    renderPanel();

    const geneInput = screen.getByPlaceholderText("e.g. CNNM2") as HTMLInputElement;
    const variantInput = screen.getByPlaceholderText("e.g. p.Gly380Arg") as HTMLInputElement;
    const genomicInput = screen.getByPlaceholderText("e.g. 20-23365054-G-A") as HTMLInputElement;
    const uniprotInput = screen.getByPlaceholderText("e.g. Q9H8M5") as HTMLInputElement;

    // Type into Gene field
    fireEvent.change(geneInput, { target: { value: "MECP2" } });
    expect(geneInput.value).toBe("MECP2");
    expect(useVariantAnalysisStore.getState().customGene).toBe("MECP2");

    // Type into Variant field
    fireEvent.change(variantInput, { target: { value: "p.Arg255Ter" } });
    expect(variantInput.value).toBe("p.Arg255Ter");
    expect(useVariantAnalysisStore.getState().customVariant).toBe("p.Arg255Ter");

    // Type into Genomic Coordinates field
    fireEvent.change(genomicInput, { target: { value: "X-154030588-C-T" } });
    expect(genomicInput.value).toBe("X-154030588-C-T");
    expect(useVariantAnalysisStore.getState().customGenomic).toBe("X-154030588-C-T");

    // Type into UniProt field
    fireEvent.change(uniprotInput, { target: { value: "P51608" } });
    expect(uniprotInput.value).toBe("P51608");
    expect(useVariantAnalysisStore.getState().customUniprot).toBe("P51608");
  });

  it("pastes text from clipboard into fields when paste button is clicked", async () => {
    const originalClipboard = navigator.clipboard;
    const mockReadText = vi.fn().mockResolvedValue("BRCA1");

    Object.defineProperty(navigator, "clipboard", {
      value: { readText: mockReadText },
      writable: true,
      configurable: true
    });

    renderPanel();

    const pasteButtons = screen.getAllByTitle("Paste from clipboard");
    expect(pasteButtons.length).toBeGreaterThanOrEqual(4);

    // Click paste on Gene input
    await act(async () => {
      fireEvent.click(pasteButtons[0]);
    });

    const geneInput = screen.getByPlaceholderText("e.g. CNNM2") as HTMLInputElement;
    expect(geneInput.value).toBe("BRCA1");
    expect(useVariantAnalysisStore.getState().customGene).toBe("BRCA1");

    // Restore clipboard
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true
    });
  });

  it("renders Service Telemetry by default when idle and allows toggling to Workflow Pipeline", async () => {
    renderPanel();

    // Verify Telemetry is active by default
    expect(screen.getByText("Service status")).toBeInTheDocument();
    expect(screen.getByText("Ensembl VEP")).toBeInTheDocument();
    expect(screen.getByText("FoldX Engine")).toBeInTheDocument();
    expect(screen.getByText("P2Rank Pocket Engine")).toBeInTheDocument();

    // Click on Workflow Pipeline tab
    const pipelineTabBtn = screen.getByRole("tab", { name: /Pipeline/i });
    await act(async () => {
      fireEvent.click(pipelineTabBtn);
    });

    // Verify Workflow Pipeline view is now active
    expect(screen.getByRole("tabpanel", { name: /Pipeline/i })).toBeInTheDocument();
    expect(screen.getByText("3D structure")).toBeInTheDocument();

    // Click back to Service Telemetry
    const telemetryTabBtn = screen.getByRole("tab", { name: /Services/i });
    await act(async () => {
      fireEvent.click(telemetryTabBtn);
    });
    expect(screen.getByText("Service status")).toBeInTheDocument();
  });

  it("auto-switches to Workflow Pipeline tab when isPipelineActive becomes true", async () => {
    renderPanel();

    // Starts in Telemetry
    expect(screen.getByText("Service status")).toBeInTheDocument();

    // Trigger pipeline active state in store
    await act(async () => {
      useVariantAnalysisStore.setState({ isBiophysicalLoading: true });
    });

    // Verify it automatically switched to Workflow Pipeline
    expect(screen.getByRole("tabpanel", { name: /Pipeline/i })).toBeInTheDocument();
  });

  it("auto-switches to Workflow Pipeline tab when search form is submitted", async () => {
    renderPanel();

    // Starts in Telemetry
    expect(screen.getByText("Service status")).toBeInTheDocument();

    const geneInput = screen.getByPlaceholderText("e.g. CNNM2");
    const form = geneInput.closest("form");
    expect(form).not.toBeNull();

    await act(async () => {
      fireEvent.submit(form!);
    });

    // Verify submit triggers switch to Workflow Pipeline
    expect(screen.getByRole("tabpanel", { name: /Pipeline/i })).toBeInTheDocument();
  });

  it("renders zero-history placeholder when search history is empty", () => {
    renderPanel();

    expect(screen.getByText("No recent analyses")).toBeInTheDocument();
    expect(screen.getByText(/Variants you analyse in this session will appear here/i)).toBeInTheDocument();
  });

  it("renders recent search pills when history is populated and selects item on click", async () => {
    await act(async () => {
      useVariantAnalysisStore.setState({
        customGenomic: "chr7-140753336-A-T",
        history: [
          { gene: "BRAF", variant: "p.V600E", uniprotId: "P15056" }
        ]
      });
    });

    renderPanel();

    // Verify recent analyses tray rendered
    expect(screen.getByRole("heading", { name: /Recent analyses\s*1/i })).toBeInTheDocument();
    expect(screen.getByText("BRAF")).toBeInTheDocument();
    expect(screen.getByText("p.V600E")).toBeInTheDocument();

    // Click the recent search pill
    const pill = screen.getByRole("button", { name: /Select recent search BRAF p\.V600E/i });
    await act(async () => {
      fireEvent.click(pill);
    });

    // Check store updated and stale inputs cleared
    expect(useVariantAnalysisStore.getState().customGene).toBe("BRAF");
    expect(useVariantAnalysisStore.getState().customVariant).toBe("p.V600E");
    expect(useVariantAnalysisStore.getState().customUniprot).toBe("P15056");
    expect(useVariantAnalysisStore.getState().customGenomic).toBe("");
    expect(pill.getAttribute("aria-pressed")).toBe("true");

    // Click Clear button
    const clearBtn = screen.getByRole("button", { name: /Clear search history/i });
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    // Verify history cleared and placeholder appears
    expect(screen.getByText("No recent analyses")).toBeInTheDocument();
  });

  it("applies cs-tab-transition animation to tab panels", async () => {
    renderPanel();

    const telemetryPanel = screen.getByRole("tabpanel");
    expect(telemetryPanel.className).toContain("cs-tab-transition");

    const pipelineTab = screen.getByRole("tab", { name: /Pipeline/i });
    await act(async () => {
      fireEvent.click(pipelineTab);
    });

    const pipelinePanel = screen.getByRole("tabpanel");
    expect(pipelinePanel.className).toContain("cs-tab-transition");
  });

  it("enables keyboard navigation on workflow stage cards when analysis result is present", async () => {
    const mockOnViewChange = vi.fn();
    render(
      <SettingsProvider>
        <VariantSearchPanel
          isDark={false}
          onViewChange={mockOnViewChange}
          analysisState={{ isLoading: false, error: null, result: { gene: "BRAF", variant: "p.V600E" } as any }}
        />
      </SettingsProvider>
    );

    // Switch to Workflow Pipeline tab
    const pipelineTab = screen.getByRole("tab", { name: /Pipeline/i });
    await act(async () => {
      fireEvent.click(pipelineTab);
    });

    const structureCard = screen.getByRole("button", { name: /Navigate to 3D Structure view/i });
    expect(structureCard).toBeInTheDocument();

    // Trigger Enter key press
    fireEvent.keyDown(structureCard, { key: "Enter" });
    expect(mockOnViewChange).toHaveBeenCalledWith("structure");

    // Trigger Space key press
    fireEvent.keyDown(structureCard, { key: " " });
    expect(mockOnViewChange).toHaveBeenCalledWith("structure");
  });

  it("does not claim readiness in the rail header, and shows the derived pipeline badge", async () => {
    renderPanel();

    // The telemetry tab used to carry an unconditional emerald "Pre-flight Ready" chip that read
    // no diagnostics state, so it asserted readiness while the panel beneath it could render
    // "Checking…" or "0/10 Online" in rose. It is gone: the telemetry panel's own counter is the
    // single status indicator for that tab.
    expect(screen.queryByText("Pre-flight Ready")).not.toBeInTheDocument();
    expect(screen.queryByText("v1.0.0-dev")).not.toBeInTheDocument();

    // The pipeline badge IS derived from real run state, so it survives.
    const pipelineTab = screen.getByRole("tab", { name: /Pipeline/i });
    await act(async () => {
      fireEvent.click(pipelineTab);
    });
    expect(screen.getByText("Pipeline ready")).toBeInTheDocument();

    // Verify service cards do not render redundant inline settings pills
    expect(screen.queryByTitle(/Configure FoldX Engine settings/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Configure Gemini Clinical AI settings/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Configure P2Rank Pocket Engine settings/i)).not.toBeInTheDocument();
  });

  it("supports roving focus and arrow-key navigation across the rail switcher", async () => {
    renderPanel();

    const telemetryTab = screen.getByRole("tab", { name: /Services/i });
    const pipelineTab = screen.getByRole("tab", { name: /Pipeline/i });
    const tablist = screen.getByRole("tablist", { name: /rail switcher|sidebar view switcher/i });

    // One tab stop, not two: the inactive segment is removed from the tab order.
    expect(telemetryTab.getAttribute("tabindex")).toBe("0");
    expect(pipelineTab.getAttribute("tabindex")).toBe("-1");

    await act(async () => {
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
    });
    expect(screen.getByRole("tabpanel", { name: /Pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Pipeline/i }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: /Services/i }).getAttribute("tabindex")).toBe("-1");

    await act(async () => {
      fireEvent.keyDown(tablist, { key: "Home" });
    });
    expect(screen.getByText("Service status")).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(tablist, { key: "End" });
    });
    expect(screen.getByRole("tabpanel", { name: /Pipeline/i })).toBeInTheDocument();

    // Arrow keys wrap rather than dead-ending at the edge.
    await act(async () => {
      fireEvent.keyDown(tablist, { key: "ArrowRight" });
    });
    expect(screen.getByText("Service status")).toBeInTheDocument();
  });

  it("keeps the active tab's aria-controls resolvable and never points at an unmounted panel", async () => {
    renderPanel();

    const active = screen.getByRole("tab", { name: /Services/i });
    const inactive = screen.getByRole("tab", { name: /Pipeline/i });

    expect(active.getAttribute("aria-controls")).toBe("panel-telemetry");
    expect(document.getElementById("panel-telemetry")).not.toBeNull();
    // A dangling IDREF is an axe "serious" violation, so the inactive tab must not reference a
    // panel that is not mounted.
    expect(inactive.getAttribute("aria-controls")).toBeNull();
  });

  it("displays Key Ready for AlphaGenome Atlas when configured in client settings", async () => {
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ alphagenomeApiKey: "ag-secret-key-xyz" }));

    renderPanel();

    expect(screen.getByText("AlphaGenome Atlas")).toBeInTheDocument();
    expect(await screen.findByText(/key ready/i)).toBeInTheDocument();

    sessionStorage.removeItem("missenseTransientCredentials");
  });

  /**
   * The form already routes on the notation grammar, but did so invisibly: required-field
   * asterisks changed meaning based on a parse the user could not see. These tests cover the
   * surface that makes the parse legible.
   */
  describe("live notation understanding", () => {
    it("labels a protein substitution as analysed directly", async () => {
      renderPanel();

      const variantInput = screen.getByPlaceholderText("e.g. p.Gly380Arg");
      await act(async () => {
        fireEvent.change(variantInput, { target: { value: "p.Gly380Arg" } });
      });

      expect(screen.getByText("Protein HGVS")).toBeInTheDocument();
      expect(screen.queryByText("Derived")).not.toBeInTheDocument();
    });

    it("labels a coordinate notation as needing resolution, and marks the gene derived", async () => {
      renderPanel();

      const variantInput = screen.getByPlaceholderText("e.g. p.Gly380Arg");
      await act(async () => {
        fireEvent.change(variantInput, { target: { value: "chr1:g.25484258G>A" } });
      });

      /**
       * The build control TAKES the badge's slot when the notation can state a build (both fields do
       * this), so the verdict chip is not rendered beside it — two `shrink-0` items cannot share a
       * pinned 20px row. The verdict is still visible: the control's own accessible name says which
       * family it belongs to, and the gene is still marked derived below.
       */
      expect(
        screen.getByLabelText("Genome build this coordinate is expressed in")
      ).toBeInTheDocument();
      expect(screen.queryByText("Genomic → resolve")).not.toBeInTheDocument();
      // The gene is resolved from the coordinate, which is why the asterisk disappeared.
      expect(screen.getByText("Derived")).toBeInTheDocument();
    });

    it("keeps the verdict badge where no build can be stated", async () => {
      /**
       * An indel is a recognised notation (so it keeps its verdict chip) but carries no single
       * position to annotate, so `withAssemblyAnnotation` returns null and no control is rendered —
       * the badge is not displaced by a control that could not act.
       */
      renderPanel();

      const variantInput = screen.getByPlaceholderText("e.g. p.Gly380Arg");
      await act(async () => {
        fireEvent.change(variantInput, { target: { value: "chr1:g.25484258delG" } });
      });

      expect(screen.getByText("Out of scope")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Genome build this/)).not.toBeInTheDocument();
    });

    it("warns when a coordinate notation is outside the missense scope", async () => {
      renderPanel();

      const variantInput = screen.getByPlaceholderText("e.g. p.Gly380Arg");
      await act(async () => {
        fireEvent.change(variantInput, { target: { value: "chr1:g.25484258delG" } });
      });

      expect(screen.getByText("Out of scope")).toBeInTheDocument();
    });

    it.each([
      ["Q9H8", false],
      ["Q9H8M5", true],
      ["A0A0B4J2F0", true],
      ["A0A0B4J2F", false],
      ["Q9H8M5ABCDE", false],
      ["q9h8m5", true],
      ["P51587", true],
      ["O60260", true],
      // The previous pattern accepted any six alphanumerics, so these read "Format OK".
      ["123456", false],
      ["000000", false],
    ])("validates the UniProt accession boundary %s -> %s", async (value, valid) => {
      renderPanel();

      const uniprotInput = screen.getByPlaceholderText("e.g. Q9H8M5") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(uniprotInput, { target: { value } });
      });

      expect(screen.getByText(valid ? "Format OK" : "Check format")).toBeInTheDocument();
    });

    it("shows the AI focus field open, with its privacy note and live counter", async () => {
      renderPanel();

      const textarea = screen.getByLabelText("AI Focus Area & Custom Analysis Instructions") as HTMLTextAreaElement;
      // Optional reference and example disclosures do not collapse the writing surface.
      expect(textarea.closest("details")).toBeNull();
      expect(textarea).toBeVisible();
      expect(screen.getByText(/Do not include patient identifiers/)).toBeInTheDocument();
      expect(screen.getByText("0/2000")).toBeInTheDocument();

      await act(async () => {
        fireEvent.change(textarea, { target: { value: "Focus on the cofactor loop" } });
      });

      expect(screen.getByText("26/2000")).toBeInTheDocument();
    });

    it("does not claim a genome build for text that is not a coordinate", async () => {
      renderPanel();

      const genomicInput = screen.getByPlaceholderText("e.g. 20-23365054-G-A") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(genomicInput, { target: { value: "p.Gly380Arg" } });
      });

      // The badge used to assert "GRCh38 default" for ANY non-empty content while also marking
      // the Gene field "Derived" — a resolution that could never happen, and a relaxed
      // required-field rule for input the pipeline cannot use.
      expect(screen.queryByText("GRCh38 default")).not.toBeInTheDocument();
      expect(screen.queryByText("Derived")).not.toBeInTheDocument();
      expect(screen.getByText("Protein HGVS")).toBeInTheDocument();
    });

    it("still reports the build for a genuine coordinate with an inline annotation", async () => {
      renderPanel();

      const genomicInput = screen.getByPlaceholderText("e.g. 20-23365054-G-A") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(genomicInput, { target: { value: "chr1(GRCh37):g.25484258G>A" } });
      });

      /**
       * The claim and the control are the same element now: the slot used to print
       * "GRCh37 annotated", and it holds the build selector — whose value is DERIVED from the
       * notation, so the assertion is the same one (a stated build is reported) against a control
       * the reader can also change.
       */
      const buildSelect = screen.getByLabelText(
        "Genome build this coordinate is expressed in"
      ) as HTMLSelectElement;
      expect(buildSelect.value).toBe("GRCh37");
      expect(buildSelect.getAttribute("title")).toContain("in the notation");
      expect(screen.getByText("Derived")).toBeInTheDocument();
    });
  });

  describe("accepted-inputs catalogue", () => {
    it("reveals additional formats and applies an accessioned notation without losing its reference", () => {
      renderPanel();
      const exampleName = `Use example ${ACCEPTED_NOTATION_EXAMPLES.proteinAccessioned} in the Variant notation field`;
      expect(screen.getByRole("button", { name: exampleName })).not.toBeVisible();
      fireEvent.click(screen.getByText("More protein & cDNA formats"));
      expect(screen.getByRole("button", { name: exampleName })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: exampleName }));
      expect(useVariantAnalysisStore.getState().customVariant).toBe(ACCEPTED_NOTATION_EXAMPLES.proteinAccessioned);
      expect(useVariantAnalysisStore.getState().customGenomic).toBe("");
    });

    it("preserves a specified accession when its inline option is collapsed", () => {
      renderPanel();
      const reference = screen.getByPlaceholderText("e.g. Q9H8M5");
      expect(reference).not.toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Set UniProt accession" }));
      expect(reference).toBeVisible();
      fireEvent.change(reference, { target: { value: "Q9H8M5" } });
      fireEvent.click(screen.getByRole("button", { name: "Hide UniProt accession" }));
      expect(reference).not.toBeVisible();
      expect(useVariantAnalysisStore.getState().customUniprot).toBe("Q9H8M5");
      expect(screen.getByText("Using Q9H8M5")).toBeVisible();
    });

    it("keeps a populated protein reference visible when returning to the form", () => {
      act(() => useVariantAnalysisStore.setState({ customUniprot: "Q9H8M5" }));
      renderPanel();
      expect(screen.getByPlaceholderText("e.g. Q9H8M5")).toBeVisible();
      expect(screen.getByPlaceholderText("e.g. Q9H8M5")).toHaveValue("Q9H8M5");
      const reference = screen.getByPlaceholderText("e.g. Q9H8M5");
      reference.focus();
      fireEvent.change(reference, { target: { value: "" } });
      expect(reference).toBeVisible();
      expect(reference).toHaveFocus();
    });

    it("sources every example from the shared catalogue, and every one parses", () => {
      renderPanel();

      // Asserted against the SOURCE, not against literals: hardcoding the six strings pinned
      // today's values while leaving the actual claim — that the panel cannot advertise a grammar
      // `classifyNotation` rejects — completely unasserted. The ClinVar Variation ID the previous
      // hand-written copy listed is absent because the analysis route has no branch for it.
      const rendered = new Set(
        Array.from(document.querySelectorAll("button[aria-label^='Use example ']")).map(
          (el) => (el.textContent || "").trim()
        )
      );
      const catalogue = Object.values(ACCEPTED_NOTATION_EXAMPLES);
      expect(rendered).toEqual(new Set(catalogue));
      for (const example of catalogue) {
        expect(classifyNotation(example).kind, `catalogue entry ${example} must parse`).not.toBe("unknown");
      }
    });

    it("fills the matching field and clears the competing one", async () => {
      renderPanel();

      const variantInput = screen.getByPlaceholderText("e.g. p.Gly380Arg") as HTMLInputElement;
      await act(async () => {
        fireEvent.change(variantInput, { target: { value: "p.Gly380Arg" } });
      });

      const genomicExample = screen.getByRole("button", { name: /Use example 20-23365054-G-A in the Genomic coords field/i });
      await act(async () => {
        fireEvent.click(genomicExample);
      });

      const genomicInput = screen.getByPlaceholderText("e.g. 20-23365054-G-A") as HTMLInputElement;
      expect(genomicInput.value).toBe("20-23365054-G-A");
      // The two notation fields are alternative routes, not additive inputs.
      expect(variantInput.value).toBe("");
      expect(useVariantAnalysisStore.getState().customVariant).toBe("");
    });

    it("fills a protein example into the variant field", async () => {
      renderPanel();

      const proteinExample = screen.getByRole("button", { name: /Use example p.Arg408Trp in the Variant notation field/i });
      await act(async () => {
        fireEvent.click(proteinExample);
      });

      expect((screen.getByPlaceholderText("e.g. p.Gly380Arg") as HTMLInputElement).value).toBe("p.Arg408Trp");
      expect(useVariantAnalysisStore.getState().customVariant).toBe("p.Arg408Trp");
    });
  });

  describe("workflow pipeline stage list", () => {
    const openPipeline = async () => {
      const pipelineTab = screen.getByRole("tab", { name: /Pipeline/i });
      await act(async () => {
        fireEvent.click(pipelineTab);
      });
    };

    it("renders every declared stage and derives its badge from the list", async () => {
      renderPanel();
      await openPipeline();

      // Derived, not a literal: "7/7 Complete" was hardcoded against a 7-element array, so an
      // eighth stage would still have reported seven of seven as complete.
      const expectedCount = WORKFLOW_STAGES.length;
      expect(screen.getByText(`${expectedCount} stages`)).toBeInTheDocument();

      for (const stage of WORKFLOW_STAGES) {
        expect(screen.getByText(stage.title)).toBeInTheDocument();
      }
    });

    it("distinguishes the stages by their own icon while they are idle", async () => {
      renderPanel();
      await openPipeline();

      // Previously all seven rows shared one grey Circle, so the list had no identity to scan by.
      const icons = document.querySelectorAll("#panel-pipeline svg.lucide-bar-chart-2, #panel-pipeline svg.lucide-layers");
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe("first-run benchmarks", () => {
    it("loads a complete, submittable query — gene, notation and accession — and clears coordinates", async () => {
      await act(async () => {
        useVariantAnalysisStore.setState({ customGenomic: "20-23365054-G-A" });
      });
      renderPanel();

      const preset = ONBOARDING_BENCHMARK_PRESETS[0];
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: new RegExp(`Load benchmark ${preset.gene}`) }));
      });

      const state = useVariantAnalysisStore.getState();
      expect(state.customGene).toBe(preset.gene);
      expect(state.customVariant).toBe(preset.variant);
      expect(state.customUniprot).toBe(preset.uniprotId);
      expect(state.customGenomic).toBe("");
    });

    it("is replaced by the recent-analyses tray once there is history", async () => {
      await act(async () => {
        useVariantAnalysisStore.setState({ history: [{ gene: "BRAF", variant: "p.V600E", uniprotId: "P15056" }] });
      });
      renderPanel();
      expect(screen.queryByRole("button", { name: /Load benchmark/ })).not.toBeInTheDocument();
    });
  });

  describe("history display", () => {
    it.each([
      ["p.ser489cys", "p.Ser489Cys"],
      ["p.ARG408TRP", "p.Arg408Trp"],
      ["p.Arg408Ter", "p.Arg408Ter"],
      ["p.V600E", "p.V600E"],
      ["c.1799T>A", "c.1799T>A"],
      ["20-23365054-G-A", "20-23365054-G-A"],
    ])("formats %s as %s without touching other notations", (input, expected) => {
      expect(formatVariantForDisplay(input)).toBe(expected);
    });
  });

  describe("pipeline progress", () => {
    it("shows a progress bar only once a run exists", async () => {
      renderPanel();
      const pipelineTab = screen.getByRole("tab", { name: /Pipeline/i });
      await act(async () => {
        fireEvent.click(pipelineTab);
      });
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

      await act(async () => {
        useVariantAnalysisStore.setState({ isBiophysicalLoading: true });
      });
      const bar = screen.getByRole("progressbar", { name: /Pipeline progress/i });
      expect(bar.getAttribute("aria-valuemax")).toBe(String(WORKFLOW_STAGES.length));
    });
  });
});

describe("VariantSearchPanel keyless-first", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("keeps Analyse available without a Gemini key and says what the key adds", () => {
    renderPanel();
    const analyse = screen.getByRole("button", { name: /^analyse variant$/i });
    expect(analyse).toHaveAttribute("type", "submit");
    expect(screen.queryByText(/add api key to analyse/i)).not.toBeInTheDocument();
    expect(screen.getByText(/rule-based classification work without Gemini/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^add a key$/i })).toBeInTheDocument();
  });
});


describe("UniProt disclosure focus", () => {
  it("focuses the field when opened and the persistent action when closed", () => {
    act(() => { useVariantAnalysisStore.setState({ customUniprot: "", analysisState: { isLoading: false, error: null, result: null } }); });
    renderPanel();
    const action = screen.getByRole('button', { name: 'Set UniProt accession' });
    const collapsed = screen.getByRole('button', { name: 'Resolved automatically' });
    collapsed.focus(); fireEvent.click(collapsed);
    const input = screen.getByLabelText('UniProt accession');
    expect(input).toHaveFocus();
    expect(action).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(input, { target: { value: 'Q9H8M5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide UniProt accession' }));
    expect(action).toHaveFocus();
    expect(action).toHaveAttribute('aria-expanded', 'false');
    const using = screen.getByRole('button', { name: 'Using Q9H8M5' });
    expect(using).not.toHaveAttribute('aria-label');
    fireEvent.click(using);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Q9H8M5');
  });
});
