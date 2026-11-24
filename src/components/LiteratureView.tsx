import { ResearchGuideButton } from "./knowledge/ResearchGuideButton";
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { buildLiteratureEvidence, parseVariantForms, variantSearchQuery, type Citation, type GroupFilter, type LiteratureEvidence, type PaperReading } from "../shared/literatureEvidence";
import { PaperTable } from "./literature/PaperTable";
import { filterByScreening, type TierFilter } from "./literature/screeningFilters";
import { Prose } from "./ui/Prose";
import type { GeneConstraint, ScreeningTagName } from "../shared/literatureScreening";
import { verifiedAliasQuery } from "../shared/literatureAliases";
import type { VerifiedLiteratureAlias } from "../shared/contracts";
import { ENGINE_STATE_LABELS } from "../shared/engineStatus";
import { literatureCoverage, literatureTextCoverage, READING_DESK_LIMIT } from "../shared/reviewPresentation";
import { ReviewNavigation, useReviewWorkspace } from "./review/ReviewWorkspace";
import { useLiteratureSearch } from "./literature/useLiteratureSearch";
import { LiteratureControls } from "./literature/LiteratureControls";
import { LiteratureCoverage } from "./literature/LiteratureCoverage";
import { LiteratureEmptyState } from "./literature/LiteratureEmptyState";

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

/**
 * Literature.
 *
 * ONE QUESTION: what has been published on this gene and this variant, how was that list obtained, and
 * which papers actually name the variant? A finding, then two reading views:
 *
 *   1. THE FINDING — how many Europe PMC records name the variant (a background search answers it on
 *      load), stating the query's reach and limits.
 *   2. READING DESK exposes a bounded bibliography with an explicit expand control. Its controls are two
 *      groups: what to ask Europe PMC, and what to show from the papers already loaded.
 *      MENTION COVERAGE owns the loaded-text figure without duplicating the bibliography.
 *   3. THE TRACE — persistent selected source, query as sent, matches and loaded records in the rail.
 */
