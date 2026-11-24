import React, { useState, useEffect, useRef } from "react";
import { Check, Database, ExternalLink, FileText, GitBranch, RotateCcw, Search, Sparkles } from "lucide-react";
import { paperIdentifier, type LiteratureEvidence } from "../../shared/literatureEvidence";
import { SUMMARY_CITATION_LIMIT, summaryScopeRows } from "../../shared/literatureSummary";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { useReviewWorkspace } from "../review/ReviewWorkspace";
import { tagsByQuote } from "../literature/ScreeningChips";
import { INSPECTOR_SECTIONS } from "../../lib/inspectorFocus";
import { safeExternalHref } from "../../shared/externalLink";
import { LiteratureExportSection } from "./LiteratureExportSection";

export { shortlistRecords, toBibtex, toRis, toCsv } from "./literatureExport";

interface LiteratureInspectorProps {
  gene: string;
  variant: string;
  searchQuery?: string;
  onSearch?: (query: string) => void;
  /** The Literature view's evidence model (filters applied). The trace, the query box and the export
   *  all read it, so the rail can never describe a different search from the list. The export
   *  serialises `evidence.displayed` — never canned data. */
  evidence?: LiteratureEvidence | null;
}

function Step({ n, label, state = "done", last = false, children }: { n: number; label: string; state?: "done" | "warn" | "idle"; last?: boolean; children: React.ReactNode }) {
  return (
    <li className="rail-step" data-state={state} data-last={last || undefined}>
      <span className="rail-step__n" aria-hidden="true">{n}</span>
      <div className="rail-step__body">
        <span className="rail-step__label">{label}</span>
        <span className="rail-step__value">{children}</span>
      </div>
    </li>
  );
}

const formatSweep = (ms: number | null) =>
  ms === null
    ? null
    : new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Literature tools — the trace behind the list.
 *
 * It renders the SAME `LiteratureEvidence` model as the tab, so the two cannot describe different
 * searches. The query box used to be pre-filled with a client-built default that was never the query
 * that ran; the trace now prints the string the server sent, and the box below it edits from there.
 */
