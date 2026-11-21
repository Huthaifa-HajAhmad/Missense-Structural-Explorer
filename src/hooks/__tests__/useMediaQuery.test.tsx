// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "../useMediaQuery";

afterEach(() => vi.unstubAllGlobals());

describe("useMediaQuery", () => {
  it("reports the query now and follows later changes", () => {
    let listener: ((e: { matches: boolean }) => void) | undefined;
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      addEventListener: (_: string, fn: typeof listener) => { listener = fn; },
      removeEventListener: () => {}
    })));
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);

    act(() => listener?.({ matches: true }));
    expect(result.current).toBe(true);
  });
});
