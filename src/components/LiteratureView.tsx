import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AlertTriangle, BookOpen, Library, Search } from "lucide-react";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { describeConnectionFailure } from "../shared/fetch-retry";
import {
  buildLiteratureEvidence,
  parseVariantForms,
  variantSearchQuery,
  type Citation,
  type GroupFilter,
  type LiteratureEvidence,
  type LiteratureResponseMeta,
  type PaperReading,
  type VariantProbe,
} from "../shared/literatureEvidence";
import { PaperTable } from "./literature/PaperTable";

export type { Citation };

interface LiteratureViewProps {
  gene: string;
  /** The variant in view, e.g. `p.Asp116Gly`. Drives the "names this variant" scope and text check. */
  variant?: string;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
  /** Reports the evidence model for what is on screen (local filters applied) so the inspector can
   *  trace the search and export exactly what the user sees. */
  onEvidenceChange?: (evidence: LiteratureEvidence) => void;
  /** Bumped by the inspector whenever it applies a query — including when the text is
   *  unchanged — so re-applying the same query still re-executes the search instead of
   *  silently doing nothing behind a "Query Applied" confirmation. */
  searchVersion?: number;
}

/** Worded with the gene symbol so each filter reads exactly like the chip on the rows it selects. */
const groupLabel = (g: GroupFilter, gene: string): string =>
  g === "all" ? "All" : g === "variant" ? "Name the variant" : g === "gene" ? `Name only ${gene}` : `${gene} not in abstract`;

/**
 * Literature.
 *
 * ONE QUESTION: what has been published on this gene and this variant, how was that list obtained, and
 * which papers actually name the variant? Three tiers, top to bottom:
 *
 *   1. THE FINDING — how many Europe PMC records name the variant (a background search answers it on
 *      load), in a sentence that states the query's reach and its limits; a four-cell fact strip ends
 *      in "Engine record: None" because no literature is scored.
 *   2. THE PAPERS — one table, scoped to the gene or to the variant, filterable by what the text check
 *      found, each row carrying its identifier and an "add to the report" control.
 *   3. THE TRACE — in the inspector rail: the query as sent, what matched, what was loaded.
 *
 * The request state machine below is unchanged from the audited revision (newest-request-wins,
 * self-update guard, inspector re-apply, abort of stale responses); only what it feeds and renders is new.
 */