export const LiteratureInspector: React.FC<LiteratureInspectorProps> = ({
  gene,
  variant,
  searchQuery = "",
  onSearch,
  evidence
}) => {
  const workspace = useReviewWorkspace("literature");
  const summaryReceipt = useVariantAnalysisStore(st => {
    const result = st.analysisState.result;
    return result?.metadata?.gene === gene && result.metadata.variant === variant && !result.isFallback ? result.insights?.literature : undefined;
  });
  const suggestion = evidence?.variantQuery ?? `${gene || "GENE"} AND (mutation OR variant)`;
  const [customQuery, setCustomQuery] = useState(searchQuery || suggestion);
  const [justApplied, setJustApplied] = useState(false);
  const appliedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCustomQuery(searchQuery || suggestion);
    // `suggestion` is in the list on purpose: the evidence model arrives after the first render, so
    // the box would otherwise keep the generic fallback instead of the variant query.
  }, [gene, variant, searchQuery, suggestion]);

  // Clear a pending "applied" reset on unmount rather than firing setState into a dead
  // tree; clearing before re-arming also keeps one confirmation from firing twice.
  useEffect(() => () => {
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
  }, []);

  const flashApplied = () => {
    setJustApplied(true);
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    appliedTimerRef.current = window.setTimeout(() => setJustApplied(false), 2500);
  };

  const handleApplySearch = () => {
    onSearch?.(customQuery);
    flashApplied();
  };

  // Back to the gene-wide default: an empty query is what the server reads as "the default".
  const handleResetQuery = () => {
    setCustomQuery(suggestion);
    onSearch?.("");
    flashApplied();
  };

  const readings = evidence?.visible ?? [];
  const sentQuery = evidence?.response?.europePmcQuery ?? null;
  const notSearched = searchQuery.trim() === "" && customQuery === suggestion;
  const sweep = formatSweep(evidence?.response?.fetchedAt ?? null);
  const selected = evidence?.papers.find(paper => paper.citation.id === workspace.selected);
  const selectionHidden = workspace.view === "map" && Boolean(selected && !readings.some(paper => paper.citation.id === workspace.selected));

  return (
    <div className="lit-rail" data-testid="literature-rail">
      <section className="review-selection" id={INSPECTOR_SECTIONS.evidenceReading} tabIndex={-1} aria-label="Selected paper">
        <div className="review-selection__head"><span className="eyebrow"><FileText size={13} aria-hidden="true" />{workspace.selected ? "Selected source" : "Explore a source"}</span>{workspace.selected && <button type="button" className="review-action" onClick={() => workspace.select(null)}>Clear selection</button>}</div>
        <div className="review-selection__body">
          {selected ? <><h3>{selected.citation.title}</h3><p className="lit-mono">{selected.identifier.label} · {selected.citation.year ?? "Year not reported"}</p>
            <p>{selected.citation.journal || "Journal not reported"}</p>
            <p>Reading tier {selected.screening.tier} · a screening priority, not a quality score.</p>
            <p>{selected.pinned ? "Added to the report." : "Not added to the report."}</p>
            {selectionHidden && <p className="lit-rail__warn">This paper is outside the current reading desk or filters. Its source remains selected.</p>}
            {tagsByQuote(selected.screening.tags).map(tag => <blockquote key={tag.quote}><span>{tag.label} · {tag.source.replace(/-/g, " ")}</span><p>{tag.quote}</p></blockquote>)}
            <details><summary>Abstract</summary><p>{selected.citation.abstract || "Europe PMC returned no abstract for this record."}</p></details>
            <div className="review-selection__actions"><button type="button" className="review-action" onClick={workspace.showSelected}>Show selected source record</button><a className="lit-link" href={selected.href} target="_blank" rel="noopener noreferrer">Open paper<span className="sr-only"> (opens in a new tab)</span></a></div></>
            : <p>{workspace.selected ? "The selected paper is not in this search result. Clear the selection or select another loaded source." : "Select a paper to inspect its quoted observations and abstract here. Adding it to the report is a separate action."}</p>}
        </div>
      </section>
      {/* ── 1. How the list was obtained ── */}
      <section className="rail-section" aria-labelledby="lit-rail-trace">
        <h3 className="eyebrow" id="lit-rail-trace">
          <GitBranch className="w-3.5 h-3.5" />
          Search trace
        </h3>
        {evidence ? (
          <ol className="rail-steps" data-testid="search-trace">
            {evidence.trace.map((step, i) => (
              <Step key={step.key} n={i + 1} label={step.label} state={step.state} last={i === evidence.trace.length - 1}>
                <span className={step.mono ? "lit-mono lit-break" : undefined} data-testid={`trace-${step.key}`}>{step.value}</span>
                {step.sub && <span className="rail-step__sub">{step.sub}</span>}
              </Step>
            ))}
          </ol>
        ) : (
          <p className="lit-rail__empty">No search has run yet.</p>
        )}
      </section>

      {/* ── 2. Change the search ── */}
      <section className="rail-section" aria-labelledby="lit-rail-query">
        <h3 className="eyebrow" id="lit-rail-query">
          <Search className="w-3.5 h-3.5" />
          Change the search
          {customQuery !== suggestion && (
            <button type="button" className="lit-rail__reset" onClick={handleResetQuery} title="Back to the gene-wide default">
              <RotateCcw aria-hidden="true" />
              Reset
            </button>
          )}
        </h3>
        <label className="lit-rail__field" htmlFor="lit-rail-query-input">
          {notSearched ? "Suggested query — not run yet" : "Query (plain Europe PMC syntax)"}
        </label>
        <textarea
          id="lit-rail-query-input"
          value={customQuery}
          onChange={e => setCustomQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleApplySearch();
            }
          }}
          rows={3}
          spellCheck={false}
          placeholder="Enter a Europe PMC query…"
        />
        <button type="button" className="lit-btn lit-btn--block lit-btn--quiet" onClick={handleApplySearch} aria-live="polite">
          {justApplied ? <Check aria-hidden="true" /> : <Search aria-hidden="true" />}
          {justApplied ? "Applied to the list" : "Run this query"}
        </button>
        <p className="rail-step__sub">Enter applies; Shift+Enter adds a line. The gene is added to any query that does not name it.</p>
      </section>

      {/* ── 3. Export ── */}
      <LiteratureExportSection
        gene={gene}
        variant={variant}
        searchQuery={searchQuery}
        evidence={evidence}
        view={workspace.view}
        onOpenReadingDesk={() => {
          workspace.setView("map");
          document.getElementById("review-literature-tab-map")?.focus();
        }}
      />

      {/* ── 4. What reads this list ── */}
      <section className="rail-section" aria-labelledby="lit-rail-reads">
        <h3 className="eyebrow" id="lit-rail-reads">
          <Sparkles className="w-3.5 h-3.5" />
          What reads this list
        </h3>
        <dl className="rail-kv lit-rail__reads">
          <div className="rail-kv__row"><dt>ACMG engine</dt><dd>Nothing. No criterion is scored from literature.</dd></div>
          <div className="rail-kv__row"><dt>AI summary</dt><dd>Up to {SUMMARY_CITATION_LIMIT} relevant abstracts from bounded gene, protein-notation and clinical/functional searches plus curated links. Ordered by screening tier, then available similarity and date. Searches here do not change the summary.</dd></div>
          <div className="rail-kv__row"><dt>Screener</dt><dd>Reads titles and abstracts to order this list. It is not evidence and enters no ACMG criterion.</dd></div>
          <div className="rail-kv__row"><dt>Report</dt><dd>Only papers you pin.</dd></div>
        </dl>
      </section>

      {/* ── 5. Method ── */}
      <section className="rail-section" aria-labelledby="lit-rail-summary-inputs">
        <h3 className="eyebrow" id="lit-rail-summary-inputs"><Sparkles className="w-3.5 h-3.5" />Summary inputs</h3>
        {summaryReceipt ? <>
          <p className="lit-rail__lead">{summaryReceipt.citations.length} {summaryReceipt.citations.length === 1 ? "abstract" : "abstracts"} supplied to the current AI narrative. Selection is separate from this tab&apos;s filters.</p>
          <ol className="lit-summary-papers">{summaryReceipt.citations.map(c => <li key={c.id}><a className="lit-link" href={safeExternalHref(c.url) ?? `https://europepmc.org/search?query=${encodeURIComponent(c.id)}`} target="_blank" rel="noopener noreferrer">{c.title}</a><span className="lit-dim lit-mono">{paperIdentifier(c.id).label} · reading tier {c.tier}</span></li>)}</ol>
          <dl className="rail-kv lit-rail__reads">{summaryScopeRows(summaryReceipt).map(row => <div className="rail-kv__row" key={row.label}><dt>{row.label}</dt><dd>{row.text}</dd></div>)}</dl>
        </> : <p className="lit-rail__lead">Summary inputs are not recorded for this result. Generate a new AI narrative to inspect its selected abstracts.</p>}
      </section>

      <section className="rail-section" aria-labelledby="lit-rail-method">
        <details className="rail-notes">
          <summary id="lit-rail-method">Method notes</summary>
          <ul>
            <li>Europe PMC searches titles, abstracts and open-access full text. A record can match without the gene appearing in its abstract; the match location is unknown unless its title or abstract names the gene.</li>
            <li>“Names the variant” is a literal match of the notations listed in the trace, in the title or abstract. It does not read full text, tables or figures, nucleotide (c.) notation, or gene aliases.</li>
            <li>The naming count in the finding comes from a second, background search for the variant notations. It is cached like any search, and if it fails the tab says so instead of showing a zero.</li>
            <li>A record that names the variant reports nothing about its finding. Read it before relying on it.</li>
            <li>Screening reads <strong>titles and abstracts only</strong> — no full text, tables or figures.</li>
            <li>It is <strong>lexical, not semantic</strong>: it reports that assay language is present, not that an assay was performed on this variant, and not what it found.</li>
            <li>Tiers are an ordering rule, not a quality judgement; no journal metric is computed or shown.</li>
            <li>No screening tag is evidence, and none enters the ACMG verdict.</li>
            <li>On the AI-summary side: the summary is prose grounded in cited abstracts; a citation in it is not an assertion that a paper supports the narrative’s claims.</li>
          </ul>
        </details>
      </section>

      {/* ── 6. Sources ── */}
      <section className="rail-section" aria-labelledby="lit-rail-sources">
        <h3 className="eyebrow" id="lit-rail-sources">
          <Database className="w-3.5 h-3.5" />
          Sources
        </h3>
        <dl className="rail-kv rail-kv--sources">
          <div className="rail-kv__row">
            <dt>Europe PMC</dt>
            <dd>
              <a className="lit-link" href="https://europepmc.org/" target="_blank" rel="noopener noreferrer">
                REST search, core records<ExternalLink aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            </dd>
          </div>
          <div className="rail-kv__row"><dt>Sweep completed</dt><dd>{sweep ?? "Not reported"}</dd></div>
          <div className="rail-kv__row">
            <dt>Reference</dt>
            <dd>
              <a className="lit-link" href="https://doi.org/10.1093/nar/gkaa994" target="_blank" rel="noopener noreferrer">
                Europe PMC in 2020<ExternalLink aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            </dd>
          </div>
        </dl>
        {sentQuery === null && evidence && evidence.load === "ready" && (
          <p className="rail-step__sub">This server did not report the query it sent.</p>
        )}
      </section>
    </div>
  );
};

export default React.memo(LiteratureInspector);
