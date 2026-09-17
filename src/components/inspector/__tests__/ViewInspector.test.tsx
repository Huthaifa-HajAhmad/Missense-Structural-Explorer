// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ViewInspector from "../ViewInspector";
import { SettingsProvider } from "../../../context/SettingsContext";
import {
  INSPECTOR_FOCUS_EVENT,
  INSPECTOR_SECTIONS,
  requestInspectorFocus
} from "../../../lib/inspectorFocus";

/**
 * The inspector is the only consumer of the cross-pane focus channel, and the
 * collapsed state persists in localStorage — so the reveal path is the sole
 * mechanism that makes the relocated narrative reachable for a reader who
 * collapsed the panel earlier. It had no coverage at all.
 */

const ANALYSIS_RESULT = {
  metadata: {
    gene: "MACO1",
    variant: "p.Glu433Lys",
    wildType: "Glu",
    mutant: "Lys",
    residueIndex: 433
  },
  insights: { biochemicalShift: "Charge swap: Negative (Glu) to Positive (Lys)." }
} as any;

function renderInspector(overrides: Record<string, unknown> = {}) {
  const props = {
    activeView: "evidence" as const,
    onViewChange: vi.fn(),
    analysisResult: ANALYSIS_RESULT,
    isFolding: false,
    isBiophysicalLoading: false,
    isNarrativeLoading: false,
    gene: "MACO1",
    variant: "p.Glu433Lys",
    activeEvidenceTab: "structure",
    ...overrides
  };
  return render(
    <SettingsProvider>
      <ViewInspector {...(props as any)} />
    </SettingsProvider>
  );
}

describe("ViewInspector reveal path", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts collapsed when the stored preference says so", () => {
    localStorage.setItem("cs-inspector-collapsed", "true");
    renderInspector();
    expect(screen.getByLabelText("Collapsed Context Inspector")).toBeInTheDocument();
  });

  it("expands and focuses the requested section when collapsed", async () => {
    localStorage.setItem("cs-inspector-collapsed", "true");
    renderInspector();

    requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftNarrative);

    await waitFor(() =>
      expect(screen.getByLabelText("Context & Provenance Inspector")).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(document.activeElement?.id).toBe(INSPECTOR_SECTIONS.residueShiftNarrative)
    );
    // The reader's preference is persisted, so the panel does not re-collapse.
    expect(localStorage.getItem("cs-inspector-collapsed")).toBe("false");
  });

  it("reveals without needing a collapse transition when already expanded", async () => {
    renderInspector();
    requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftPocket);
    await waitFor(() => expect(document.activeElement?.id).toBe(INSPECTOR_SECTIONS.residueShiftPocket));
  });

  it("ignores an undeclared section id instead of retrying it", async () => {
    localStorage.setItem("cs-inspector-collapsed", "true");
    renderInspector();

    // Dispatched directly: `requestInspectorFocus` is typed to the declared union
    // precisely so this cannot be written by accident.
    window.dispatchEvent(
      new CustomEvent(INSPECTOR_FOCUS_EVENT, { detail: { sectionId: "inspector-typo" } })
    );

    // Give any (incorrect) retry loop time to run before asserting nothing happened.
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(screen.getByLabelText("Collapsed Context Inspector")).toBeInTheDocument();
    expect(localStorage.getItem("cs-inspector-collapsed")).not.toBe("false");
  });

  it("reports a declared section that never appears rather than failing silently", async () => {
    // "clinical" does not render the Residue Shifts pane, so its section ids are
    // never mounted. Exhausting the retries must be observable.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderInspector({ activeEvidenceTab: "clinical" });

    requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftNarrative);

    await waitFor(
      () => expect(warn).toHaveBeenCalledWith(expect.stringContaining("inspector-residue-shift-narrative")),
      { timeout: 2000 }
    );
    expect(warn.mock.calls[0][0]).toContain("never appeared");
  });

  it("survives unmounting with a reveal in flight", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { unmount } = renderInspector({ activeEvidenceTab: "clinical" });

    requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftNarrative);
    unmount();

    // The pending retry must be cancelled, not fired against a dead component.
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(warn).not.toHaveBeenCalled();
  });
});
