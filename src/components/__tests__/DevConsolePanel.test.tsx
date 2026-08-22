// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
              startTime: Date.now() - 20,
              offsetMs: 150,
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
});
