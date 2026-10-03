// @vitest-environment jsdom
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { DevConsoleProvider, useDevConsole } from "../DevConsoleContext";

const wrapper = ({ children }: { children: React.ReactNode }) => <DevConsoleProvider>{children}</DevConsoleProvider>;

/** Pushes an entry WITHOUT an explicit impact, so the context's own classifier decides. */
function classify(entry: Parameters<ReturnType<typeof useDevConsole>["pushErrorEntry"]>[0]) {
  const { result } = renderHook(() => useDevConsole(), { wrapper });
  act(() => result.current.pushErrorEntry(entry));
  return result.current.state.errorState.entries[0]?.impact;
}

describe("impact classification", () => {
  beforeEach(() => sessionStorage.clear());

  it("never calls a biophysics failure fatal — including an HTTP 500 from its endpoint", () => {
    expect(classify({ level: "error", source: "biophysics", message: "FoldX calculation failed" })).toBe("degraded");
    expect(
      classify({ level: "error", source: "biophysics", message: "engine error", httpMeta: { status: 500 } })
    ).toBe("degraded");
  });

  it("still calls runtime exceptions and server 500s from other subsystems fatal", () => {
    expect(classify({ level: "error", source: "runtime", message: "TypeError" })).toBe("fatal");
    expect(classify({ level: "error", source: "network", message: "boom", httpMeta: { status: 500 } })).toBe("fatal");
  });

  it("keeps rate limits recoverable", () => {
    expect(classify({ level: "warn", source: "network", message: "slow down", httpMeta: { status: 429 } })).toBe("recoverable");
  });
});
