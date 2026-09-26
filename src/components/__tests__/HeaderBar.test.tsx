// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HeaderBar from "../HeaderBar";

/**
 * HeaderBar is deliberately prop-driven in tests: every case passes isDark/onToggleTheme so
 * the component never reaches for SettingsContext, which is what lets it render standalone.
 */
const base = {
  masterView: "evidence" as const,
  isBiophysicalLoading: false,
  isOffline: false,
};

describe("HeaderBar Component Tests (C-7)", () => {
  it("should render correctly with default state", () => {
    render(
      <HeaderBar
        masterView="search"
        isBiophysicalLoading={false}
        isOffline={false}
        isDark={false}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
      />
    );
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Computing…")).not.toBeInTheDocument();
    expect(screen.queryByText("OFFLINE")).not.toBeInTheDocument();
  });

  it("should display breadcrumb title when not on search view", () => {
    render(<HeaderBar {...base} />);
    expect(screen.getByText("Evidence")).toBeInTheDocument();
  });

  it("should render computing status when isBiophysicalLoading is true", () => {
    render(<HeaderBar {...base} isBiophysicalLoading={true} />);
    expect(screen.getByText(/Computing/i)).toBeInTheDocument();
  });

  it("should display offline label when isOffline is true", () => {
    render(<HeaderBar {...base} isOffline={true} />);
    expect(screen.getByText("OFFLINE")).toBeInTheDocument();
  });

  it("should display integrated error alert in header when error prop is provided", () => {
    render(<HeaderBar {...base} error="Unauthorized: API Key Missing" />);
    expect(screen.getByText(/Unauthorized: API Key Missing/i)).toBeInTheDocument();
  });

  it("should render theme toggle and settings actions in the header", () => {
    render(<HeaderBar {...base} />);
    expect(screen.getByRole("button", { name: /switch to (light|dark) mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open settings/i })).toBeInTheDocument();
  });

  it("should reflect the dark theme state on the toggle", () => {
    const { rerender } = render(<HeaderBar {...base} isDark={false} onToggleTheme={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
    rerender(<HeaderBar {...base} isDark={true} onToggleTheme={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
  });

  /* The chip is the only surviving entry point to the quick-query surface, and it is the
     one thing in the header whose handler lives in another component — so its wiring is
     asserted rather than assumed. */
  it("should expose a command palette trigger that calls onOpenPalette", () => {
    const onOpenPalette = vi.fn();
    render(<HeaderBar {...base} onOpenPalette={onOpenPalette} />);
    const chip = screen.getByRole("button", { name: /open command palette/i });
    expect(chip).toHaveTextContent(/^(⌘K|Ctrl K)$/);
    fireEvent.click(chip);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("should render onboarding tour button and trigger onOpenOnboarding when clicked", () => {
    const onOpenOnboarding = vi.fn();
    render(<HeaderBar {...base} onOpenOnboarding={onOpenOnboarding} />);
    const tourBtn = screen.getByRole("button", { name: /open workspace guide & tour/i });
    expect(tourBtn).toBeInTheDocument();
    fireEvent.click(tourBtn);
    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
  });

  /* Removed with the QueryStrip dropdown: the header must not resurrect a second,
     off-theme way to enter a variant. */
  it("should not render a quick-search dropdown trigger", () => {
    render(<HeaderBar {...base} />);
    expect(screen.queryByRole("button", { name: /quick search/i })).not.toBeInTheDocument();
  });
});
