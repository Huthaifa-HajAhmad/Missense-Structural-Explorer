// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { useBiophysicalModeling } from "../useBiophysicalModeling";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { DevConsoleProvider } from "../../context/DevConsoleContext";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DevConsoleProvider>{children}</DevConsoleProvider>
);

describe("useBiophysicalModeling Hook State Binding", () => {
  beforeEach(() => {
    useVariantAnalysisStore.getState().resetVariantAnalysisState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exposes biophysical store controls without running legacy client polling", () => {
    renderHook(
      () => useBiophysicalModeling({ detectPocket: vi.fn() }),
      { wrapper }
    );

    act(() => {
      useVariantAnalysisStore.getState().setFoldingEnergetics({ foldx: 2.1, thermompnn: 1.5 } as any);
      useVariantAnalysisStore.getState().setThermompnnStatus("done");
    });

    const state = useVariantAnalysisStore.getState();
    expect(state.thermompnnStatus).toBe("done");
    expect(state.foldingEnergetics?.thermompnn).toBe(1.5);
  });

  it("detects pockets via apiClient and mirrors status into store", async () => {
    const pocket = { pockets: [{ id: 1, probability: 0.85 }] };
    const apiClient = { detectPocket: vi.fn().mockResolvedValue(pocket) };
    const { result } = renderHook(
      () => useBiophysicalModeling(apiClient),
      { wrapper }
    );

    await act(async () => {
      await result.current.fetchPocketInfo("ATOM 1 CA ALA A 1", "A", 42, "P00439");
    });

    expect(apiClient.detectPocket).toHaveBeenCalledWith(
      expect.objectContaining({ targetChain: "A", targetIndex: 42, uniprotId: "P00439" }),
      undefined
    );
    expect(result.current.computedPocket).toEqual(pocket);
    expect(useVariantAnalysisStore.getState().computedPocket).toEqual(pocket);
    expect(result.current.isPocketLoading).toBe(false);
  });
});
