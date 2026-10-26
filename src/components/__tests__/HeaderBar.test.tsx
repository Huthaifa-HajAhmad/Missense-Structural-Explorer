// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HeaderBar from "../HeaderBar";
import { act } from "@testing-library/react";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { withVariantParams, isShareable } from "../../shared/shareLink";

/**
 * HeaderBar is deliberately prop-driven in tests: every case passes isDark/onToggleTheme so
 * the component never reaches for SettingsContext, which is what lets it render standalone.
 */
const base = {
  isOffline: false,
};

describe("HeaderBar Component Tests (C-7)", () => {
  it("should render correctly with default state", () => {
    render(
      <HeaderBar
        isOffline={false}
        isDark={false}
        onToggleTheme={() => {}}
        onOpenSettings={() => {}}
      />
    );
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("Computing…")).not.toBeInTheDocument();
    expect(screen.queryByText("Offline")).not.toBeInTheDocument();
    expect(document.querySelector(".cs-spinner")).toBeNull();
  });

  it("should display offline label when isOffline is true", () => {
    render(<HeaderBar {...base} isOffline={true} />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
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

  it("opens the palette in one click from every header", () => {
    const onOpenPalette = vi.fn();
    render(<HeaderBar {...base} onOpenPalette={onOpenPalette} />);
    const search = screen.getByRole("button", { name: /search views or run a variant/i });
    expect(search.textContent).toBe("");
    expect(search.querySelectorAll("svg")).toHaveLength(1);
    expect(search).toHaveAttribute("aria-keyshortcuts");
    expect(search.querySelector("kbd")).not.toBeInTheDocument();
    fireEvent.click(search);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  /* The sidebar marks the page and its H1 titles it; a breadcrumb was a third copy. */
  it("never repeats the page's name", () => {
    render(<HeaderBar {...base} />);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
  });

  it("should render onboarding tour button and trigger onOpenOnboarding when clicked", () => {
    const onOpenOnboarding = vi.fn();
    render(<HeaderBar {...base} onOpenOnboarding={onOpenOnboarding} />);
    const tourBtn = screen.getByRole("button", { name: /take the tour/i });
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

  it("offers Copy link only once a variant is loaded, and copies a link that reproduces it", async () => {
    act(() => useVariantAnalysisStore.setState({ gene: "", variant: "", uniprotId: "" } as any));
    const { rerender } = render(<HeaderBar {...base} />);
    expect(screen.queryByRole("button", { name: /copy link/i })).not.toBeInTheDocument();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    act(() => useVariantAnalysisStore.setState({ gene: "CNNM2", variant: "p.Ser489Cys", uniprotId: "Q9H8M5" } as any));
    rerender(<HeaderBar {...base} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy link to CNNM2 p\.Ser489Cys/i }));
    });
    const copied = new URL(writeText.mock.calls[0][0]);
    expect(copied.searchParams.get("gene")).toBe("CNNM2");
    expect(copied.searchParams.get("variant")).toBe("p.Ser489Cys");
    expect(copied.searchParams.get("uniprot")).toBe("Q9H8M5");
    expect(screen.getByRole("button", { name: /link copied/i })).toBeInTheDocument();
    act(() => useVariantAnalysisStore.setState({ gene: "", variant: "", uniprotId: "" } as any));
  });

  it("gives every icon action the same control geometry", () => {
    render(<HeaderBar {...base} onOpenOnboarding={() => {}} />);
    const names = [/take the tour/i, /switch to (light|dark) mode/i, /open settings/i];
    const classes = names.map(n => screen.getByRole("button", { name: n }).className.split(" ").filter(c => /^(w-|h-|rounded)/.test(c)).sort().join(" "));
    expect(new Set(classes).size).toBe(1);
  });

  it("renders navigation drawer toggle and reflects drawer state", () => {
    const onToggleNavDrawer = vi.fn();
    const { rerender } = render(
      <HeaderBar {...base} showNavToggle={true} navDrawerOpen={false} onToggleNavDrawer={onToggleNavDrawer} />
    );
    const toggleBtn = screen.getByRole("button", { name: /open navigation/i });
    expect(toggleBtn).toHaveAttribute("aria-expanded", "false");
    expect(toggleBtn).toHaveAttribute("aria-controls", "main-navigation");

    fireEvent.click(toggleBtn);
    expect(onToggleNavDrawer).toHaveBeenCalledTimes(1);

    rerender(<HeaderBar {...base} showNavToggle={true} navDrawerOpen={true} onToggleNavDrawer={onToggleNavDrawer} />);
    expect(screen.getByRole("button", { name: /open navigation/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("calls onDismissError when error dismiss button is clicked", () => {
    const onDismissError = vi.fn();
    render(<HeaderBar {...base} error="Network timeout" onDismissError={onDismissError} />);
    const dismissBtn = screen.getByRole("button", { name: /dismiss notice/i });
    expect(dismissBtn).toBeInTheDocument();
    fireEvent.click(dismissBtn);
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });
});

describe("shareLink", () => {
  it("sets, replaces and removes the variant parameters without touching others", () => {
    const out = new URL(withVariantParams("https://x.test/app?tab=1&uniprotId=OLD#h", { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "" }));
    expect(out.searchParams.get("gene")).toBe("PAH");
    expect(out.searchParams.get("variant")).toBe("p.Arg408Trp");
    expect(out.searchParams.has("uniprot")).toBe(false);
    expect(out.searchParams.has("uniprotId")).toBe(false);
    expect(out.searchParams.get("tab")).toBe("1");
    expect(out.hash).toBe("#h");
  });

  it("only calls a query shareable when it can be re-run", () => {
    expect(isShareable({ gene: "PAH", variant: "p.Arg408Trp" })).toBe(true);
    expect(isShareable({ gene: "PAH", variant: " " })).toBe(false);
  });
});
