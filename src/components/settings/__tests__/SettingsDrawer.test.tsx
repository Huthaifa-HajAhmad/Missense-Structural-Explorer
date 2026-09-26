// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import SettingsDrawer from "../SettingsDrawer";
import { SettingsProvider, useSettings } from "../../../context/SettingsContext";

function renderDrawer() {
  function Opener() {
    const { openSettingsTab } = useSettings();
    return (
      <>
        <button onClick={() => openSettingsTab("appearance")}>open-settings</button>
        <SettingsDrawer />
      </>
    );
  }
  render(
    <SettingsProvider>
      <Opener />
    </SettingsProvider>
  );
}

describe("SettingsDrawer (settings revamp)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    })));
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
  });

  it("renders nothing until opened, then exposes a labelled dialog via portal", async () => {
    renderDrawer();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("open-settings"));
    await act(async () => {});

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Settings")).toBeInTheDocument();
    // Portalled straight to document.body, not inline.
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("locks body scroll while open and closes on Escape", async () => {
    renderDrawer();
    fireEvent.click(screen.getByText("open-settings"));
    await act(async () => {});
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 3000 });
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("exposes tablist/tab semantics and switches sections", async () => {
    renderDrawer();
    fireEvent.click(screen.getByText("open-settings"));
    await act(async () => {});

    const tablist = screen.getByRole("tablist", { name: /settings sections/i });
    expect(tablist).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /connections/i }));

    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", "settings-tab-connections");
    expect(screen.getByText(/application \/ lab api token/i)).toBeInTheDocument();
  });

  it("arrow keys move between sections", async () => {
    renderDrawer();
    fireEvent.click(screen.getByText("open-settings"));
    await act(async () => {});

    const firstTab = screen.getByRole("tab", { name: /appearance/i });
    await waitFor(() => expect(firstTab).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("tablist", { name: /settings sections/i }), {
      key: "ArrowDown"
    });

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /viewport/i })).toHaveFocus()
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "settings-tab-viewport");
  });

  it("requires a second click to confirm reset (no window.confirm)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    localStorage.setItem("missenseUserSettings", JSON.stringify({ residueColor: "#101010" }));
    renderDrawer();
    fireEvent.click(screen.getByText("open-settings"));
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /reset defaults/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /confirm reset/i })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("missenseUserSettings") || "{}").residueColor).toBe("#101010");

    fireEvent.click(screen.getByRole("button", { name: /confirm reset/i }));
    expect(JSON.parse(localStorage.getItem("missenseUserSettings") || "{}").residueColor).toBe(
      "#F97316"
    );
    confirmSpy.mockRestore();
  });

  it("deep-links legacy 'api' callers onto the Connections section", async () => {
    function LegacyOpener() {
      const { openSettingsTab } = useSettings();
      return (
        <>
          <button onClick={() => openSettingsTab("api")}>legacy-open</button>
          <SettingsDrawer />
        </>
      );
    }
    render(
      <SettingsProvider>
        <LegacyOpener />
      </SettingsProvider>
    );

    fireEvent.click(screen.getByText("legacy-open"));
    await act(async () => {});

    expect(screen.getByRole("tab", { name: /connections/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/application \/ lab api token/i)).toBeInTheDocument();
  });

  it("deep-links legacy 'about' callers onto the Data & storage section", async () => {
    function AboutOpener() {
      const { openSettingsTab } = useSettings();
      return (
        <>
          <button onClick={() => openSettingsTab("about")}>open-about</button>
          <SettingsDrawer />
        </>
      );
    }
    render(
      <SettingsProvider>
        <AboutOpener />
      </SettingsProvider>
    );

    fireEvent.click(screen.getByText("open-about"));
    await act(async () => {});

    expect(screen.getByRole("tab", { name: /data & storage/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/settings backup/i)).toBeInTheDocument();
    expect(screen.getByText(/local storage & privacy/i)).toBeInTheDocument();
  });

  it("filters settings in real time via search input and allows configuration", async () => {
    renderDrawer();
    fireEvent.click(screen.getByText("open-settings"));
    await act(async () => {});

    const searchInput = screen.getByPlaceholderText(/search settings/i);
    fireEvent.change(searchInput, { target: { value: "polar" } });

    expect(screen.getByText(/polar contacts & hydrogen bonds/i)).toBeInTheDocument();
    const configBtn = screen.getByRole("button", { name: /configure/i });
    fireEvent.click(configBtn);

    expect(screen.getByRole("tab", { name: /viewport/i })).toHaveAttribute("aria-selected", "true");
  });
});
