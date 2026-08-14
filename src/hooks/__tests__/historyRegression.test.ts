// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVariantSearch } from "../useVariantSearch";

describe("History Selection Regression Test", () => {
  it("should select a history item and trigger analysis without self-aborting", () => {
    const { result } = renderHook(() => useVariantSearch());

    const abortAllPendingRequests = vi.fn();
    const resetViewerState = vi.fn();
    const executeAnalysis = vi.fn();
    const setAnalysisState = vi.fn();

    const mockHistoryItem = {
      gene: "MECP2",
      variant: "p.Arg255Ter",
      uniprotId: "P51587"
    };

    act(() => {
      result.current.handleSelectHistoryItem(mockHistoryItem, {
        abortAllPendingRequests,
        resetViewerState,
        executeAnalysis,
        setAnalysisState
      });
    });

    expect(abortAllPendingRequests).toHaveBeenCalledTimes(1);
    expect(resetViewerState).toHaveBeenCalledTimes(1);
    expect(executeAnalysis).toHaveBeenCalledWith("MECP2", "p.Arg255Ter", "P51587");
    
    // Assert state values updated
    expect(result.current.gene).toBe("MECP2");
    expect(result.current.variant).toBe("p.Arg255Ter");
    expect(result.current.uniprotId).toBe("P51587");
  });
});
