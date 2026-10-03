// @vitest-environment jsdom
import React from "react";
import { render, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DevConsoleProvider, useDevConsole } from "../../../context/DevConsoleContext";
import { usePipelineTelemetry } from "../usePipelineTelemetry";
import type { DevConsoleState, TraceRunFinishStatus } from "../../../types/devConsole";

/**
 * The telemetry hook's own lifecycle.
 *
 * A run whose owner has unmounted has nobody left to finish it, so the hook cancels the run it was
 * holding — and the reducer's idempotence is what makes that safe: a run that already ended keeps its
 * verdict and its ending time, so the cleanup can never turn a real completion into "unfinished".
 */

/** Records the provider's CURRENT state on every render, so a test can read it after an update. */
function StateReader({ onState }: { onState: (state: DevConsoleState) => void }) {
  const { state } = useDevConsole();
  React.useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

function TelemetryUser({ finishOnMount }: { finishOnMount?: TraceRunFinishStatus }) {
  const { startPipelineTrace, finishPipelineTrace } = usePipelineTelemetry();
  React.useEffect(() => {
    const traceId = startPipelineTrace("TP53 R175H");
    if (finishOnMount) finishPipelineTrace(finishOnMount, traceId);
  }, [startPipelineTrace, finishPipelineTrace, finishOnMount]);
  return null;
}

function Host({
  live,
  onState,
  finishOnMount,
}: {
  live: boolean;
  onState: (state: DevConsoleState) => void;
  finishOnMount?: TraceRunFinishStatus;
}) {
  return (
    <>
      <StateReader onState={onState} />
      {live ? <TelemetryUser finishOnMount={finishOnMount} /> : null}
    </>
  );
}

describe("usePipelineTelemetry lifecycle", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("cancels the run it was holding when its owner unmounts", () => {
    const latest: { current: DevConsoleState | null } = { current: null };
    const onState = (state: DevConsoleState) => {
      latest.current = state;
    };

    const { rerender } = render(
      <DevConsoleProvider>
        <Host live onState={onState} />
      </DevConsoleProvider>
    );

    expect(latest.current?.traceRuns[0]?.status).toBe("running");

    // The owner goes away with its run still open.
    act(() => {
      rerender(
        <DevConsoleProvider>
          <Host live={false} onState={onState} />
        </DevConsoleProvider>
      );
    });

    const run = latest.current?.traceRuns[0];
    expect(run?.status).toBe("cancelled");
    // ...and it has an ending time, rather than staying at the 0 it started with.
    expect(run?.totalDurationMs).toBeGreaterThan(0);
  });

  it("does not overwrite a run that already finished", () => {
    const latest: { current: DevConsoleState | null } = { current: null };
    const onState = (state: DevConsoleState) => {
      latest.current = state;
    };

    const { rerender } = render(
      <DevConsoleProvider>
        <Host live onState={onState} finishOnMount="completed" />
      </DevConsoleProvider>
    );

    const endedAt = latest.current?.traceRuns[0]?.totalDurationMs;
    expect(latest.current?.traceRuns[0]?.status).toBe("completed");

    act(() => {
      rerender(
        <DevConsoleProvider>
          <Host live={false} onState={onState} finishOnMount="completed" />
        </DevConsoleProvider>
      );
    });

    // The unmount cleanup's cancellation is a no-op against a terminal run — status and ending time.
    expect(latest.current?.traceRuns[0]?.status).toBe("completed");
    expect(latest.current?.traceRuns[0]?.totalDurationMs).toBe(endedAt);
  });
});
