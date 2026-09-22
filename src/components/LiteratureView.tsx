import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { 
  BookOpen, 
  Search, 
  ExternalLink, 
  RefreshCw, 
  ChevronDown, 
  ChevronUp, 
  AlertCircle,
  Copy,
  CheckCircle2
} from "lucide-react";
import { useApiClient } from "../apiClient";

interface LiteratureViewProps {
  gene: string;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
  /** Reports the citations currently on screen (local filter applied) so the inspector
   *  can export exactly what the user sees. */
  onDisplayedCitationsChange?: (citations: Citation[]) => void;
  /** Bumped by the inspector whenever it applies a query — including when the text is
   *  unchanged — so re-applying the same query still re-executes the search instead of
   *  silently doing nothing behind a "Query Applied" confirmation. */
  searchVersion?: number;
}

export interface Citation {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  year: number | null;
  /** Canonical link resolved server-side: PubMed, PMC, or Europe PMC for preprints. */
  url?: string | null;
}

export default function LiteratureView({ 
  gene, 
  searchQuery = "",
  onSearchQueryChange,
  onDisplayedCitationsChange,
  searchVersion = 0
}: LiteratureViewProps) {
  const { apiClient } = useApiClient();
  const [citations, setCitations] = useState<Citation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalQuery, setInternalQuery] = useState(searchQuery);
  const [executedQuery, setExecutedQuery] = useState(searchQuery.trim());
  const [hitCount, setHitCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Monotonic id per request: only the newest response may write UI state, so a slow
  // earlier fetch can never overwrite the results of a later one.
  const requestSeq = useRef(0);
  // Set when this component itself updates the shared query, so the prop-change effect
  // below can tell its own echo apart from an execution requested by the inspector.
  const selfQueryUpdate = useRef(false);
  const copiedTimerRef = useRef<number | null>(null);

  // Clear a pending "Copied!" reset if the component unmounts first.
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const fetchCitations = useCallback(async (forceSync = false, customQuery?: string) => {
    if (!gene) return;
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    // Syncing belongs to the current request only: a plain fetch superseding an
    // in-flight sync must not inherit its spinner, and a sync must not clear it.
    setSyncing(forceSync);
    try {
      const data = await apiClient.getLiterature(gene, forceSync, undefined, customQuery);
      if (seq !== requestSeq.current) return; // superseded — a newer request owns the UI
      setCitations(data.citations || []);
      setHitCount(typeof data.hitCount === "number" ? data.hitCount : null);
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      console.error("[Literature Fetch Error]:", err);
      setError(err.message || "Failed to load literature citations.");
    } finally {
      if (seq === requestSeq.current) {
        setIsLoading(false);
        setSyncing(false);
      }
    }
  }, [gene, apiClient]);

  // The shared query prop changes only when a search actually executes — from the main
  // form, the Sync button, or the inspector. Typing never touches it, so a prop change
  // here is an external execution request and fetches on the caller's behalf. The
  // inspector's version bump fires this effect even when it re-applies an unchanged
  // query, which is what lets "apply again" (e.g. retry after an error) work.
  useEffect(() => {
    if (selfQueryUpdate.current) {
      selfQueryUpdate.current = false;
      return;
    }
    // A new executed result set replaces the old one: without this the previous gene's
    // (or previous query's) citations stay in state through the fetch window, the view
    // shows a spinner while the export still offers the stale list under the new label.
    setCitations([]);
    setHitCount(null);
    setError(null);
    setInternalQuery(searchQuery);
    setExecutedQuery(searchQuery.trim());
    void fetchCitations(false, searchQuery || undefined);
    // Keyed on what actually changes: the gene, an executed query, or an inspector apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gene, searchQuery, searchVersion]);

  /**
   * Run a search for whatever is typed. The query is handed to shared state so the
   * inspector stays in sync, but the fetch happens here directly — the guard above stops
   * the prop-change effect from executing the same search a second time. When the query
   * actually changed, the old result set is cleared first (same reasoning as the effect
   * above); a same-query retry keeps the old list on screen so a failed retry does not
   * blank what the user was reading.
   */
  const runSearch = (forceSync: boolean) => {
    const query = internalQuery.trim();
    const queryChanged = query !== executedQuery;
    setExecutedQuery(query);
    if (queryChanged) {
      setCitations([]);
      setHitCount(null);
    }
    if (query !== searchQuery.trim() && onSearchQueryChange) {
      selfQueryUpdate.current = true;
      onSearchQueryChange(query);
    }
    void fetchCitations(forceSync, query || undefined);
  };

  const handleQueryChange = (val: string) => {
    // Typing only narrows the already-loaded list — instant and with zero network
    // traffic. Enter (or the search/sync buttons) is what actually runs a search.
    setInternalQuery(val);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleCopyPmid = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopiedId(null), 2000);
  };

  // Local narrowing filter: active only while the typed text differs from the query that
  // produced the loaded set. The comparison is case-insensitive — a case-variant retype
  // of the executed query used to re-activate the narrowing filter and could zero the
  // list over results that already matched.
  const activeFilter = internalQuery.trim();
  const executedFilter = executedQuery.trim();
  const isNarrowingFilter = Boolean(activeFilter && activeFilter.toLowerCase() !== executedFilter.toLowerCase());

  const filteredCitations = useMemo(() => {
    if (!isNarrowingFilter) return citations;

    const raw = activeFilter;
    return citations.filter(c => {
      const fullContent = `${c.title} ${c.abstract} ${c.authors} ${c.journal} ${c.year || ""}`.toLowerCase();
      if (fullContent.includes(raw.toLowerCase())) return true;

      const terms = raw
        .replace(/\[.*?\]/g, " ")
        .replace(/\b(AND|OR|NOT)\b/gi, " ")
        .replace(/[()",]/g, " ")
        .split(/\s+/)
        .map(t => t.toLowerCase())
        .filter(t => t.length > 1);

      if (terms.length === 0) return true;
      return terms.some(term => fullContent.includes(term));
    });
  }, [citations, activeFilter, isNarrowingFilter]);

  // Hand the on-screen list (filter included) to shared state for the inspector's export.
  // Guarded on the list's identity: reporting runs on every narrowing keystroke, and an
  // unconditional push re-renders the whole inspector tree for an unchanged list.
  const lastReportedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = filteredCitations.map(c => c.id).join("|");
    if (key === lastReportedKeyRef.current) return;
    lastReportedKeyRef.current = key;
    onDisplayedCitationsChange?.(filteredCitations);
  }, [filteredCitations, onDisplayedCitationsChange]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "var(--cs-bg)" }}>
      {/* View Header */}
      <div className="px-5 py-4 border-b border-cs-border-subtle flex items-center justify-between bg-cs-surface-2">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-cs-accent-clay/10 text-cs-accent-clay">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-cs-text-primary">Scientific Literature</h2>
            <p className="text-[10px] text-cs-text-muted font-mono uppercase tracking-wider">
              PubMed & Europe PMC citations for {gene}
              {hitCount !== null && filteredCitations.length < hitCount && (
                /* Numerator is what is *displayed* — during a local narrowing filter the
                   loaded count would overstate what the user is actually looking at. The
                   gate compares the displayed count too: when the full loaded set fits in
                   one page the subtitle is noise, but filtering that set down still
                   deserves a "showing 8 of 25". */
                <span> · showing {filteredCitations.length} of {hitCount.toLocaleString()} hits</span>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={() => runSearch(true)}
          disabled={isLoading || syncing}
          className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-cs-border hover:bg-cs-surface-3 transition-colors disabled:opacity-50 text-cs-text-secondary cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Searching Europe PMC..." : "Sync Europe PMC"}
        </button>
      </div>

      {/* Local Filter Bar */}
      <div className="p-3 border-b border-cs-border-subtle bg-cs-surface-1">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            // Explicit search, not a cache read: the button promises "Search Europe
            // PMC", so a fresh cached set must not satisfy it without going upstream.
            runSearch(true);
          }}
          className="relative flex items-center gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-cs-text-muted absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Keyword, author, or MeSH — Enter searches Europe PMC..."
              value={internalQuery}
              onChange={e => handleQueryChange(e.target.value)}
              aria-label="Search literature"
              className="w-full text-xs pl-9 pr-4 py-2 border rounded-lg bg-cs-surface-2 border-cs-border text-cs-text-primary placeholder:text-cs-text-muted focus:outline-none focus:border-cs-accent-clay transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || syncing}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-cs-accent-clay text-white hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search Europe PMC</span>
          </button>
        </form>
      </div>

      {/* Main Literature List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && !syncing ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--cs-accent-clay)", borderTopColor: "transparent" }} />
            <span className="text-xs text-cs-text-muted font-mono">Loading publication index...</span>
          </div>
        ) : (
          <>
            {error && (
              /* The error no longer masks still-valid results: the banner sits above the
                 kept list and says so, instead of replacing it with no way back except
                 a refetch. */
              <div
                role="alert"
                aria-live="polite"
                className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/5 text-rose-200 flex items-start gap-3"
              >
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-bold text-xs uppercase tracking-wider block mb-0.5">Sync Error</span>
                  <p className="text-xs text-rose-300">{error}</p>
                  {citations.length > 0 && (
                    <p className="text-[11px] text-rose-300/80 mt-1">
                      Showing previously loaded results below.
                    </p>
                  )}
                  <button
                    onClick={() => fetchCitations(false, executedQuery.trim() || undefined)}
                    className="mt-2 text-xs font-bold text-cs-text-accent hover:underline block"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
            {filteredCitations.length === 0 ? (
              !error && (isNarrowingFilter ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-cs-border rounded-xl">
                  <Search className="w-8 h-8 text-cs-text-muted mb-2 opacity-40" />
                  <h3 className="text-xs font-semibold text-cs-text-primary">No matches in the loaded list</h3>
                  <p className="text-[11px] text-cs-text-muted mt-1 max-w-xs">
                    None of the {citations.length} loaded citations match "{activeFilter}". Press Enter to search Europe PMC for it.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-dashed border-cs-border rounded-xl">
                  <BookOpen className="w-8 h-8 text-cs-text-muted mb-2 opacity-40" />
                  <h3 className="text-xs font-semibold text-cs-text-primary">No literature matched</h3>
                  <p className="text-[11px] text-cs-text-muted mt-1 max-w-xs">
                    {executedFilter
                      ? "Europe PMC returned no results for this query. Edit the search and press Enter, or click \"Sync Europe PMC\"."
                      : `We haven't indexed any literature for ${gene} yet. Click "Sync Europe PMC" above to search Europe PMC.`}
                  </p>
                </div>
              ))
            ) : (
              filteredCitations.map(citation => {
                const isExpanded = !!expandedIds[citation.id];
                const isPmid = /^\d+$/.test(citation.id);
                // Cached legacy rows can carry a null URL, and a stored URL is trusted
                // only if it is absolute: otherwise a non-PMID id would render a dead
                // `pubmed…/<PPRid>/` deep link labeled as a working article page.
                const hasUsableUrl = !!citation.url && /^https?:\/\//i.test(citation.url);
                const articleHref = hasUsableUrl
                  ? citation.url as string
                  : isPmid
                    ? `https://pubmed.ncbi.nlm.nih.gov/${citation.id}/`
                    : `https://europepmc.org/search?query=${encodeURIComponent(citation.id)}`;
                return (
                  <div 
                    key={citation.id}
                    className="cs-card border border-cs-border-subtle rounded-xl bg-cs-surface-2 overflow-hidden shadow-sm hover:border-cs-border transition-all"
                  >
                {/* Header Card */}
                <div 
                  onClick={() => toggleExpand(citation.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleExpand(citation.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  className="px-4 py-3 cursor-pointer hover:bg-cs-surface-3 transition-colors flex items-start justify-between gap-4 focus:outline-none focus-visible:ring-1 focus-visible:ring-cs-accent-clay rounded-md"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    {/* Single-line metadata row: the journal truncates in place and the
                        identifier is pinned with shrink-0, so a long journal name can no
                        longer push PMID onto an orphaned second line. */}
                    <div className="flex items-center gap-2 min-w-0">
                      {citation.year && (
                        <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-cs-accent-clay/10 text-cs-text-accent border border-cs-accent-clay/10 shrink-0">
                          {citation.year}
                        </span>
                      )}
                      <span className="text-[10px] font-semibold text-cs-text-muted truncate min-w-0 flex-1" title={citation.journal}>
                        {citation.journal}
                      </span>
                      <span className="text-[10px] text-cs-text-muted font-mono shrink-0">
                        {isPmid ? `PMID: ${citation.id}` : citation.id}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold leading-relaxed text-cs-text-primary text-pretty font-serif">
                      {citation.title}
                    </h4>
                    <p className="text-[10px] text-cs-text-secondary truncate">
                      {citation.authors}
                    </p>
                  </div>
                  
                  <div className="text-cs-text-muted p-1 shrink-0" aria-hidden="true">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>

                {/* Expanded Abstract Section */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-cs-border-subtle bg-cs-surface-1/50 space-y-3">
                    <div className="space-y-1">
                      <span className="text-[9px] font-bold font-mono text-cs-text-muted uppercase tracking-wider block">Abstract</span>
                      <p className="text-xs text-cs-text-secondary leading-relaxed text-pretty whitespace-pre-line">
                        {citation.abstract}
                      </p>
                    </div>

                    {/* Actions bar */}
                    <div className="flex items-center gap-3 pt-2 border-t border-cs-border-subtle">
                      <a
                        href={articleHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] font-semibold text-cs-text-accent hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {isPmid ? "View on PubMed" : hasUsableUrl ? "View article" : "Search Europe PMC"}
                      </a>
                      <button
                        onClick={(e) => handleCopyPmid(citation.id, e)}
                        aria-live="polite"
                        className="flex items-center gap-1 text-[10px] font-semibold text-cs-text-muted hover:text-cs-text-primary"
                      >
                        {copiedId === citation.id ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            {isPmid ? "PMID Copied!" : "ID Copied!"}
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            {isPmid ? "Copy PMID" : "Copy ID"}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
            )}
          </>
        )}
      </div>
    </div>
  );
}
