// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useProteinSequence } from "../useProteinSequence";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";

const mockFetchWithAuth = vi.fn();

vi.mock("../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: mockFetchWithAuth })
}));

describe("useProteinSequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVariantAnalysisStore.setState({
      proteinSequence: null
    });
  });

  it("returns empty sequence when accession is empty or null", () => {
    const { result } = renderHook(() => useProteinSequence(""));
    expect(result.current.sequence).toBe("");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  it("reports invalid identifier error for malformed accession", () => {
    const { result } = renderHook(() => useProteinSequence("not_an_accession!"));
    expect(result.current.sequence).toBe("");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe("Invalid UniProt ID identifier.");
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  it("serves cached sequence immediately from Zustand store without network fetch", () => {
    useVariantAnalysisStore.setState({
      proteinSequence: { accession: "P00441", sequence: "MATKAVCVLK" }
    });

    const { result } = renderHook(() => useProteinSequence("P00441"));
    expect(result.current.sequence).toBe("MATKAVCVLK");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  it("fetches sequence from API when not cached and publishes to store", async () => {
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ sequence: "MATKAVCVLKGDGPVQGIINFEQKESNGPVKVWGSIKGLTEGLHGFHVHEFGDNTAGCTSAGPHFNPLSRKHG" })
    });

    const { result } = renderHook(() => useProteinSequence("P00441"));
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sequence).toContain("MATKAVCVLK");
    expect(result.current.error).toBeNull();
    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      "/api/v1/sequence/P00441",
      expect.objectContaining({ timeout: 10000, signal: expect.any(AbortSignal) })
    );

    const storeCached = useVariantAnalysisStore.getState().proteinSequence;
    expect(storeCached?.accession).toBe("P00441");
    expect(storeCached?.sequence).toContain("MATKAVCVLK");
  });

  it("handles fetch failure gracefully and sets error state", async () => {
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error"
    });

    const { result } = renderHook(() => useProteinSequence("P00441"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.sequence).toBe("");
    expect(result.current.error).toBe("UniProt sequence data unavailable. Check network or server connection.");
  });

  it("aborts active controller on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetchWithAuth.mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
      capturedSignal = opts?.signal;
      return new Promise(() => {}); // never resolves
    });

    const { unmount } = renderHook(() => useProteinSequence("P00441"));
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
