// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OnboardingModal, { ONBOARDING_BENCHMARK_PRESETS, TOUR_STEPS } from "../OnboardingModal";
import { SettingsProvider } from "../../../context/SettingsContext";
import { VariantAnalysisProvider } from "../../../context/VariantAnalysisContext";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";

function renderOnboardingModal(props: Partial<React.ComponentProps<typeof OnboardingModal>> = {}) {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSelectPreset: vi.fn(),
    onOpenSettings: vi.fn(),
    ...props
  };

  return {
    ...render(
      <SettingsProvider>
        <VariantAnalysisProvider>
          <OnboardingModal {...defaultProps} />
        </VariantAnalysisProvider>
      </SettingsProvider>
    ),
    props: defaultProps
  };
}

describe("Interactive Onboarding Tour (Rare Disease Scope)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    act(() => {
      useVariantAnalysisStore.setState({
        customGene: "",
        customVariant: "",
        customUniprot: "",
        customGenomic: ""
      });
    });
  });

  it("should not render when isOpen is false", () => {
    renderOnboardingModal({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should render interactive tour spotlight and step 1 by default", () => {
    renderOnboardingModal({ isOpen: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("tour-spotlight-svg")).toBeInTheDocument();
    expect(screen.getByText("Workspace Orientation")).toBeInTheDocument();
    expect(screen.getByText("Zone 1 · Input")).toBeInTheDocument();
    expect(screen.getByText("Variant Query & Genomic Coordinates")).toBeInTheDocument();
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });

  it("should allow loading live sample PAH p.Arg408Trp into store on step 1", () => {
    renderOnboardingModal({ isOpen: true });

    const loadSampleBtn = screen.getByRole("button", { name: /Load Sample/i });
    expect(loadSampleBtn).toBeInTheDocument();

    fireEvent.click(loadSampleBtn);

    // Verifies button state feedback
    expect(screen.getByText("Loaded!")).toBeInTheDocument();

    // Verifies store was actually updated with rare disease PKU sample
    const state = useVariantAnalysisStore.getState();
    expect(state.customGene).toBe("PAH");
    expect(state.customVariant).toBe("p.Arg408Trp");
    expect(state.customUniprot).toBe("P00439");
  });

  it("should navigate through all 5 steps when clicking Next", () => {
    renderOnboardingModal({ isOpen: true });

    // Step 1 -> Step 2 (Multimodal Rail & 4 Zones)
    const nextBtn = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    expect(screen.getByText("Multimodal Analysis Rail & 4 Zones")).toBeInTheDocument();

    // Step 2 -> Step 3 (Sovereign Core)
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    expect(screen.getByText("Zero-Key Sovereign Biophysical Core")).toBeInTheDocument();
    expect(screen.getByText(/Sovereignty: 0 Tokens & 0 Billing Required/i)).toBeInTheDocument();

    // Step 3 -> Step 4 (API Gateway)
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    expect(screen.getByText("API Keys & Diagnostic AI Gateway")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Settings API Tab/i })).toBeInTheDocument();

    // Step 4 -> Step 5 (Rare Disease Landmark Controls)
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("5 / 5")).toBeInTheDocument();
    expect(screen.getByText("Curated Landmark Controls & Instant Launch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finish Tour/i })).toBeInTheDocument();
  });

  it("should navigate backward with previous step button", () => {
    renderOnboardingModal({ isOpen: true });

    // Advance to step 2
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText("2 / 5")).toBeInTheDocument();

    // Go back to step 1
    fireEvent.click(screen.getByRole("button", { name: /Previous step/i }));
    expect(screen.getByText("1 / 5")).toBeInTheDocument();
  });

  it("should trigger rare disease preset launch and close when selecting a benchmark variant on step 5", () => {
    const onSelectPreset = vi.fn();
    const onClose = vi.fn();
    renderOnboardingModal({ isOpen: true, onSelectPreset, onClose });

    // Navigate to step 5
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    }
    expect(screen.getByText("5 / 5")).toBeInTheDocument();

    // Select the PKU PAH control
    const pahBtn = screen.getByRole("button", { name: /PAH/i });
    fireEvent.click(pahBtn);

    expect(onSelectPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        gene: "PAH",
        variant: "p.Arg408Trp",
        uniprotId: "P00439",
        tag: "Inborn Error of Metabolism"
      })
    );
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem("cs-onboarding-completed-v1")).toBe("true");
  });

  it("should close and persist completion when clicking Close, Skip, or backdrop", () => {
    const onClose = vi.fn();
    renderOnboardingModal({ isOpen: true, onClose });

    const closeBtn = screen.getByRole("button", { name: /Close tour/i });
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem("cs-onboarding-completed-v1")).toBe("true");
  });

  it("should support keyboard navigation with ArrowRight, ArrowLeft, and Escape", () => {
    const onClose = vi.fn();
    renderOnboardingModal({ isOpen: true, onClose });

    // ArrowRight advances step
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 5")).toBeInTheDocument();

    // ArrowLeft goes back
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("1 / 5")).toBeInTheDocument();

    // Escape closes tour
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
