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
      useVariantAnalysisStore.setState({
        customGene: "",
        customVariant: "",
        customUniprot: "",
        customGenomic: "",
        gene: "",
        variant: "",
        uniprotId: "",
        history: [],
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
});
