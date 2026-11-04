// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsoleEntry } from "../../types/devConsole";
import ConsoleLogView from "../console/ConsoleLogView";

const entry = (over: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: "e1",
  timestamp: Date.now() - 3 * 60_000,
  level: "error",
  source: "biophysics",
  impact: "recoverable",
  message: "Progressive structural assessments failed",
  count: 1,
  ...over,
});

function renderView(entries: ConsoleEntry[]) {
  return render(
    <ConsoleLogView
      stream="error"
      allEntries={entries}
      entries={entries}
      searchQuery=""
      compact={false}
      pipelineProblems={0}
      onOpenWaterfall={() => {}}
      onResetFilters={() => {}}
    />
  );
}

describe("ConsoleLogView time column", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports when an error happened, not the wall clock it happened at", () => {
    const only = entry();
    renderView([only]);

    const stamp = screen.getByText("3m ago");
    expect(stamp).toHaveClass("cx-time");
    // The absolute moment stays one hover away for correlation with server logs.
    expect(stamp).toHaveAttribute("title", new Date(only.timestamp).toLocaleString());
  });

  it("ages a label in place without new events arriving", () => {
    vi.useFakeTimers();
    const only = entry({ timestamp: Date.now() - 60_000 });
    renderView([only]);
    expect(screen.getByText("1m ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("2m ago")).toBeInTheDocument();
  });

  it("keeps the exact clock and the relative age side by side in the inspector", () => {
    const only = entry();
    renderView([only]);

    fireEvent.click(screen.getByRole("button", { name: /Progressive structural assessments failed/ }));

    const aside = screen.getByRole("complementary", { name: "Entry detail inspector" });
    expect(aside).toHaveTextContent(/3m ago/);
    expect(aside).toHaveTextContent(
      new Date(only.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    );
  });
});
