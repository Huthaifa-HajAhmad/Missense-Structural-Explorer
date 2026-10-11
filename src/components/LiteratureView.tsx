import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { AlertTriangle, BookOpen, Library, Search } from "lucide-react";
import { useApiClient } from "../apiClient";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { describeConnectionFailure } from "../shared/fetch-retry";
import {
  buildLiteratureEvidence,
  parseVariantForms,
  variantSearchQuery,
  type Citation,
  type CuratedCoverage,
  type GroupFilter,
  type LiteratureEvidence,
  type LiteratureResponseMeta,
  type PaperReading,
  type VariantProbe,
} from "../shared/literatureEvidence";
import { PaperTable } from "./literature/PaperTable";
import { filterByScreening, type TierFilter } from "./literature/screeningFilters";
import { Prose } from "./ui/Prose";
import type { GeneConstraint, ScreeningTagName } from "../shared/literatureScreening";
import { verifiedAliasQuery } from "../shared/literatureAliases";
import type { VerifiedLiteratureAlias } from "../shared/contracts";
import { ENGINE_STATE_LABELS } from "../shared/engineStatus";
import { literatureCoverage, READING_DESK_LIMIT } from "../shared/reviewPresentation";
import { ReviewNavigation, useReviewWorkspace } from "./review/ReviewWorkspace";

export type { Citation };

