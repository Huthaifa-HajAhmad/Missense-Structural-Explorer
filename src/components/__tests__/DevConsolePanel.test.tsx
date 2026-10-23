// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { DevConsoleProvider, useDevConsole } from "../../context/DevConsoleContext";
import DevConsolePanel from "../DevConsolePanel";

function TestConsoleHarness({ onMount }: { onMount?: (actions: ReturnType<typeof useDevConsole>) => void }) {
  const context = useDevConsole();
  const onMountRef = React.useRef(onMount);
  onMountRef.current = onMount;
  const contextRef = React.useRef(context);
  contextRef.current = context;

  React.useEffect(() => {
    if (onMountRef.current) {
      onMountRef.current(contextRef.current);
    }
  }, []);

  return <DevConsolePanel />;
}

describe("DevConsolePanel & DevConsoleContext Tests", () => {
  // The provider persists entries/traces to sessionStorage and restores them
  // on mount — without this reset, state leaks between tests in this file
  // and count-based assertions become order- and timing-dependent.
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("renders with zero error empty state by default", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );

    expect(screen.getByRole("tab", { name: /errors/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /live events/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /waterfall/i })).toBeInTheDocument();
    expect(screen.getByText("No errors captured")).toBeInTheDocument();
  });

  it("switches to Live Events stream and displays live empty state", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );

    const liveBtn = screen.getByRole("tab", { name: /live events/i });
    fireEvent.click(liveBtn);

    expect(screen.getByText("No live events yet")).toBeInTheDocument();
  });

  it("switches to Pipeline Waterfall and displays trace run or empty state", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );

    const waterfallBtn = screen.getByRole("tab", { name: /waterfall/i });
    fireEvent.click(waterfallBtn);

    expect(screen.getByText(/No trace recorded yet/i)).toBeInTheDocument();
  });

  it("captures errors, displays impact badges, and opens diagnostic inspector", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ pushErrorEntry }) => {
            pushErrorEntry({
              level: "error",
              source: "biophysics",
              impact: "fatal",
              message: "FoldX calculation failed: Invalid PDB backbone coordinates",
              detail: "Error at line 42: PDB format mismatch in atom records\n    at foldxService.ts:120",
              httpMeta: {
                url: "/api/v1/generate-mutant",
                method: "POST",
                status: 500,
                statusText: "Internal Server Error",
                durationMs: 420,
                responseBody: { error: "PDB format mismatch", code: "FOLDX_ATOM_ERR" },
              },
            });
          }}
        />
      </DevConsoleProvider>
    );

    expect(screen.getByText(/FoldX calculation failed/i)).toBeInTheDocument();
    expect(screen.getAllByText(/FATAL/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/\[biophysics\]/i)).toBeInTheDocument();

    // Click entry to open diagnostic drawer
    const entryButton = screen.getByText(/FoldX calculation failed/i);
    fireEvent.click(entryButton);

    const inspector = screen.getByRole("complementary", { name: /entry detail inspector/i });
    expect(inspector).toBeInTheDocument();
    expect(screen.getByText("HTTP exchange")).toBeInTheDocument();
    expect(screen.getByText("Stack trace / detail")).toBeInTheDocument();
    expect(screen.getByText("Response body")).toBeInTheDocument();
    expect(screen.getByText("Copy Report")).toBeInTheDocument();

    // Escape closes the inspector.
    fireEvent.keyDown(inspector, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: /entry detail inspector/i })).not.toBeInTheDocument();
  });

  it("renders pipeline Gantt waterfall with parallel spans and stage headers", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ startTraceRun, addTraceSpan, finishTraceRun, dispatch }) => {
            const traceId = startTraceRun("TP53 R175H");
            addTraceSpan({
              traceId,
              name: "Genomic & cDNA Notation Translation (VEP)",
              stage: "genomics",
              startTime: Date.now() - 100,
              offsetMs: 0,
              durationMs: 120,
              status: "success",
            });
            addTraceSpan({
              traceId,
              name: "PDB / AlphaFold 3D Coordinates Fetch",
              stage: "structure",
              startTime: Date.now() - 50,
              offsetMs: 120,
              durationMs: 340,
              status: "success",
            });
            addTraceSpan({
              traceId,
              name: "Multi-Model Biophysics Suite (ESM-2, SaProt, ClinVar, gnomAD)",
              stage: "biophysics",
              offsetMs: 150,
              startTime: Date.now() - 20,
              durationMs: 850,
              status: "success",
            });
            finishTraceRun(traceId, "completed");
            dispatch({ type: "SET_ACTIVE_TAB", tab: "tracing" });
          }}
        />
      </DevConsoleProvider>
    );

    expect(screen.getByText(/Stage 1: Genomic & cDNA notation/)).toBeInTheDocument();
    expect(screen.getByText(/Stage 2: Structure retrieval & cavities/)).toBeInTheDocument();
    expect(screen.getByText(/Stage 3: Multi-model biophysics/)).toBeInTheDocument();
    expect(screen.getByText("Genomic & cDNA Notation Translation (VEP)")).toBeInTheDocument();
    expect(screen.getByText("PDB / AlphaFold 3D Coordinates Fetch")).toBeInTheDocument();
  });

  it("shows unavailable spans as warnings, and points the empty Errors tab at pipeline problems", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ startTraceRun, addTraceSpan, finishTraceRun }) => {
            const traceId = startTraceRun("TP53 R175H");
            addTraceSpan({
              traceId,
              name: "DDMUT Biophysical Job Execution",
              stage: "biophysics",
              startTime: Date.now() - 400,
              offsetMs: 0,
              durationMs: 400,
              status: "unavailable",
            });
            addTraceSpan({
              traceId,
              name: "DYNAMUT2 Biophysical Job Execution",
              stage: "biophysics",
              startTime: Date.now() - 400,
              offsetMs: 0,
              durationMs: 300,
              status: "failed",
              error: "HTTP 502",
            });
            finishTraceRun(traceId);
          }}
        />
      </DevConsoleProvider>
    );

    // The error stream is empty, but the panel must not claim everything is fine.
    expect(screen.getByText("No errors captured")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2 pipeline operations failed or unavailable/i }));

    expect(screen.getByRole("button", { name: /DDMUT Biophysical Job Execution.*unavailable/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /DYNAMUT2 Biophysical Job Execution.*failed/i })).toBeInTheDocument();
  });

  it("impact tiles count each entry once and toggle the impact filter", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ pushErrorEntry }) => {
            pushErrorEntry({ level: "error", source: "runtime", impact: "fatal", message: "Fatal one" });
            pushErrorEntry({ level: "warn", source: "system", impact: "degraded", message: "Degraded one" });
            pushErrorEntry({ level: "warn", source: "network", impact: "recoverable", message: "Retried one" });
          }}
        />
      </DevConsoleProvider>
    );

    const fatalTile = screen.getByRole("button", { name: /fatal: 1/i });
    expect(screen.getByRole("button", { name: /degraded: 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /recoverable: 1/i })).toBeInTheDocument();

    fireEvent.click(fatalTile);
    expect(fatalTile).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Fatal one")).toBeInTheDocument();
    expect(screen.queryByText("Degraded one")).not.toBeInTheDocument();
  });

  it("announces paused capture instead of silently dropping events", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /pause error capture/i }));
    expect(screen.getByRole("status")).toHaveTextContent(/capture paused/i);
    fireEvent.click(screen.getByRole("button", { name: /^resume$/i }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("exposes stream switcher as a tablist and switches streams with arrow keys", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );

    const tablist = screen.getByRole("tablist", { name: /console streams/i });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /errors/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.keyDown(tablist, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: /live events/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("No live events yet")).toBeInTheDocument();

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /errors/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("marks level filter pills as pressed and shows entry counts", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ pushErrorEntry }) => {
            pushErrorEntry({ level: "error", source: "runtime", message: "One" });
            pushErrorEntry({ level: "error", source: "runtime", message: "Two" });
            pushErrorEntry({ level: "warn", source: "system", message: "Three" });
          }}
        />
      </DevConsoleProvider>
    );

    const errorPill = screen.getByRole("button", { name: /error 2/i });
    expect(errorPill).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(errorPill);
    expect(errorPill).toHaveAttribute("aria-pressed", "true");
  });

  it("supports arrow-key navigation through log entries", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ pushLiveEntry }) => {
            pushLiveEntry({ level: "info", source: "network", message: "First entry" });
            pushLiveEntry({ level: "info", source: "network", message: "Second entry" });
          }}
        />
      </DevConsoleProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /live events/i }));
    const log = screen.getByRole("log");
    const entries = screen.getAllByRole("button").filter((b) => b.className.includes("dev-console-entry"));
    expect(entries.length).toBe(2);

    // Entries render newest-first: row 0 is "Second entry", row 1 is "First entry".
    entries[0].focus();
    fireEvent.keyDown(log, { key: "ArrowDown" });
    expect(entries[1]).toHaveFocus();

    fireEvent.keyDown(log, { key: "ArrowUp" });
    expect(entries[0]).toHaveFocus();
  });

  it("exposes Gantt span rows as keyboard-activatable buttons and stages collapse", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ startTraceRun, addTraceSpan, finishTraceRun, dispatch }) => {
            const traceId = startTraceRun("TP53 R175H");
            addTraceSpan({
              traceId,
              name: "Genomic & cDNA Notation Translation (VEP)",
              stage: "genomics",
              startTime: Date.now() - 100,
              offsetMs: 0,
              durationMs: 120,
              status: "success",
            });
            finishTraceRun(traceId, "completed");
            dispatch({ type: "SET_ACTIVE_TAB", tab: "tracing" });
          }}
        />
      </DevConsoleProvider>
    );

    const spanRow = screen.getByRole("button", {
      name: /Genomic & cDNA Notation Translation \(VEP\), genomics stage, 120 milliseconds/i
    });
    expect(spanRow).toBeInTheDocument();

    fireEvent.click(spanRow);
    expect(screen.getByText(/from pipeline initiation/i)).toBeInTheDocument();

    const stageHeader = screen.getByRole("button", {
      name: /Stage 1: Genomic & cDNA notation/i
    });
    expect(stageHeader).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(stageHeader);
    expect(
      screen.queryByRole("button", {
        name: /Genomic & cDNA Notation Translation \(VEP\), genomics stage/i
      })
    ).not.toBeInTheDocument();
  });

  it("clear all purges both log streams and traces behind a two-step confirm", () => {
    render(
      <DevConsoleProvider>
        <TestConsoleHarness
          onMount={({ pushErrorEntry, pushLiveEntry, startTraceRun, addTraceSpan, finishTraceRun }) => {
            pushErrorEntry({ level: "error", source: "runtime", impact: "fatal", message: "Boom" });
            pushLiveEntry({ level: "info", source: "network", message: "Call finished" });
            const traceId = startTraceRun("TP53 R175H");
            addTraceSpan({
              traceId,
              name: "Genomic & cDNA Notation Translation (VEP)",
              stage: "genomics",
              startTime: Date.now() - 100,
              offsetMs: 0,
              durationMs: 120,
              status: "success",
            });
            finishTraceRun(traceId, "completed");
          }}
        />
      </DevConsoleProvider>
    );

    expect(screen.getByText(/Boom/i)).toBeInTheDocument();

    const clearAll = screen.getByRole("button", { name: /clear all console data/i });

    // First click only arms the confirmation.
    fireEvent.click(clearAll);
    expect(screen.getByRole("button", { name: /confirm clear all/i })).toBeInTheDocument();
    expect(screen.getByText(/Boom/i)).toBeInTheDocument();

    // Second click purges everything.
    fireEvent.click(screen.getByRole("button", { name: /confirm clear all/i }));
    expect(screen.getByText("No errors captured")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /live events/i }));
    expect(screen.getByText("No live events yet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /waterfall/i }));
    expect(screen.getByText("No trace recorded yet")).toBeInTheDocument();
  });
});

describe("Console page structure", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("titles the page, then the stream panel, without skipping a heading level", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Console" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Console streams" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Console streams" })).toBeInTheDocument();
    // The metrics belong to the selected stream, so they live inside its tab panel.
    expect(screen.getByRole("tabpanel")).toContainElement(screen.getByRole("region", { name: "Console metrics" }));
  });

  it("routes '/' to the filter field even from the page heading's actions", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );
    const clearAll = screen.getByRole("button", { name: /clear all console data/i });
    clearAll.focus();
    fireEvent.keyDown(clearAll, { key: "/" });
    expect(screen.getByRole("textbox", { name: /search error entries/i })).toHaveFocus();
  });
});
