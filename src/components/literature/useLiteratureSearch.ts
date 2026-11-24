import { useState, useEffect, useCallback, useRef } from "react";
import { useApiClient } from "../../apiClient";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { describeConnectionFailure } from "../../shared/fetch-retry";
import type { Citation, CuratedCoverage, LiteratureResponseMeta, VariantProbe } from "../../shared/literatureEvidence";

export interface UseLiteratureSearchOptions {
  gene: string;
  variant: string;
  uniprotId: string;
  searchQuery: string;
  searchVersion: number;
  variantQuery: string | null;
  onSearchQueryChange?: (q: string) => void;
  onResetFilters: () => void;
}

/**
 * Request state machine for the Literature tab: newest-request-wins sequence guard,
 * self-update guard for inspector-driven query applies, abort of stale responses,
 * background variant-notation probe, and cursor pagination.
 */
export function useLiteratureSearch({
  gene, variant, uniprotId, searchQuery, searchVersion, variantQuery, onSearchQueryChange, onResetFilters,
}: UseLiteratureSearchOptions) {
  const { apiClient } = useApiClient();
  const [citations, setCitations] = useState<Citation[]>([]);
  const [curatedCoverage, setCuratedCoverage] = useState<CuratedCoverage | null>(null);
  // Curated records the query did not match, shown but never counted as query membership.
  const [curatedAdded, setCuratedAdded] = useState(0);
  const curatedOnlyIds = useRef(new Set<string>());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalQuery, setInternalQuery] = useState(searchQuery);
  const [revealedDraft, setRevealedDraft] = useState<string | null>(null);
  const [executedQuery, setExecutedQuery] = useState(searchQuery.trim());
  const [response, setResponse] = useState<LiteratureResponseMeta | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [probe, setProbe] = useState<VariantProbe>({ state: "idle", hitCount: null });
  // The gene-wide count survives a switch to the variant scope, so both scope buttons can show theirs.
  const [geneHitCount, setGeneHitCount] = useState<number | null>(null);

  // Monotonic id per request: only the newest response may write UI state, so a slow
  // earlier fetch can never overwrite the results of a later one.
  const requestSeq = useRef(0);
  const probeSeq = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const lastGene = useRef(gene);
  // The query this component itself pushed into the shared state, so the prop-change effect below can
  // tell its own echo apart from an execution requested by the inspector. It holds the query, not a
  // flag: an unrelated change (another gene, variant or protein) that lands first is not the echo.
  const selfQueryUpdate = useRef<string | null>(null);
  const onResetFiltersRef = useRef(onResetFilters);
  onResetFiltersRef.current = onResetFilters;

  const clearLoadedResults = () => {
    onResetFiltersRef.current();
    setCitations([]);
    setResponse(null);
    setCuratedCoverage(null);
    setCuratedAdded(0);
  };

  const publishOutcome = useCallback(
    (outcome: "running" | "complete" | "degraded" | "error" | "skipped", runId?: string) => {
      useVariantAnalysisStore.getState().setAnalysisState(prev => {
        if (!prev.result || prev.result.metadata?.gene !== gene || prev.result.metadata?.pipelineRunId !== runId) return prev;
        return {
          ...prev,
          result: {
            ...prev.result,
            metadata: { ...prev.result.metadata, pipelineStages: { ...prev.result.metadata.pipelineStages, literature: outcome } },
          },
        };
      });
    },
    [gene]
  );

  useEffect(() => () => {
    requestSeq.current++;
    requestAbort.current?.abort();
    const result = useVariantAnalysisStore.getState().analysisState.result;
    if (result?.metadata?.pipelineStages?.literature === "running") publishOutcome("skipped", result.metadata.pipelineRunId);
  }, [publishOutcome]);

  const fetchCitations = useCallback(async (forceSync = false, customQuery?: string) => {
    if (!gene) return;
    const seq = ++requestSeq.current;
    const runId = useVariantAnalysisStore.getState().analysisState.result?.metadata?.pipelineRunId;
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    publishOutcome("running", runId);
    setIsLoading(true);
    setError(null);
    setMoreError(null);
    setMoreLoading(false);
    try {
      const data = await apiClient.getLiterature(gene, forceSync, controller.signal, customQuery, {
        variant: variant || undefined,
        uniprot: uniprotId || undefined,
      });
      if (seq !== requestSeq.current) return; // superseded — a newer request owns the UI
      const curatedOnly = data.curatedCitations || [];
      setCitations([...(data.citations || []), ...curatedOnly]);
      setCuratedAdded(curatedOnly.length);
      curatedOnlyIds.current = new Set(curatedOnly.map(c => c.id));
      setCuratedCoverage(
        data.curated
          ? {
              state: data.curated.state,
              ...(data.curated.reason ? { reason: data.curated.reason } : {}),
              linked: typeof data.curated.linked === "number" ? data.curated.linked : 0,
            }
          : null
      );
      const meta: LiteratureResponseMeta = {
        hitCount: typeof data.hitCount === "number" ? data.hitCount : null,
        europePmcQuery: data.europePmcQuery ?? null,
        degraded: data.degraded === true,
        fetchedAt: typeof data.fetchedAt === "number" ? data.fetchedAt : null,
        pageSize: typeof data.pageSize === "number" ? data.pageSize : null,
        nextCursor: data.nextCursor ?? null,
      };
      setResponse(meta);
      publishOutcome(meta.degraded ? "degraded" : "complete", runId);
      if (!meta.degraded && meta.hitCount !== null) {
        const q = (customQuery ?? "").trim();
        if (!q) setGeneHitCount(meta.hitCount);
        else if (variantQuery && q.toLowerCase() === variantQuery.toLowerCase()) {
          // The variant scope is the probe's own query: its answer is already in hand.
          setProbe({ state: "done", hitCount: meta.hitCount });
        }
      }
    } catch (err: any) {
      if (seq !== requestSeq.current || controller.signal.aborted) return;
      publishOutcome("error", runId);
      // Keep the raw error as the console argument: its stack is the only record of WHERE the
      // response was lost (the body-read frame), and the Dev Console stores that as the entry's
      // detail. Only the banner text is translated.
      console.error("[Literature Fetch Error]:", err);
      setError(describeConnectionFailure(err, "citations") || err.message || "Failed to load literature citations.");
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [gene, apiClient, variantQuery, publishOutcome, variant, uniprotId]);

  // The shared query prop changes only when a search actually executes — from the main
  // form, the inspector, or a scope button. Typing never touches it, so a prop change
  // here is an external execution request and fetches on the caller's behalf. The
  // inspector's version bump fires this effect even when it re-applies an unchanged
  // query, which is what lets "apply again" (e.g. retry after an error) work.
  useEffect(() => {
    if (selfQueryUpdate.current !== null && selfQueryUpdate.current === searchQuery.trim()) {
      selfQueryUpdate.current = null;
      return;
    }
    // A new executed result set replaces the old one: without this the previous gene's
    // (or previous query's) citations stay in state through the fetch window, the view
    // shows a loading state while the export still offers the stale list under the new label.
    clearLoadedResults();
    setError(null);
    // The gene-wide count belongs to the gene: keep it across a scope switch, drop it for a new gene.
    if (lastGene.current !== gene) {
      lastGene.current = gene;
      setGeneHitCount(null);
    }
    setInternalQuery(searchQuery);
    setRevealedDraft(null);
    setExecutedQuery(searchQuery.trim());
    void fetchCitations(false, searchQuery || undefined);
    // Keyed on what actually changes: the gene, an executed query, the variant context, or an
    // inspector apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gene, searchQuery, searchVersion, variant, uniprotId]);

  // The variant probe: one background search for records that name the variant, so the finding can say
  // how many there are without the reader switching scope first. It is an ordinary custom query, cached
  // server-side like any other, and its failure is reported as a fault rather than shown as a zero.
  useEffect(() => {
    if (!gene || !variantQuery) {
      setProbe({ state: "idle", hitCount: null });
      return;
    }
    const seq = ++probeSeq.current;
    const controller = new AbortController();
    setProbe({ state: "loading", hitCount: null });
    apiClient
      .getLiterature(gene, false, controller.signal, variantQuery)
      .then(data => {
        if (seq !== probeSeq.current) return;
        const ok = data.degraded !== true && typeof data.hitCount === "number";
        setProbe(ok ? { state: "done", hitCount: data.hitCount as number } : { state: "error", hitCount: null });
      })
      .catch(err => {
        if (seq !== probeSeq.current) return;
        console.error("[Literature Variant Probe Error]:", err);
        setProbe({ state: "error", hitCount: null });
      });
    return () => {
      probeSeq.current++;
      controller.abort();
    };
  }, [gene, variantQuery, apiClient]);

  /**
   * Run a search. `queryOverride` is for the scope buttons, which know their query; otherwise the typed
   * text is used. The query is handed to shared state so the inspector stays in sync, but the fetch
   * happens here directly — the guard above stops the prop-change effect from executing the same search
   * a second time. When the query actually changed, the old result set is cleared first; a same-query
   * retry keeps the old list on screen so a failed retry does not blank what the user was reading.
   */
  const runSearch = (forceSync: boolean, queryOverride?: string) => {
    const query = (queryOverride ?? internalQuery).trim();
    const queryChanged = query !== executedQuery;
    if (queryOverride !== undefined) setInternalQuery(queryOverride);
    setExecutedQuery(query);
    setRevealedDraft(null);
    if (queryChanged) clearLoadedResults();
    if (query !== searchQuery.trim() && onSearchQueryChange) {
      selfQueryUpdate.current = query;
      onSearchQueryChange(query);
    }
    void fetchCitations(forceSync, query || undefined);
  };

  const loadMore = async () => {
    if (!response?.nextCursor || moreLoading || isLoading) return;
    const seq = requestSeq.current;
    setMoreLoading(true);
    setMoreError(null);
    try {
      const data = await apiClient.getLiterature(gene, false, requestAbort.current?.signal, executedQuery || undefined, { cursor: response.nextCursor });
      if (seq !== requestSeq.current) return;
      if (data.degraded) throw new Error("The next page did not load. Your current papers are still available.");
      for (const c of data.citations) curatedOnlyIds.current.delete(c.id);
      setCuratedAdded(curatedOnlyIds.current.size);
      setCitations(current => {
        const byId = new Map(current.map(c => [c.id, c]));
        for (const c of data.citations) if (!byId.has(c.id)) byId.set(c.id, c);
        return [...byId.values()];
      });
      setResponse(current => current ? { ...current, nextCursor: data.nextCursor ?? null } : current);
    } catch (err: any) {
      if (seq === requestSeq.current && !requestAbort.current?.signal.aborted) setMoreError(err.message);
    } finally {
      if (seq === requestSeq.current) setMoreLoading(false);
    }
  };

  // Local narrowing filter: active only while the typed text differs from the query that
  // produced the loaded set. The comparison is case-insensitive — a case-variant retype
  // of the executed query used to re-activate the narrowing filter and could zero the
  // list over results that already matched.
  const activeFilter = internalQuery.trim();
  const executedFilter = executedQuery.trim();
  const isNarrowingFilter = Boolean(activeFilter && activeFilter.toLowerCase() !== executedFilter.toLowerCase() && internalQuery !== revealedDraft);

  return {
    citations, curatedCoverage, curatedAdded, isLoading, error, internalQuery, setInternalQuery, setRevealedDraft,
    executedQuery, response, moreLoading, moreError, probe, geneHitCount, fetchCitations, runSearch, loadMore,
    activeFilter, executedFilter, isNarrowingFilter,
  };
}
