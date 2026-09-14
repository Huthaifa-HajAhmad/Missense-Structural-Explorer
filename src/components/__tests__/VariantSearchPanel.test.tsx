// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VariantSearchPanel from "../VariantSearchPanel";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { SettingsProvider } from "../../context/SettingsContext";

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
    const uniprotInput = screen.getByPlaceholderText("e.g. Q9H8M5 (Auto-resolved if omitted)") as HTMLInputElement;

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
    expect(screen.getByText("Service & Engine Telemetry")).toBeInTheDocument();
    expect(screen.getByText("Ensembl VEP")).toBeInTheDocument();
    expect(screen.getByText("FoldX Engine")).toBeInTheDocument();
    expect(screen.getByText("P2Rank Pocket Engine")).toBeInTheDocument();

    // Click on Workflow Pipeline tab
    const pipelineTabBtn = screen.getByRole("tab", { name: /Workflow Pipeline/i });
    await act(async () => {
      fireEvent.click(pipelineTabBtn);
    });

    // Verify Workflow Pipeline view is now active
    expect(screen.getByText("Evidence Pipeline")).toBeInTheDocument();
    expect(screen.getByText("3D Structure")).toBeInTheDocument();

    // Click back to Service Telemetry
    const telemetryTabBtn = screen.getByRole("tab", { name: /Service Telemetry/i });
    await act(async () => {
      fireEvent.click(telemetryTabBtn);
    });
    expect(screen.getByText("Service & Engine Telemetry")).toBeInTheDocument();
  });

  it("auto-switches to Workflow Pipeline tab when isPipelineActive becomes true", async () => {
    renderPanel();

    // Starts in Telemetry
    expect(screen.getByText("Service & Engine Telemetry")).toBeInTheDocument();

    // Trigger pipeline active state in store
    await act(async () => {
      useVariantAnalysisStore.setState({ isBiophysicalLoading: true });
    });

    // Verify it automatically switched to Workflow Pipeline
    expect(screen.getByText("Evidence Pipeline")).toBeInTheDocument();
  });

  it("auto-switches to Workflow Pipeline tab when search form is submitted", async () => {
    renderPanel();

    // Starts in Telemetry
    expect(screen.getByText("Service & Engine Telemetry")).toBeInTheDocument();

    const geneInput = screen.getByPlaceholderText("e.g. CNNM2");
    const form = geneInput.closest("form");
    expect(form).not.toBeNull();

    await act(async () => {
      fireEvent.submit(form!);
    });

    // Verify submit triggers switch to Workflow Pipeline
    expect(screen.getByText("Evidence Pipeline")).toBeInTheDocument();
  });

  it("renders zero-history placeholder when search history is empty", () => {
    renderPanel();

    expect(screen.getByText("No Recent Variant Analyses")).toBeInTheDocument();
    expect(screen.getByText(/Analyzed variants in this session will appear here/i)).toBeInTheDocument();
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
    expect(screen.getByText("Recent Analyses (1)")).toBeInTheDocument();
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
    expect(screen.getByText("No Recent Variant Analyses")).toBeInTheDocument();
  });

  it("applies cs-tab-transition animation to tab panels", async () => {
    renderPanel();

    const telemetryPanel = screen.getByRole("tabpanel");
    expect(telemetryPanel.className).toContain("cs-tab-transition");

    const pipelineTab = screen.getByRole("tab", { name: /Workflow Pipeline/i });
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
    const pipelineTab = screen.getByRole("tab", { name: /Workflow Pipeline/i });
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

  it("renders ready status badge on the far right of tab switcher and avoids excessive version or settings icon pills", async () => {
    renderPanel();

    // Verify Pre-flight Ready is present on the tab switcher header for Telemetry
    expect(screen.getByText("Pre-flight Ready")).toBeInTheDocument();
    expect(screen.queryByText("v1.0.0-dev")).not.toBeInTheDocument();

    // Switch to Workflow Pipeline tab
    const pipelineTab = screen.getByRole("tab", { name: /Workflow Pipeline/i });
    await act(async () => {
      fireEvent.click(pipelineTab);
    });

    // Verify Pipeline Ready is displayed on the tab switcher header for Pipeline
    expect(screen.getByText("Pipeline Ready")).toBeInTheDocument();

    // Verify service cards do not render redundant inline settings pills
    expect(screen.queryByTitle(/Configure FoldX Engine settings/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Configure Gemini Clinical AI settings/i)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Configure P2Rank Pocket Engine settings/i)).not.toBeInTheDocument();
  });

  it("displays Key Ready for AlphaGenome Atlas when configured in client settings", async () => {
    sessionStorage.setItem("missenseTransientCredentials", JSON.stringify({ alphagenomeApiKey: "ag-secret-key-xyz" }));

    renderPanel();

    expect(screen.getByText("AlphaGenome Atlas")).toBeInTheDocument();
    expect(await screen.findByText(/key ready/i)).toBeInTheDocument();

    sessionStorage.removeItem("missenseTransientCredentials");
  });
});