export default function LiteratureView({
  gene, variant = "", uniprotId = "", searchQuery = "", verifiedAliases, onSearchQueryChange, onEvidenceChange, searchVersion = 0,
}: LiteratureViewProps) {
  const workspace = useReviewWorkspace("literature");
  const defaultTierApplied = useRef(false);
  const reportCitations = useVariantAnalysisStore(st => st.reportCitations);
  const pinReportCitation = useVariantAnalysisStore(st => st.pinReportCitation);
  const unpinReportCitation = useVariantAnalysisStore(st => st.unpinReportCitation);
  const pinnedIds = useMemo(() => new Set(reportCitations.map(c => c.id)), [reportCitations]);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [sortOrder, setSortOrder] = useState<"attention" | "newest">("attention");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [tagFilters, setTagFilters] = useState<ScreeningTagName[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const forms = useMemo(() => parseVariantForms(variant), [variant]);
  const aliasQuery = verifiedAliasQuery(gene, variant, uniprotId, verifiedAliases ?? []);
  const variantQuery = useMemo(() => variantSearchQuery(gene, forms), [gene, forms]);

  const onResetFilters = useCallback(() => {
    defaultTierApplied.current = false;
    setGroupFilter("all");
    setTierFilter("all");
    setTagFilters([]);
  }, []);

  const search = useLiteratureSearch({ gene, variant, uniprotId, searchQuery, searchVersion, variantQuery, onSearchQueryChange, onResetFilters });
  const { citations, curatedCoverage, curatedAdded, isLoading, error, internalQuery, setInternalQuery, setRevealedDraft, executedQuery, response, moreLoading, moreError, probe, geneHitCount, fetchCitations, runSearch, loadMore, activeFilter, executedFilter, isNarrowingFilter } = search;

  const evidence = useMemo(() => buildLiteratureEvidence({
    gene, variant: variant || null, citations, response, executedQuery,
    narrowingFilter: isNarrowingFilter ? activeFilter : "", groupFilter, pinnedIds, probe,
    load: isLoading ? "loading" : error && citations.length === 0 ? "error" : response ? "ready" : "idle",
    error, sortOrder, curated: curatedCoverage, curatedAdded,
  }), [gene, variant, citations, response, executedQuery, isNarrowingFilter, activeFilter, groupFilter, pinnedIds, probe, isLoading, error, sortOrder, curatedCoverage, curatedAdded]);

  const loadedSetKey = citations.map(citation => citation.id).join("|");
  useLayoutEffect(() => {
    if (!citations.length || defaultTierApplied.current) return;
    defaultTierApplied.current = true;
    setTierFilter(evidence.shortlist.readFirst > 0 ? "readFirst" : evidence.shortlist.readNext > 0 ? "readNext" : "all");
  }, [loadedSetKey]);

  const screeningVisible = useMemo(() => {
    const base = filterByScreening(evidence.papers, tierFilter, tagFilters);
    const visibleIds = new Set(evidence.visible.map(paper => paper.citation.id));
    return base.filter(paper => visibleIds.has(paper.citation.id));
  }, [evidence.papers, evidence.visible, tierFilter, tagFilters]);

  const readingDeskCount = workspace.allPapers ? screeningVisible.length : Math.min(screeningVisible.length, READING_DESK_LIMIT);
  const deskPapers = useMemo(() => workspace.view !== "map" ? [] : workspace.allPapers ? screeningVisible : screeningVisible.slice(0, READING_DESK_LIMIT), [screeningVisible, workspace.view, workspace.allPapers]);
  const coverage = useMemo(() => literatureCoverage(evidence.papers).filter(row => forms || row.level !== "variant"), [evidence.papers, forms]);
  const textCoverage = useMemo(() => literatureTextCoverage(evidence.papers), [evidence.papers]);
  useEffect(() => {
    if (!workspace.reveal) return;
    setGroupFilter("all"); setTierFilter("all"); setTagFilters([]); setRevealedDraft(internalQuery);
  }, [workspace.reveal]);

  // A missing DOM target may still be hidden by filters. Cancel only when the completed
  // loaded set no longer contains the source, so a later search cannot steal focus.
  useEffect(() => {
    if (workspace.reveal && !isLoading && !evidence.papers.some(paper => paper.citation.id === workspace.selected)) workspace.finishReveal();
  }, [workspace.reveal, workspace.selected, isLoading, evidence.papers]);

  const displayedEvidence = useMemo(() => ({
    ...evidence,
    visible: deskPapers,
    counts: { ...evidence.counts, visible: deskPapers.length },
    trace: evidence.trace.map(step => step.key === "order" ? {
      ...step,
      value: step.value.replace(/\d[\d,]* shown$/, workspace.view === "map" ? `${deskPapers.length.toLocaleString("en-GB")} shown` : `${readingDeskCount.toLocaleString("en-GB")} on reading desk`),
    } : step),
    displayed: deskPapers.map(paper => paper.citation),
  }), [evidence, deskPapers, workspace.view, readingDeskCount]);

  // Hand the evidence model to shared state for the inspector. Guarded on what the inspector prints, so
  // a keystroke that changes nothing it shows does not re-render the whole inspector tree.
  const lastReportedKey = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify([displayedEvidence.displayed.map(c => c.id), displayedEvidence.counts, displayedEvidence.trace, evidence.faults, evidence.scope, evidence.variantQuery, evidence.finding, evidence.response]);
    if (key === lastReportedKey.current) return;
    lastReportedKey.current = key;
    onEvidenceChange?.(displayedEvidence);
  }, [evidence, displayedEvidence, onEvidenceChange]);

  const togglePin = (paper: PaperReading) => {
    const c = paper.citation;
    if (paper.pinned) unpinReportCitation(c.id);
    else pinReportCitation({ id: c.id, title: c.title, authors: c.authors, journal: c.journal, year: c.year, url: /^https?:\/\//i.test(c.url ?? "") ? (c.url as string) : null });
  };

  const { counts, finding, faults, queryTotal } = displayedEvidence;
  const analysisConstraint = useVariantAnalysisStore(st => st.analysisState.result?.gnomadConstraint ?? null);
  const constraintStatus = useVariantAnalysisStore(st => st.analysisState.result?.serviceStatus?.gnomadConstraint ?? null);
  const constraint = useMemo<GeneConstraint | null>(() => analysisConstraint ? {
    pli: analysisConstraint.pli ?? null, loeuf: analysisConstraint.loeuf ?? null, missense_z: analysisConstraint.missense_z ?? null, oe_mis: analysisConstraint.oe_mis ?? null,
  } : null, [analysisConstraint]);
  const constraintUnavailableReason = constraintStatus === "error" || constraintStatus === "timeout"
    ? `${ENGINE_STATE_LABELS["upstream-error"]} — gnomAD gene constraint did not return for this result.`
    : constraintStatus === "pending"
      ? `${ENGINE_STATE_LABELS.running} — gnomAD gene constraint is still loading.`
      : `${ENGINE_STATE_LABELS["no-result"]} — gnomAD did not return gene constraint for this result.`;

  const loadingFirst = isLoading && citations.length === 0;
  const nothingMatched = !isLoading && screeningVisible.length === 0;
  const openReadingDesk = () => { workspace.setView("map"); document.getElementById("review-literature-tab-map")?.focus(); };

  return (
    <div className="lit-view">
      <div className="lit-screen @container">
        <header>
          <h1 className="screen-title">Literature</h1>
          <ResearchGuideButton topic="literature" label="How to assess a paper’s relevance" />
          <p className="screen-tab-description">What Europe PMC holds on {gene || "this gene"}{forms ? ` and ${forms.label}` : ""}, how the list was obtained, and which papers name the variant.</p>
        </header>

        {/* ── 1. The finding ─────────────────────────────────────────────────────────────── */}
        <section className="lit-hero" aria-label="Published literature finding" data-testid="literature-finding">
          <div className="lit-hero__figure">
            <span className="figure-headline lit-figure" data-testid="literature-figure">{finding.figure}</span>
            <span className="lit-hero__figure-label">{finding.figureLabel}</span>
            <span className="ev-tier" data-tone="muted" title="The ACMG rule engine reads no literature: nothing on this tab is counted in the verdict.">Not counted in the ACMG verdict</span>
          </div>
          <Prose className="detail-prose lit-hero__finding">{finding.headline && <><strong>{finding.headline}</strong>{" "}</>}{finding.predicate}.</Prose>
          {faults.map(fault => (
            <p key={fault} role="status" className="lit-callout" data-tone="warning"><AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /><span>{fault}</span></p>
          ))}
        </section>

        <ReviewNavigation tab="literature" workspace={workspace} />
        <div role="tabpanel" id={`review-literature-panel-${workspace.view}`} aria-labelledby={`review-literature-tab-${workspace.view}`}>
          {workspace.view === "records" && (
            <LiteratureCoverage
              gene={gene} forms={forms} total={counts.total} curatedAdded={curatedAdded} coverage={coverage} textCoverage={textCoverage}
              isLoading={isLoading} error={error}
              onSelectGroup={level => { setGroupFilter(level); setTierFilter("all"); setTagFilters([]); setFiltersOpen(true); openReadingDesk(); }}
              onOpenReadingDesk={openReadingDesk}
            />
          )}

          {/* ── 2. The papers ──────────────────────────────────────────────────────────────── */}
          {workspace.view === "map" && (
            <section aria-labelledby="lit-papers-title">
              {/* The visible name is the selected tab; this keeps the section named for screen readers. */}
              <h2 className="sr-only" id="lit-papers-title">Reading desk</h2>
              <div data-testid="literature-papers">
                <LiteratureControls
                  gene={gene} forms={forms} variantQuery={variantQuery} aliasQuery={aliasQuery} evidence={evidence} response={response} probe={probe}
                  geneHitCount={geneHitCount} isLoading={isLoading} internalQuery={internalQuery} executedFilter={executedFilter}
                  onDraftChange={value => { setRevealedDraft(null); setInternalQuery(value); }} onRunSearch={runSearch}
                  tierFilter={tierFilter} onTierFilterChange={setTierFilter} tagFilters={tagFilters}
                  onToggleTag={tag => setTagFilters(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag])}
                  groupFilter={groupFilter} onGroupFilterChange={setGroupFilter}
                  onClearFilters={() => { setTagFilters([]); setGroupFilter("all"); }}
                  filtersOpen={filtersOpen} onToggleFiltersOpen={() => setFiltersOpen(open => !open)}
                  sortOrder={sortOrder} onSortOrderChange={setSortOrder}
                />

                {error && (
                  <div role="alert" className="lit-callout lit-callout--banner" data-tone="warning">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      <strong>Europe PMC search failed.</strong> {error}
                      {citations.length > 0 && " The previously loaded list is still shown below."}
                      {" "}
                      <button type="button" className="lit-link lit-link--btn lit-link--inline" onClick={() => void fetchCitations(false, executedQuery || undefined)}>Try again</button>
                    </span>
                  </div>
                )}

                {loadingFirst || (nothingMatched && !error) ? (
                  <LiteratureEmptyState
                    loadingFirst={loadingFirst} gene={gene} forms={forms} total={counts.total} isNarrowingFilter={isNarrowingFilter}
                    activeFilter={activeFilter} executedFilter={executedFilter} scope={evidence.scope} tierFilter={tierFilter}
                    tagFilters={tagFilters} groupFilter={groupFilter} onClearScreeningFilters={() => { setTierFilter("all"); setTagFilters([]); }}
                  />
                ) : (
                  <PaperTable papers={deskPapers} gene={gene} forms={forms} onTogglePin={togglePin} constraint={constraint} constraintUnavailableReason={constraintUnavailableReason}
                    selectedId={workspace.selected} onSelect={workspace.select} reveal={groupFilter === "all" && tierFilter === "all" && !tagFilters.length && !isNarrowingFilter ? workspace.reveal : 0} onRevealed={workspace.finishReveal} />
                )}

                {moreError && <p className="lit-callout" role="alert" data-tone="warning">{moreError}</p>}
                {counts.total > 0 && (
                  <div className="lit-list-foot" data-testid="literature-list-foot">
                    <p>
                      {[
                        screeningVisible.length > 0 ? `Showing ${deskPapers.length.toLocaleString("en-GB")} of ${screeningVisible.length.toLocaleString("en-GB")} matching ${screeningVisible.length === 1 ? "paper" : "papers"}` : null,
                        response?.degraded
                          ? `${queryTotal.toLocaleString("en-GB")} cached ${queryTotal === 1 ? "paper" : "papers"}`
                          : `${queryTotal.toLocaleString("en-GB")}${response?.hitCount != null ? ` of ${response.hitCount.toLocaleString("en-GB")}` : ""} Europe PMC ${(response?.hitCount ?? queryTotal) === 1 ? "match" : "matches"} loaded`,
                        curatedAdded > 0 ? `${curatedAdded.toLocaleString("en-GB")} added from a curated variant record` : null,
                        counts.pinned > 0 ? `${counts.pinned.toLocaleString("en-GB")} in the report` : null,
                      ].filter(Boolean).join(" · ")}. Screening covers loaded papers only.
                    </p>
                    <div className="lit-list-foot__actions">
                      {screeningVisible.length > READING_DESK_LIMIT && (
                        <button type="button" className="lit-btn lit-btn--quiet" onClick={() => workspace.setAllPapers(!workspace.allPapers)}>{workspace.allPapers ? `Show first ${READING_DESK_LIMIT}` : "Show all matching papers"}</button>
                      )}
                      {response?.nextCursor && !response.degraded && (
                        <button type="button" className="lit-btn lit-btn--quiet" disabled={moreLoading || isLoading} onClick={() => void loadMore()}>{moreLoading ? "Loading more..." : "Load 25 more"}</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
