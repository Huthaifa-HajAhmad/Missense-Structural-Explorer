// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppEffects } from "../useAppEffects";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

/**
 * The ESMFold view starts folding by itself, once per variant. After a failed fold, its "Retry folding"
 * button must fold again. It used to run the structural refresh, which never folds anything, so the
 * reader's retry changed nothing on screen.
 */
const metadata = { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", residueIndex: 408, mutant: "Trp", sequence: "M".repeat(450), mutatedSequence: "W".repeat(450) };

function mount(fetchEsmFold: ReturnType<typeof vi.fn>) {
  renderHook(() => useAppEffects({
    masterView: "structure_esmfold" as any, setMasterView: vi.fn(), setActiveEvidenceTab: vi.fn(), setIsOffline: vi.fn(),
    fetchWithAuth: vi.fn(async () => new Response("{}")) as any, consoleDispatch: vi.fn(), executeAnalysis: vi.fn(),
    settings: { acmgWeighting: "standard" } as any, fetchEsmFold,
  } as any));
}

beforeEach(() => {
  useVariantAnalysisStore.setState({
    gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", esmFoldWtPdb: null, isEsmFolding: false, esmFoldingError: null,
    analysisState: { result: { metadata }, isLoading: false, error: null },
  } as any);
});

describe("retrying a failed ESMFold fold", () => {
  it("folds once on its own, and not again while the variant is unchanged", async () => {
    const fetchEsmFold = vi.fn();
    mount(fetchEsmFold);
    await vi.waitFor(() => expect(fetchEsmFold).toHaveBeenCalledTimes(1));
  });

  it("folds again after the reader asks for a retry", async () => {
    const fetchEsmFold = vi.fn();
    mount(fetchEsmFold);
    await vi.waitFor(() => expect(fetchEsmFold).toHaveBeenCalledTimes(1));
    act(() => useVariantAnalysisStore.setState({ esmFoldingError: "Engine unavailable" } as any));
    act(() => useVariantAnalysisStore.getState().requestEsmFoldRetry());
    expect(useVariantAnalysisStore.getState().esmFoldingError, "the retry clears the recorded failure").toBeNull();
    await vi.waitFor(() => expect(fetchEsmFold).toHaveBeenCalledTimes(2));
  });
});