export default function LiteratureView({
  gene,
  variant = "",
  searchQuery = "",
  onSearchQueryChange,
  onEvidenceChange,
  searchVersion = 0,
}: LiteratureViewProps) {
  const { apiClient } = useApiClient();
  const [citations, setCitations] = useState<Citation[]>([]);
  const reportCitations = useVariantAnalysisStore(st => st.reportCitations);
  const pinReportCitation = useVariantAnalysisStore(st => st.pinReportCitation);
  const unpinReportCitation = useVariantAnalysisStore(st => st.unpinReportCitation);
  const pinnedIds = useMemo(() => new Set(reportCitations.map(c => c.id)), [reportCitations]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [internalQuery, setInternalQuery] = useState(searchQuery);
  const [executedQuery, setExecutedQuery] = useState(searchQuery.trim());
  const [response, setResponse] = useState<LiteratureResponseMeta | null>(null);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [probe, setProbe] = useState<VariantProbe>({ state: "idle", hitCount: null });
  // The gene-wide count survives a switch to the variant scope, so both scope buttons can show theirs.
  const [geneHitCount, setGeneHitCount] = useState<number | null>(null);
  // Monotonic id per request: only the newest response may write UI state, so a slow
  // earlier fetch can never overwrite the results of a later one.
  const requestSeq = useRef(0);
  const probeSeq = useRef(0);
  const lastGene = useRef(gene);
  // Set when this component itself updates the shared query, so the prop-change effect
  // below can tell its own echo apart from an execution requested by the inspector.
  const selfQueryUpdate = useRef(false);

  const forms = useMemo(() => parseVariantForms(variant), [variant]);
  const variantQuery = useMemo(() => variantSearchQuery(gene, forms), [gene, forms]);

  const fetchCitations = useCallback(async (forceSync = false, customQuery?: string) => {
    if (!gene) return;
    const seq = ++requestSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiClient.getLiterature(gene, forceSync, undefined, customQuery);
      if (seq !== requestSeq.current) return; // superseded — a newer request owns the UI
      setCitations(data.citations || []);
      const meta: LiteratureResponseMeta = {
        hitCount: typeof data.hitCount === "number" ? data.hitCount : null,
        europePmcQuery: data.europePmcQuery ?? null,
        degraded: data.degraded === true,
        fetchedAt: typeof data.fetchedAt === "number" ? data.fetchedAt : null,
        pageSize: typeof data.pageSize === "number" ? data.pageSize : null,
      };
      setResponse(meta);
      if (!meta.degraded && meta.hitCount !== null) {
        const q = (customQuery ?? "").trim();
        if (!q) setGeneHitCount(meta.hitCount);
        else if (variantQuery && q.toLowerCase() === variantQuery.toLowerCase()) {
          // The variant scope is the probe's own query: its answer is already in hand.
          setProbe({ state: "done", hitCount: meta.hitCount });
        }
      }
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      // Keep the raw error as the console argument: its stack is the only record of WHERE the
      // response was lost (the body-read frame), and the Dev Console stores that as the entry's
      // detail. Only the banner text is translated.
      console.error("[Literature Fetch Error]:", err);
      setError(
        describeConnectionFailure(err, "citations") ||
          err.message ||
          "Failed to load literature citations."
      );
    } finally {
      if (seq === requestSeq.current) {
        setIsLoading(false);
      }
    }
  }, [gene, apiClient, variantQuery]);

  // The shared query prop changes only when a search actually executes — from the main
  // form, the inspector, or a scope button. Typing never touches it, so a prop change
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
    // shows a loading state while the export still offers the stale list under the new label.
    setCitations([]);
    setResponse(null);
    setError(null);
    setGroupFilter("all");
    // The gene-wide count belongs to the gene: keep it across a scope switch, drop it for a new gene.
    if (lastGene.current !== gene) {
      lastGene.current = gene;
      setGeneHitCount(null);
    }
    setInternalQuery(searchQuery);
    setExecutedQuery(searchQuery.trim());
    void fetchCitations(false, searchQuery || undefined);
    // Keyed on what actually changes: the gene, an executed query, or an inspector apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gene, searchQuery, searchVersion]);

  // The variant probe: one background search for records that name the variant, so the finding can say
  // how many there are without the reader switching scope first. It is an ordinary custom query, cached
  // server-side like any other, and its failure is reported as a fault rather than shown as a zero.
  useEffect(() => {
    if (!gene || !variantQuery) {
      setProbe({ state: "idle", hitCount: null });
      return;
    }
    const seq = ++probeSeq.current;
    setProbe({ state: "loading", hitCount: null });
    apiClient
      .getLiterature(gene, false, undefined, variantQuery)
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
    if (queryChanged) {
      setCitations([]);
      setResponse(null);
      setGroupFilter("all");
    }
    if (query !== searchQuery.trim() && onSearchQueryChange) {
      selfQueryUpdate.current = true;
      onSearchQueryChange(query);
    }
    void fetchCitations(forceSync, query || undefined);
  };

  // Local narrowing filter: active only while the typed text differs from the query that
  // produced the loaded set. The comparison is case-insensitive — a case-variant retype
  // of the executed query used to re-activate the narrowing filter and could zero the
  // list over results that already matched.
  const activeFilter = internalQuery.trim();
  const executedFilter = executedQuery.trim();
  const isNarrowingFilter = Boolean(activeFilter && activeFilter.toLowerCase() !== executedFilter.toLowerCase());

  const evidence = useMemo(
    () =>
      buildLiteratureEvidence({
        gene,
        variant: variant || null,
        citations,
        response,
        executedQuery,
        narrowingFilter: isNarrowingFilter ? activeFilter : "",
        groupFilter,
        pinnedIds,
        probe,
        geneHitCount,
        load: isLoading ? "loading" : error && citations.length === 0 ? "error" : response ? "ready" : "idle",
        error,
      }),
    [gene, variant, citations, response, executedQuery, isNarrowingFilter, activeFilter, groupFilter, pinnedIds, probe, geneHitCount, isLoading, error]
  );

  // Hand the evidence model to shared state for the inspector. Guarded on what the inspector prints, so
  // a keystroke that changes nothing it shows does not re-render the whole inspector tree.
  const lastReportedKey = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([
      evidence.displayed.map(c => c.id),
      evidence.counts,
      evidence.trace,
      evidence.faults,
      evidence.scope,
      evidence.variantQuery,
      evidence.finding.headline,
      evidence.response,
    ]);
    if (key === lastReportedKey.current) return;
    lastReportedKey.current = key;
    onEvidenceChange?.(evidence);
  }, [evidence, onEvidenceChange]);

  const togglePin = (paper: PaperReading) => {
    const c = paper.citation;
    if (paper.pinned) unpinReportCitation(c.id);
    else
      pinReportCitation({
        id: c.id,
        title: c.title,
        authors: c.authors,
        journal: c.journal,
        year: c.year,
        url: /^https?:\/\//i.test(c.url ?? "") ? (c.url as string) : null,
      });
  };

  const { counts, finding, facts, faults } = evidence;
  const variantHit = evidence.scope === "variant" ? (response?.degraded ? null : response?.hitCount ?? null) : probe.state === "done" ? probe.hitCount : null;
  const geneCount = evidence.scope === "gene" ? (response?.degraded ? null : response?.hitCount ?? null) : geneHitCount;
  const fmt = (v: number | null) => (v === null ? null : v.toLocaleString("en-GB"));

  const loadingFirst = isLoading && citations.length === 0;
  const nothingMatched = !isLoading && evidence.visible.length === 0;

  return (
    <div className="lit-view">
      <div className="lit-screen @container">
        <header>
          <h1 className="screen-title">Literature</h1>
          <p className="screen-tab-description">
            What Europe PMC holds on {gene || "this gene"}{forms ? ` and ${forms.label}` : ""}, how the list was obtained, and which papers name the variant.
          </p>
        </header>

        {/* ── 1. The finding ─────────────────────────────────────────────────────────────── */}
        <section className="lit-card lit-hero" aria-labelledby="lit-finding-title" data-testid="literature-finding">
          <div className="lit-hero__body">
            <div className="lit-hero__top">
              <span className="eyebrow" id="lit-finding-title">
                <BookOpen className="w-3.5 h-3.5" />
                Published literature
              </span>
              <span className="ev-tier" data-tone="muted" title="The ACMG rule engine reads no literature: nothing on this tab is counted in the verdict.">
                Not counted in the ACMG verdict
              </span>
            </div>

            <div className="lit-hero__figure">
              <span className="figure-headline lit-figure" data-testid="literature-figure">{finding.figure}</span>
              <span className="lit-hero__figure-label">{finding.figureLabel}</span>
            </div>

            <p className="detail-prose lit-hero__finding">
              <strong>{finding.headline}</strong>
              {" "}
              {finding.predicate}.
            </p>

            {faults.map(fault => (
              <p key={fault} role="status" className="lit-callout" data-tone="warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{fault}</span>
              </p>
            ))}
          </div>

          <dl className="lit-facts">
            {facts.map(f => (
              <div key={f.label} className="lit-fact">
                <dt>{f.label}</dt>
                <dd>
                  <span className="lit-fact__value">{f.value}</span>
                  <span className="lit-fact__sub">{f.sub}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── 2. The papers ──────────────────────────────────────────────────────────────── */}
        <section className="lit-section" aria-labelledby="lit-papers-title">
          <h2 className="eyebrow" id="lit-papers-title">
            <Library className="w-3.5 h-3.5" />
            Papers
            {counts.pinned > 0 && <span className="lit-eyebrow-meta">{counts.pinned} in the report</span>}
          </h2>

          <div className="lit-card lit-papers" data-testid="literature-papers">
            <div className="lit-toolbar">
              <div className="lit-scope" role="group" aria-label="Which papers to search for">
                <button
                  type="button"
                  className="lit-seg"
                  aria-pressed={evidence.scope === "gene"}
                  disabled={isLoading && evidence.scope === "gene"}
                  onClick={() => runSearch(false, "")}
                >
                  All on {gene}
                  {fmt(geneCount) && <span className="lit-seg__n">{fmt(geneCount)}</span>}
                </button>
                {forms && variantQuery && (
                  <button
                    type="button"
                    className="lit-seg"
                    aria-pressed={evidence.scope === "variant"}
                    disabled={isLoading && evidence.scope === "variant"}
                    onClick={() => runSearch(false, variantQuery)}
                  >
                    Naming {forms.label}
                    {fmt(variantHit) && <span className="lit-seg__n">{fmt(variantHit)}</span>}
                  </button>
                )}
                {evidence.scope === "custom" && (
                  <span className="ev-tier" data-tone="neutral" title="A query you typed or applied from the inspector">Custom query</span>
                )}
              </div>

              <form
                className="lit-search"
                role="search"
                onSubmit={e => {
                  e.preventDefault();
                  // Explicit search, not a cache read: the button promises "Search Europe PMC", so a
                  // fresh cached set must not satisfy it without going upstream.
                  runSearch(true);
                }}
              >
                <label className="sr-only" htmlFor="lit-search-input">Search literature</label>
                <Search className="lit-search__icon" aria-hidden="true" />
                <input
                  id="lit-search-input"
                  type="text"
                  value={internalQuery}
                  onChange={e => setInternalQuery(e.target.value)}
                  placeholder="Keyword, author or MeSH — typing narrows this list, Enter searches Europe PMC"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" className="lit-btn" disabled={isLoading}>
                  Search Europe PMC
                </button>
              </form>
            </div>

            {counts.total > 0 && (
              <div className="lit-groups" role="group" aria-label="Filter by what the text check found">
                {(["all", ...(forms ? (["variant"] as const) : []), "gene", "elsewhere"] as GroupFilter[]).map(g => {
                  const n = g === "all" ? counts.total : counts[g];
                  return (
                    <button
                      key={g}
                      type="button"
                      className="lit-group"
                      aria-pressed={groupFilter === g}
                      disabled={g !== "all" && n === 0}
                      onClick={() => setGroupFilter(g)}
                    >
                      {groupLabel(g, gene)}
                      <span className="lit-group__n">{n}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {error && (
              <div role="alert" className="lit-callout lit-callout--banner" data-tone="warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong>Europe PMC search failed.</strong> {error}
                  {citations.length > 0 && " The previously loaded list is still shown below."}
                  {" "}
                  <button type="button" className="lit-link lit-link--btn lit-link--inline" onClick={() => fetchCitations(false, executedQuery || undefined)}>
                    Try again
                  </button>
                </span>
              </div>
            )}

            {loadingFirst ? (
              <div className="lit-empty" role="status" aria-busy="true">
                <p className="lit-empty__title">Searching Europe PMC…</p>
                <p className="lit-empty__body">Asking for the best matches on {gene}. This usually takes a few seconds.</p>
              </div>
            ) : nothingMatched && !error ? (
              <div className="lit-empty" data-testid="literature-empty">
                {isNarrowingFilter ? (
                  <>
                    <p className="lit-empty__title">No matches in the loaded list</p>
                    <p className="lit-empty__body">
                      None of the {counts.total} loaded papers match “{activeFilter}”. Press Enter to search Europe PMC for it.
                    </p>
                  </>
                ) : groupFilter !== "all" && counts.total > 0 ? (
                  <>
                    <p className="lit-empty__title">None in this group</p>
                    <p className="lit-empty__body">No loaded paper falls under “{groupLabel(groupFilter, gene)}”. Choose All to see the full list.</p>
                  </>
                ) : (
                  <>
                    <p className="lit-empty__title">
                      {evidence.scope === "variant" && forms ? `No record names ${forms.label}` : "No papers returned"}
                    </p>
                    <p className="lit-empty__body">
                      {evidence.scope === "variant" && forms
                        ? `Europe PMC matched 0 records for ${gene} with ${forms.forms.join(", ")}. A report under another notation would not match; try All on ${gene}, or write your own query.`
                        : executedFilter
                          ? "Europe PMC returned no records for this query. Edit the search and press Enter."
                          : `Europe PMC returned no records for the default ${gene} query. Try a keyword or a MeSH term.`}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <PaperTable papers={evidence.visible} gene={gene} forms={forms} onTogglePin={togglePin} />
            )}

            <div className="lit-card__foot">
              <span>
                Europe PMC · {counts.visible.toLocaleString("en-GB")} shown
                {response?.hitCount != null && !response.degraded && response.hitCount > counts.total
                  ? ` · first ${counts.total.toLocaleString("en-GB")} of ${response.hitCount.toLocaleString("en-GB")} in Europe PMC's default ranking`
                  : ""}
              </span>
              <span>Variant matches first, then newest · text check reads titles and abstracts only</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
