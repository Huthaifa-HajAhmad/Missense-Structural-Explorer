// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OnboardingModal, { ONBOARDING_BENCHMARK_PRESETS } from "../OnboardingModal";
import { SettingsProvider } from "../../../context/SettingsContext";

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
        <OnboardingModal {...defaultProps} />
      </SettingsProvider>
    ),
    props: defaultProps
  };
}

describe("OnboardingModal Component Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("should not render when isOpen is false", () => {
    renderOnboardingModal({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("should render welcome step when open by default", () => {
    renderOnboardingModal({ isOpen: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Explore the Structural Impact of Human Missense Variants/i)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 5/i)).toBeInTheDocument();
  });

  it("should navigate through all 5 steps when clicking Next", () => {
    renderOnboardingModal({ isOpen: true });

    // Step 1 -> Step 2 (Workspace Zones)
    const nextBtn = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText(/Step 2 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Evidence & Modeling \(Multi-Modal Predictors\)/i)).toBeInTheDocument();

    // Step 2 -> Step 3 (Biophysics Core)
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Step 3 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Zero-Key Sovereign Core operates out of the box/i)).toBeInTheDocument();
    expect(screen.getByText(/Works With No Keys \(Free\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Enhanced With Keys/i)).toBeInTheDocument();

    // Step 3 -> Step 4 (API Keys Guide)
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Step 4 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Google Gemini API Key \(Recommended\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Safe Terminal Injection \(Typing Hidden\)/i)).toBeInTheDocument();

    // Step 4 -> Step 5 (Quick Start)
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(screen.getByText(/Step 5 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Start by launching one of our validated benchmark controls/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get Started/i })).toBeInTheDocument();
  });

  it("should allow navigating steps via the stepper tabs", () => {
    renderOnboardingModal({ isOpen: true });
    
    // Jump directly to API Keys step
    const keysTab = screen.getByRole("button", { name: /API Keys/i });
    fireEvent.click(keysTab);

    expect(screen.getByText(/Step 4 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/Google Gemini API Key \(Recommended\)/i)).toBeInTheDocument();
  });

  it("should trigger preset launch and close when selecting a benchmark variant on step 5", () => {
    const onSelectPreset = vi.fn();
    const onClose = vi.fn();
    renderOnboardingModal({ isOpen: true, onSelectPreset, onClose });

    // Jump to Step 5
    fireEvent.click(screen.getByRole("button", { name: /Quick Start/i }));
    
    // Click on BRAF V600E preset
    const brafBtn = screen.getByRole("button", { name: /BRAF/i });
    fireEvent.click(brafBtn);

    expect(onSelectPreset).toHaveBeenCalledWith(
      expect.objectContaining({
        gene: "BRAF",
        variant: "p.Val600Glu",
        uniprotId: "P15056"
      })
    );
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem("cs-onboarding-completed-v1")).toBe("true");
  });

  it("should close when clicking the close button", () => {
    const onClose = vi.fn();
    renderOnboardingModal({ isOpen: true, onClose });

    const closeBtn = screen.getByRole("button", { name: /Close guide/i });
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it("should support keyboard navigation with ArrowRight, ArrowLeft, and Escape", () => {
    const onClose = vi.fn();
    renderOnboardingModal({ isOpen: true, onClose });

    // ArrowRight advances step
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/Step 2 of 5/i)).toBeInTheDocument();

    // ArrowLeft goes back
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/Step 1 of 5/i)).toBeInTheDocument();

    // Escape closes modal
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("should persist dont show on startup checkbox into localStorage", () => {
    renderOnboardingModal({ isOpen: true });

    const checkbox = screen.getByRole("checkbox", { name: /Don't show on startup/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(localStorage.getItem("cs-onboarding-completed-v1")).toBe("true");

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(localStorage.getItem("cs-onboarding-completed-v1")).toBe("false");
  });
});
