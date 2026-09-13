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
});