interface LiteratureViewProps {
  gene: string;
  /** The variant in view, e.g. `p.Asp116Gly`. Drives the "names this variant" scope and text check. */
  variant?: string;
  /** The variant's UniProt accession, when known: lets the server attach curated variant-record links. */
  uniprotId?: string;
  searchQuery?: string;
  verifiedAliases?: VerifiedLiteratureAlias[];
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
  g === "all" ? "Any mention" : g === "variant" ? "Name the variant" : g === "gene" ? `Name only ${gene}` : "Neither in title/abstract";

const screeningFilters: Array<{ tag: ScreeningTagName; label: string }> = [
  { tag: "functional-assay", label: "Assay language" },
  { tag: "clinical-case", label: "Clinical study" },
  { tag: "same-residue", label: "Same residue" },
  { tag: "mechanism", label: "Mechanism" },
  { tag: "review", label: "Review" },
  { tag: "preprint", label: "Preprint" },
];

/**
 * Literature.
 *
 * ONE QUESTION: what has been published on this gene and this variant, how was that list obtained, and
 * which papers actually name the variant? A finding, then two reading views:
 *
 *   1. THE FINDING — how many Europe PMC records name the variant (a background search answers it on
 *      load), stating the query's reach and limits. Search facts live in a disclosure.
 *   2. READING DESK — loaded-text coverage and up to eight matching papers in the existing attention
 *      order. SOURCE RECORDS exposes every matching loaded paper with the same filtering controls.
 *   3. THE TRACE — persistent selected source, query as sent, matches and loaded records in the rail.
 *
 * The request state machine below is unchanged from the audited revision (newest-request-wins,
 * self-update guard, inspector re-apply, abort of stale responses); only what it feeds and renders is new.
 */
export default function LiteratureView({
  gene,
  variant = "",
  uniprotId = "",
  searchQuery = "",
  verifiedAliases,
  onSearchQueryChange,
  onEvidenceChange,
  searchVersion = 0,
}: LiteratureViewProps) {
  const { apiClient } = useApiClient();
  const workspace = useReviewWorkspace('literature');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [curatedCoverage, setCuratedCoverage] = useState<CuratedCoverage | null>(null);
  // Curated records the query did not match, shown but never counted as query membership.
  const [curatedAdded, setCuratedAdded] = useState(0);
  const curatedOnlyIds = useRef(new Set<string>());
  const defaultTierApplied = useRef(false);
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
  const [sortOrder, setSortOrder] = useState<"attention" | "newest">("attention");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [tagFilters, setTagFilters] = useState<ScreeningTagName[]>([]);
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
  const publishOutcome = useCallback((outcome: "running" | "complete" | "degraded" | "error" | "skipped", runId?: string) => {
    useVariantAnalysisStore.getState().setAnalysisState(prev => {
      if (!prev.result || prev.result.metadata?.gene !== gene || prev.result.metadata?.pipelineRunId !== runId) return prev;
      return { ...prev, result: { ...prev.result, metadata: { ...prev.result.metadata,
        pipelineStages: { ...prev.result.metadata.pipelineStages, literature: outcome }
      } } };
    });
  }, [gene]);
  useEffect(() => () => {
    requestSeq.current++;
    requestAbort.current?.abort();
    const result = useVariantAnalysisStore.getState().analysisState.result;
    if (result?.metadata?.pipelineStages?.literature === "running") publishOutcome("skipped", result.metadata.pipelineRunId);
  }, [publishOutcome]);
  const lastGene = useRef(gene);
  // Set when this component itself updates the shared query, so the prop-change effect
  // below can tell its own echo apart from an execution requested by the inspector.
  const selfQueryUpdate = useRef(false);

  const forms = useMemo(() => parseVariantForms(variant), [variant]);
  const aliasQuery = verifiedAliasQuery(gene, variant, uniprotId, verifiedAliases ?? []);
  const variantQuery = useMemo(() => variantSearchQuery(gene, forms), [gene, forms]);

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
  }, [gene, apiClient, variantQuery, publishOutcome, variant, uniprotId]);

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
    defaultTierApplied.current = false;
    setCitations([]);
    setResponse(null);
    setCuratedCoverage(null);
    setCuratedAdded(0);
    setError(null);
    setGroupFilter("all");
    setTierFilter("all");
    setTagFilters([]);
    // The gene-wide count belongs to the gene: keep it across a scope switch, drop it for a new gene.
    if (lastGene.current !== gene) {
      lastGene.current = gene;
      setGeneHitCount(null);
    }
    setInternalQuery(searchQuery);
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
    if (queryChanged) {
      defaultTierApplied.current = false;
      setCitations([]);
      setResponse(null);
      setCuratedCoverage(null);
      setCuratedAdded(0);
      setGroupFilter("all");
      setTierFilter("all");
      setTagFilters([]);
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
        sortOrder,
        curated: curatedCoverage,
        curatedAdded,
      }),
    [gene, variant, citations, response, executedQuery, isNarrowingFilter, activeFilter, groupFilter, pinnedIds, probe, geneHitCount, isLoading, error, sortOrder, curatedCoverage, curatedAdded]
  );

  const loadedSetKey = citations.map(citation => citation.id).join("|");
  useLayoutEffect(() => {
    if (!citations.length || defaultTierApplied.current) return;
    defaultTierApplied.current = true;
    setTierFilter(evidence.shortlist.readFirst > 0 ? "readFirst" : evidence.shortlist.readNext > 0 ? "readNext" : "all");
  }, [loadedSetKey]);

  const loadMore = async () => {
    if (!response?.nextCursor || moreLoading || isLoading) return;
    const seq = requestSeq.current;
    setMoreLoading(true); setMoreError(null);
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
    } catch (err: any) { if (seq === requestSeq.current && !requestAbort.current?.signal.aborted) setMoreError(err.message); }
    finally { if (seq === requestSeq.current) setMoreLoading(false); }
  };

  const screeningVisible = useMemo(() => {
    const base = filterByScreening(evidence.papers, tierFilter, tagFilters);
    const visibleIds = new Set(evidence.visible.map(paper => paper.citation.id));
    return base.filter(paper => visibleIds.has(paper.citation.id));
  }, [evidence.papers, evidence.visible, tierFilter, tagFilters]);

  const deskPapers = workspace.view === 'map' ? screeningVisible.slice(0, READING_DESK_LIMIT) : screeningVisible;
  const coverage = useMemo(() => literatureCoverage(evidence.papers), [evidence.papers]);
  useEffect(() => {
    if (!workspace.reveal) return;
    setGroupFilter('all'); setTierFilter('all'); setTagFilters([]); setInternalQuery(executedQuery);
  }, [workspace.reveal]);

  const displayedEvidence = useMemo(() => ({
    ...evidence,
    visible: deskPapers,
    counts: { ...evidence.counts, visible: deskPapers.length },
    trace: evidence.trace.map(step => step.key === "order" ? {
      ...step,
      value: step.value.replace(/\d[\d,]* shown$/, `${deskPapers.length.toLocaleString("en-GB")} shown`),
    } : step),
    displayed: deskPapers.map(paper => paper.citation),
  }), [evidence, screeningVisible, workspace.view]);

  // Hand the evidence model to shared state for the inspector. Guarded on what the inspector prints, so
  // a keystroke that changes nothing it shows does not re-render the whole inspector tree.
  const lastReportedKey = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([
      displayedEvidence.displayed.map(c => c.id),
      displayedEvidence.counts,
      displayedEvidence.trace,
      evidence.faults,
      evidence.scope,
      evidence.variantQuery,
      evidence.finding.headline,
      evidence.response,
    ]);
    if (key === lastReportedKey.current) return;
    lastReportedKey.current = key;
    onEvidenceChange?.(displayedEvidence);
  }, [evidence, displayedEvidence, onEvidenceChange]);

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

  const { counts, finding, facts, faults } = displayedEvidence;
  // Curated additions are shown but are not this query's records.
  const queryTotal = Math.max(0, counts.total - curatedAdded);
  const analysisConstraint = useVariantAnalysisStore(st => st.analysisState.result?.gnomadConstraint ?? null);
  const constraintStatus = useVariantAnalysisStore(st => st.analysisState.result?.serviceStatus?.gnomadConstraint ?? null);
  const constraint = useMemo<GeneConstraint | null>(() => analysisConstraint ? {
    pli: analysisConstraint.pli ?? null,
    loeuf: analysisConstraint.loeuf ?? null,
    missense_z: analysisConstraint.missense_z ?? null,
    oe_mis: analysisConstraint.oe_mis ?? null,
  } : null, [analysisConstraint]);
  const constraintUnavailableReason = constraintStatus === "error" || constraintStatus === "timeout"
    ? `${ENGINE_STATE_LABELS["upstream-error"]} — gnomAD gene constraint did not return for this result.`
    : constraintStatus === "pending"
      ? `${ENGINE_STATE_LABELS.running} — gnomAD gene constraint is still loading.`
      : `${ENGINE_STATE_LABELS["no-result"]} — gnomAD did not return gene constraint for this result.`;
  const variantHit = evidence.scope === "variant" ? (response?.degraded ? null : response?.hitCount ?? null) : probe.state === "done" ? probe.hitCount : null;
  const geneCount = evidence.scope === "gene" ? (response?.degraded ? null : response?.hitCount ?? null) : geneHitCount;
  const fmt = (v: number | null) => (v === null ? null : v.toLocaleString("en-GB"));

  const loadingFirst = isLoading && citations.length === 0;
  const nothingMatched = !isLoading && screeningVisible.length === 0;

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

            <Prose className="detail-prose lit-hero__finding">
              <strong>{finding.headline}</strong>
              {" "}
              {finding.predicate}.
            </Prose>

            {faults.map(fault => (
              <p key={fault} role="status" className="lit-callout" data-tone="warning">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{fault}</span>
              </p>
            ))}
          </div>

          <details className="lit-search-facts"><summary>Search coverage and engine record</summary><dl className="lit-facts">
            {facts.map(f => (
              <div key={f.label} className="lit-fact">
                <dt>{f.label}</dt>
                <dd>
                  <span className="lit-fact__value">{f.value}</span>
                  <span className="lit-fact__sub">{f.sub}</span>
                </dd>
              </div>
            ))}
          </dl></details>
        </section>

        <ReviewNavigation tab="literature" workspace={workspace} />
        <div role="tabpanel" id={`review-literature-panel-${workspace.view}`} aria-labelledby={`review-literature-tab-${workspace.view}`}>
        {workspace.view === 'map' && counts.total > 0 && <section className="lit-coverage" aria-labelledby="lit-coverage-title">
          <header><h2 id="lit-coverage-title">What the loaded text names</h2><p>{counts.total} loaded papers · literal title and abstract checks · select a group to explore</p></header>
          <div className="lit-coverage__rows">{coverage.filter(row => forms || row.level !== 'variant').map(row => <button type="button" key={row.level} aria-pressed={groupFilter === row.level} onClick={() => { setGroupFilter(groupFilter === row.level ? 'all' : row.level); setTierFilter('all'); setTagFilters([]); }}>
            <span>{row.level === 'variant' ? `Names ${forms?.label}` : row.level === 'gene' ? `Names ${forms ? 'only ' : ''}${gene}` : forms ? 'Neither in title / abstract' : `Does not name ${gene}`}</span>
            <span className="lit-coverage__track" aria-hidden="true"><i style={{ inlineSize: `${row.percent}%` }} /></span>
            <span className="lit-mono">{row.count}<small> / {row.total}</small></span>
          </button>)}</div>
          <p className="lit-coverage__note">These are mentions, not evidence of a paper’s conclusion. Curated additions are included in this loaded set; unreturned search matches are not screened.</p>
          {!forms && <p className="lit-coverage__note">Variant mentions were not checked: this notation is not supported by the protein-notation matcher.</p>}
        </section>}

        {/* ── 2. The papers ──────────────────────────────────────────────────────────────── */}
        <section className="lit-section" aria-labelledby="lit-papers-title">
          <h2 className="eyebrow" id="lit-papers-title">
            <Library className="w-3.5 h-3.5" />
            {workspace.view === 'map' ? 'Reading desk' : 'Source records'}
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

            <div className="lit-presets" aria-label="Focused search suggestions">
              <span>Explore:</span>
              {aliasQuery && <button type="button" className="lit-link" disabled={isLoading} onClick={() => runSearch(false, aliasQuery)}>Verified nucleotide aliases</button>}
              <button type="button" className="lit-link" disabled={isLoading} onClick={() => runSearch(false, `TITLE_ABS:${gene} AND (patient OR proband OR "case report" OR segregation)`)}>Clinical reports</button>
              <button type="button" className="lit-link" disabled={isLoading} onClick={() => runSearch(false, `TITLE_ABS:${gene} AND ("functional assay" OR "enzyme activity" OR "in vitro" OR rescue)`)}>Functional studies</button>
            </div>

            {counts.total > 0 && (
              <>
              <div className="lit-groups lit-tiers" role="group" aria-label="Filter by reading tier">
                {(["readFirst", "readNext", "all"] as TierFilter[]).map(tier => {
                  const count = tier === "readFirst" ? evidence.shortlist.readFirst : tier === "readNext" ? evidence.shortlist.readNext : evidence.counts.total;
                  const label = tier === "readFirst" ? "Read first" : tier === "readNext" ? "Read next" : "All loaded";
                  return <button key={tier} type="button" className="lit-group" aria-label={tier === "all" ? "Show all tiers" : undefined} aria-pressed={tierFilter === tier} disabled={tier !== "all" && count === 0} onClick={() => setTierFilter(tier)}>{label}<span className="lit-group__n">{count}</span></button>;
                })}
                <span className="lit-sort" role="group" aria-label="Sort papers">
                  <span>Sort:</span>
                  <button type="button" className="lit-group" aria-pressed={sortOrder === "attention"} onClick={() => setSortOrder("attention")}>Relevance</button>
                  <button type="button" className="lit-group" aria-pressed={sortOrder === "newest"} onClick={() => setSortOrder("newest")}>Newest</button>
                </span>
              </div>
              <details className="lit-filter-details">
                <summary>Refine papers{tagFilters.length || groupFilter !== "all" ? ` / ${tagFilters.length + Number(groupFilter !== "all")} active` : ""}</summary>
                <p className="lit-filter-note">Filters combine: a paper must match every selected observation and mention group. Counts describe the full loaded set.</p>
              <div className="lit-groups" role="group" aria-label="Filter by screening observation">
                {screeningFilters.map(({ tag, label }) => {
                  const count = evidence.shortlist.tags[tag];
                  const active = tagFilters.includes(tag);
                  return <button key={tag} type="button" className="lit-group" aria-pressed={active} disabled={count === 0} onClick={() => setTagFilters(current => active ? current.filter(item => item !== tag) : [...current, tag])}>{label}<span className="lit-group__n">{count}</span></button>;
                })}
              </div>
              <div className="lit-groups" role="group" aria-label="Filter by what the text check found">
                {(["all", ...(forms ? (["variant"] as const) : []), "gene", "elsewhere"] as GroupFilter[]).map(g => {
                  const n = g === "all" ? counts.total : counts[g];
                  return (
                    <button
                      key={g}
                      type="button"
                      className="lit-group"
                      aria-label={g === "all" ? "Show all text-check groups" : undefined}
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
                {(tagFilters.length > 0 || groupFilter !== "all") && <button type="button" className="lit-link lit-filter-clear" onClick={() => { setTagFilters([]); setGroupFilter("all"); }}>Clear refinements</button>}
              </details>
              </>
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
                ) : (tierFilter !== "all" || tagFilters.length > 0) && counts.total > 0 ? (
                  <>
                    <p className="lit-empty__title">No loaded paper matches these screening filters</p>
                    <p className="lit-empty__body">
                      The {counts.total} loaded papers do not combine the chosen tier and observations.{" "}
                      <button type="button" className="lit-link lit-link--btn lit-link--inline" onClick={() => { setTierFilter("all"); setTagFilters([]); }}>
                        Clear screening filters
                      </button>
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
                      {evidence.scope === "variant" && forms ? `No matches for these protein notations of ${forms.label}` : "No papers returned"}
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
              <PaperTable papers={deskPapers} gene={gene} forms={forms} onTogglePin={togglePin} constraint={constraint} constraintUnavailableReason={constraintUnavailableReason}
                selectedId={workspace.selected} onSelect={workspace.select} reveal={workspace.reveal} onRevealed={workspace.finishReveal} />
            )}

            {workspace.view === 'map' && screeningVisible.length > READING_DESK_LIMIT && <div className="lit-load-more">
              <span>Showing the first {READING_DESK_LIMIT} of {screeningVisible.length} matching loaded papers.</span>
              <button type="button" className="lit-link" onClick={() => workspace.setView('records')}>Show all matching source records</button>
            </div>}

            {moreError && <p className="lit-callout" role="alert" data-tone="warning">{moreError}</p>}
            {response?.nextCursor && !response.degraded && <div className="lit-load-more">
              <span>{queryTotal} query matches loaded{response.hitCount !== null ? ` of ${response.hitCount.toLocaleString("en-GB")}` : ""}. Screening covers these papers only.</span>
              <button type="button" className="lit-btn" disabled={moreLoading || isLoading} onClick={() => void loadMore()}>{moreLoading ? "Loading more..." : "Load 25 more"}</button>
            </div>}
            <div className="lit-card__foot">
              <span>
                Europe PMC · {counts.visible.toLocaleString("en-GB")} shown
                {response?.hitCount != null && !response.degraded && response.hitCount > queryTotal
                  ? ` · first ${queryTotal.toLocaleString("en-GB")} of ${response.hitCount.toLocaleString("en-GB")} query matches loaded`
                  : ""}
                {curatedAdded > 0 ? ` · ${curatedAdded.toLocaleString("en-GB")} from a curated variant record` : ""}
              </span>
              <span>{sortOrder === "attention" ? "Screening tiers 1–6; ties keep the supplied list order." : "Publication year, newest first."} Titles and abstracts checked.</span>
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
