// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRetiredEvidenceTabRedirect } from "../useRetiredEvidenceTabRedirect";

describe("useRetiredEvidenceTabRedirect", () => {
  it("opens Energetics when the Evidence view is asked for the retired Structural perturbation tab", () => {
    const setTab = vi.fn(), setView = vi.fn();
    renderHook(() => useRetiredEvidenceTabRedirect("evidence", "perturbation", setTab, setView));
    expect(setView).toHaveBeenCalledWith("energetics");
    expect(setTab).toHaveBeenCalledWith("clinical");
  });

  it("does nothing for a live tab, or before the Evidence view is shown", () => {
    const setTab = vi.fn(), setView = vi.fn();
    renderHook(() => useRetiredEvidenceTabRedirect("evidence", "predictors", setTab, setView));
    renderHook(() => useRetiredEvidenceTabRedirect("search", "perturbation", setTab, setView));
    expect(setView).not.toHaveBeenCalled();
    expect(setTab).not.toHaveBeenCalled();
  });
});
