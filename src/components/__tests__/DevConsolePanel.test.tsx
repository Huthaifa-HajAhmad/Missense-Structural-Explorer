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

    expect(screen.getByText("Error Diagnostics")).toBeInTheDocument();
    expect(screen.getByText("Live Events")).toBeInTheDocument();
    expect(screen.getByText("Pipeline Waterfall")).toBeInTheDocument();
    expect(screen.getByText("Zero Active Errors")).toBeInTheDocument();
  });

  it("switches to Live Events stream and displays live empty state", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );

    const liveBtn = screen.getByText("Live Events");
    fireEvent.click(liveBtn);

    expect(screen.getByText("Live Log Stream Idle")).toBeInTheDocument();
  });

  it("switches to Pipeline Waterfall and displays trace run or empty state", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );

    const waterfallBtn = screen.getByText("Pipeline Waterfall");
    fireEvent.click(waterfallBtn);

    expect(screen.getByText(/Pipeline Stage \/ Operation|No Active Trace Recorded/i)).toBeInTheDocument();
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

    expect(screen.getByText("Overview & Payload")).toBeInTheDocument();
    expect(screen.getByText("Stack Trace")).toBeInTheDocument();
    expect(screen.getByText("HTTP Details")).toBeInTheDocument();
    expect(screen.getByText("Copy Report")).toBeInTheDocument();
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

    expect(screen.getByText("Stage 1: Genomic & cDNA Notation Translation")).toBeInTheDocument();
    expect(screen.getByText("Stage 2: Structural Retrieval & Cavity Detection")).toBeInTheDocument();
    expect(screen.getByText("Stage 3: Multi-Model Biophysics Suite")).toBeInTheDocument();
    expect(screen.getByText("Genomic & cDNA Notation Translation (VEP)")).toBeInTheDocument();
    expect(screen.getByText("PDB / AlphaFold 3D Coordinates Fetch")).toBeInTheDocument();
  });

  it("exposes stream switcher as a tablist and switches streams with arrow keys", () => {
    render(
      <DevConsoleProvider>
        <DevConsolePanel />
      </DevConsoleProvider>
    );

    const tablist = screen.getByRole("tablist", { name: /console streams/i });
    expect(tablist).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /error diagnostics/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.keyDown(tablist, { key: "ArrowRight" });

    expect(screen.getByRole("tab", { name: /live events/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("Live Log Stream Idle")).toBeInTheDocument();

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /error diagnostics/i })).toHaveAttribute(
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

    fireEvent.click(screen.getByText("Live Events"));
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
      name: /Stage 1: Genomic & cDNA Notation Translation/i
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
    expect(screen.getByText("Zero Active Errors")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Live Events"));
    expect(screen.getByText("Live Log Stream Idle")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Pipeline Waterfall"));
    expect(screen.getByText("No Active Trace Recorded")).toBeInTheDocument();
  });
});
