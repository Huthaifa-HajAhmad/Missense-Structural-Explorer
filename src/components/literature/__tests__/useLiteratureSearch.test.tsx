// @vitest-environment jsdom
/**
 * useLiteratureSearch.test.tsx — the request rules of the Literature tab, tested without its screen.
 *
 * The hook decides which search runs and which answer is allowed onto the screen. Its mistakes are
 * silent: a duplicated search looks like a slow one, and a slow old answer overwriting a newer one
 * looks like a wrong list. The API client is mocked so each test controls when every reply arrives.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";

const hoisted = vi.hoisted(() => {
  const getLiterature = vi.fn();
  return { getLiterature, client: { apiClient: { getLiterature } } };
});
vi.mock("../../../apiClient", () => ({ useApiClient: () => hoisted.client }));

import { useLiteratureSearch, type UseLiteratureSearchOptions } from "../useLiteratureSearch";

const paper = (id: string) => ({ id, title: `Paper ${id}`, abstract: "", authors: "A", journal: "J", year: 2026 });
const reply = (ids: string[]) => ({ gene: "NAE1", citations: ids.map(paper), hitCount: ids.length, degraded: false, pageSize: 25 });

const base: UseLiteratureSearchOptions = {
  gene: "NAE1",
  variant: "",
  uniprotId: "",
  searchQuery: "",
  searchVersion: 0,
  variantQuery: null,
  onResetFilters: () => {},
};

/** A reply the test settles by hand, so it can decide which request finishes first. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  hoisted.getLiterature.mockReset();
});

describe("useLiteratureSearch", () => {
  it("runs one search for a query it executed itself, not a second when the shared query echoes back", async () => {
    hoisted.getLiterature.mockResolvedValue(reply(["1"]));
    const onSearchQueryChange = vi.fn();
    const { result, rerender } = renderHook((props: UseLiteratureSearchOptions) => useLiteratureSearch(props), {
      initialProps: { ...base, onSearchQueryChange },
    });
    await waitFor(() => expect(result.current.citations).toHaveLength(1));
    expect(hoisted.getLiterature).toHaveBeenCalledTimes(1);

    act(() => result.current.runSearch(false, "NAE1 AND neddylation"));
    await waitFor(() => expect(hoisted.getLiterature).toHaveBeenCalledTimes(2));
    expect(onSearchQueryChange).toHaveBeenCalledWith("NAE1 AND neddylation");

    // The parent stores the new query and passes it back: that echo must not start a third request.
    rerender({ ...base, searchQuery: "NAE1 AND neddylation", onSearchQueryChange });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(hoisted.getLiterature).toHaveBeenCalledTimes(2);
  });

  it("searches again when the inspector re-applies the same query", async () => {
    hoisted.getLiterature.mockResolvedValue(reply(["1"]));
    const { result, rerender } = renderHook((props: UseLiteratureSearchOptions) => useLiteratureSearch(props), {
      initialProps: { ...base, searchQuery: "NAE1 AND x" },
    });
    await waitFor(() => expect(result.current.citations).toHaveLength(1));
    expect(hoisted.getLiterature).toHaveBeenCalledTimes(1);

    // Same text, new version: the only way "Run this query" can retry after an error.
    rerender({ ...base, searchQuery: "NAE1 AND x", searchVersion: 1 });
    await waitFor(() => expect(hoisted.getLiterature).toHaveBeenCalledTimes(2));
  });

  it("lets only the newest request write the list, even when an older one answers last", async () => {
    const first = deferred<ReturnType<typeof reply>>();
    const second = deferred<ReturnType<typeof reply>>();
    hoisted.getLiterature.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useLiteratureSearch(base));
    await waitFor(() => expect(hoisted.getLiterature).toHaveBeenCalledTimes(1));

    act(() => result.current.runSearch(false, "NAE1 AND newer"));
    await waitFor(() => expect(hoisted.getLiterature).toHaveBeenCalledTimes(2));

    await act(async () => { second.resolve(reply(["new"])); });
    await waitFor(() => expect(result.current.citations.map(c => c.id)).toEqual(["new"]));
    await act(async () => { first.resolve(reply(["old"])); });
    expect(result.current.citations.map(c => c.id)).toEqual(["new"]);
    expect(result.current.isLoading).toBe(false);
  });

  it("keeps the list on screen when a retry of the same query fails", async () => {
    hoisted.getLiterature.mockResolvedValueOnce(reply(["1"])).mockRejectedValueOnce(new Error("upstream down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useLiteratureSearch(base));
    await waitFor(() => expect(result.current.citations).toHaveLength(1));

    act(() => result.current.runSearch(false));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.citations.map(c => c.id)).toEqual(["1"]);
    spy.mockRestore();
  });

  describe("paging", () => {
    const firstPage = { ...reply(["1", "2"]), nextCursor: "c2" };

    it("adds the next page after the loaded papers, skips repeats, and moves the cursor on", async () => {
      hoisted.getLiterature.mockResolvedValueOnce(firstPage).mockResolvedValueOnce({ ...reply(["2", "3"]), nextCursor: null });
      const { result } = renderHook(() => useLiteratureSearch(base));
      await waitFor(() => expect(result.current.citations).toHaveLength(2));

      await act(() => result.current.loadMore());
      expect(result.current.citations.map(c => c.id)).toEqual(["1", "2", "3"]);
      expect(result.current.response?.nextCursor).toBeNull();
      expect(hoisted.getLiterature.mock.calls[1][4]).toEqual({ cursor: "c2" });
    });

    it("keeps the loaded papers and the same cursor when the next page does not load", async () => {
      hoisted.getLiterature.mockResolvedValueOnce(firstPage).mockResolvedValueOnce({ ...reply([]), degraded: true });
      const { result } = renderHook(() => useLiteratureSearch(base));
      await waitFor(() => expect(result.current.citations).toHaveLength(2));

      await act(() => result.current.loadMore());
      expect(result.current.moreError).toMatch(/next page did not load/);
      expect(result.current.citations.map(c => c.id)).toEqual(["1", "2"]);
      expect(result.current.response?.nextCursor).toBe("c2");
      expect(result.current.moreLoading).toBe(false);
    });
  });

  describe("variant probe", () => {
    const variantQuery = "NAE1 AND (\"D116G\")";
    const answer = (probe: unknown) => (_gene: string, _force: boolean, _signal: unknown, query?: string) => Promise.resolve(query === variantQuery ? probe : reply(["1"]));

    it("counts the records that name the variant, with its own search", async () => {
      hoisted.getLiterature.mockImplementation(answer({ ...reply([]), hitCount: 7 }));
      const { result } = renderHook(() => useLiteratureSearch({ ...base, variantQuery }));
      await waitFor(() => expect(result.current.probe).toEqual({ state: "done", hitCount: 7 }));
    });

    it("reports a probe that did not answer as an error, never as a count of zero", async () => {
      hoisted.getLiterature.mockImplementation(answer({ ...reply([]), degraded: true, hitCount: 0 }));
      const { result } = renderHook(() => useLiteratureSearch({ ...base, variantQuery }));
      await waitFor(() => expect(result.current.probe).toEqual({ state: "error", hitCount: null }));
    });
  });

  it("marks a search still running when the tab closes as skipped, not as running forever", async () => {
    const store = useVariantAnalysisStore.getState();
    const before = store.analysisState;
    store.setAnalysisState(prev => ({ ...prev, result: { metadata: { gene: "NAE1", variant: "", uniprotId: "", pipelineRunId: "run-1", pipelineStages: {} } } as any }));
    hoisted.getLiterature.mockReturnValue(new Promise(() => {}));
    try {
      const { unmount } = renderHook(() => useLiteratureSearch(base));
      await waitFor(() => expect(useVariantAnalysisStore.getState().analysisState.result?.metadata?.pipelineStages?.literature).toBe("running"));
      unmount();
      expect(useVariantAnalysisStore.getState().analysisState.result?.metadata?.pipelineStages?.literature).toBe("skipped");
    } finally {
      useVariantAnalysisStore.getState().setAnalysisState(() => before);
    }
  });
});
