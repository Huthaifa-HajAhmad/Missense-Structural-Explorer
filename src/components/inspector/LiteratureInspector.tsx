import React, { useState, useEffect, useRef } from "react";
import { Check, Database, Download, ExternalLink, GitBranch, RotateCcw, Search, Sparkles } from "lucide-react";
import type { Citation, LiteratureEvidence, PaperReading } from "../../shared/literatureEvidence";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { LEXICON_VERSION } from "../../shared/literatureScreening";
import { curatedLinkLabel } from "../../shared/curatedLiterature";

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

/* ── Citation serializers ──────────────────────────────────────────────────
 * Each operates on the citations the user can actually see in the Literature
 * view, with field-level escaping appropriate to the format. Exported for the
 * unit tests in ./__tests__/literatureExport.test.ts. */

const splitAuthors = (authors: string): string[] =>
  authors.split(",").map(a => a.trim()).filter(Boolean);

/**
 * "Wang W" → "Wang, W" — the surname-first form BibTeX and RIS expect.
 *
 * Europe PMC author strings put the given name last ("van der Burg A"), and the
 * surname itself may be multi-word (particles). Splitting on the *first* space
 * mangled those: "van der Burg A" became "van, der Burg A". Instead the trailing
 * initial-like tokens are treated as the given name and everything before them as
 * the surname. Names with no trailing initials — consortium names ("The GTEx
 * Consortium") or full given names — are left intact: with no initial to anchor on,
 * any comma we inserted would cut the surname at the wrong boundary.
 */
const NAME_SUFFIX = /^(Jr|Sr|II|III|IV|V)\.?$/i;
const GIVEN_INITIAL = /^[A-Z]{1,4}\.?$/;
const toSurnameFirst = (name: string): string => {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2) return name;
  // Set "Smith J Jr." aside so the suffix does not read as the given name.
  const suffix: string[] = [];
  while (tokens.length > 2 && NAME_SUFFIX.test(tokens[tokens.length - 1])) {
    suffix.unshift(tokens.pop() as string);
  }
  let cut = tokens.length;
  while (cut > 1 && GIVEN_INITIAL.test(tokens[cut - 1])) cut--;
  if (cut === tokens.length) return name;
  const head = tokens.slice(0, cut).join(" ");
  const tail = [...tokens.slice(cut), ...suffix].join(" ");
  return `${head}, ${tail}`;
};

/**
 * BibTeX special characters that must be escaped. Beyond the classic `\\{}%&` set,
 * `#$ _` break compilation when a title is typeset, and bare `~`/`^` are TeX accent
 * macros that error without an argument — hence the `\textasciitilde{}` /
 * `\textasciicircum{}` forms instead of a backslash.
 */
const bibtexEscape = (text: string): string =>
  text
    .replace(/([\\{}%&#_$])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");

const exportKey = (c: Citation): string =>
  (/^\d+$/.test(c.id) ? `pmid${c.id}` : c.id.replace(/[^A-Za-z0-9]/g, "")) || "citation";

/* Two records whose ids differ only in stripped punctuation (e.g. PPR ids) would
 * otherwise emit the same key; de-duplicate per export so every entry stays keyed. */
const uniqueKeys = (list: Citation[]): string[] => {
  const seen = new Set<string>();
  return list.map((c) => {
    const base = exportKey(c);
    let key = base;
    let n = 2;
    while (seen.has(key)) key = `${base}${n++}`;
    seen.add(key);
    return key;
  });
};

const identifierLabel = (id: string): string => (/^\d+$/.test(id) ? `PMID: ${id}` : `ID: ${id}`);

type ExportItem = Citation | PaperReading;
interface ExportHeader { query: string; lexiconVersion: number; date: string; }
const citationOf = (item: ExportItem): Citation => "citation" in item ? item.citation : item;
const screeningOf = (item: ExportItem) => "screening" in item ? item.screening : null;
/**
 * Curated record relationships on the record, as provenance — label, provider id and the provider's own
 * URL. Deliberately not a quote and not a screening tag; the export keeps the two apart the same way the
 * table does.
 */
const curatedNote = (item: ExportItem): string => {
  const links = citationOf(item).curatedLinks ?? [];
  return links
    .map(link => `${curatedLinkLabel(link.provider)} [PMID ${link.pmid}${link.featureId ? ` ${link.featureId}` : ""}]: ${link.sourceUrl}`)
    .join(" | ");
};
const exportNote = (item: ExportItem): string => {
  const screening = screeningOf(item);
  const curated = curatedNote(item);
  const parts: string[] = [];
  if (screening) parts.push(`tier ${screening.tier}; tags ${screening.tags.map(tag => `${tag.tag} [${tag.source}]: ${tag.quote}`).join(" | ")}`);
  if (curated) parts.push(`curated: ${curated}`);
  return parts.join("; ");
};
/** The export action is deliberately based on the attention rule, not a currently selected table filter. */
export const shortlistRecords = (papers: readonly PaperReading[]): PaperReading[] => papers.filter(paper => paper.screening.tier <= 4);
const headerText = (header: ExportHeader) => `Query: ${header.query}; Lexicon version: ${header.lexiconVersion}; Date: ${header.date}`;

export const toBibtex = (list: readonly ExportItem[], header?: ExportHeader): string => {
  const citations = list.map(citationOf);
  const keys = uniqueKeys(citations);
  const prefix = header ? `@comment{${bibtexEscape(headerText(header))}}\n\n` : "";
  return `${prefix}${citations.map((c, i) => {
    const note = [identifierLabel(c.id), exportNote(list[i])].filter(Boolean).join("; ");
    const fields = [
      `  author  = {${splitAuthors(c.authors).map(toSurnameFirst).map(bibtexEscape).join(" and ")}}`,
      `  title   = {${bibtexEscape(c.title)}}`,
      `  journal = {${bibtexEscape(c.journal)}}`,
      ...(c.year ? [`  year    = {${c.year}}`] : []),
      ...(c.url ? [`  url     = {${bibtexEscape(c.url)}}`] : []),
      `  note    = {${bibtexEscape(note)}}`
    ];
    return `@article{${keys[i]},\n${fields.join(",\n")}\n}`;
  }).join("\n\n")}\n`;
};

/** RIS is line-oriented: a newline inside a value would start a bogus record line. */
const risLine = (text: string): string => text.replace(/\s*\r?\n\s*/g, " ");

export const toRis = (list: readonly ExportItem[], header?: ExportHeader): string =>
  `${header ? `N1  - ${risLine(headerText(header))}\n\n` : ""}${list.map(item => {
    const c = citationOf(item);
    const lines = [
      "TY  - JOUR",
      `TI  - ${risLine(c.title)}`,
      ...splitAuthors(c.authors).map(a => `AU  - ${toSurnameFirst(a)}`),
      `JO  - ${risLine(c.journal)}`,
      ...(c.abstract ? [`AB  - ${risLine(c.abstract)}`] : []),
      ...(c.year ? [`PY  - ${c.year}`] : []),
      ...(c.url ? [`UR  - ${c.url}`] : []),
      ...(exportNote(item) ? [`N1  - ${risLine(exportNote(item))}`] : []),
      `AN  - ${c.id}`,
      "ER  - "
    ];
    return lines.join("\n");
  }).join("\n\n")}\n`;

/** Quote a CSV field only when it needs it; double internal quotes (RFC 4180). */
const csvCell = (value: string | number | null | undefined): string => {
  let text = value === null || value === undefined ? "" : String(value);
  // Neutralize formula injection: Excel/Sheets *execute* a cell beginning with =, +, -
  // @ (or a leading tab/CR) instead of displaying it, turning a citation title into
  // arbitrary spreadsheet formula. The leading apostrophe is inert and is not shown
  // by spreadsheet apps.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (list: readonly ExportItem[], gene: string, variant: string, exportHeader?: ExportHeader): string => {
  const header = ["Gene", "Variant", "ID", "Title", "Authors", "Journal", "Year", "URL", "Tier", "Screening tags", "Curated links"];
  const rows = list.map(item => {
    const c = citationOf(item);
    const screening = screeningOf(item);
    return [gene, variant, c.id, c.title, c.authors, c.journal, c.year ?? "", c.url ?? "", screening?.tier ?? "", screening ? screening.tags.map(tag => `${tag.tag} [${tag.source}]: ${tag.quote}`).join(" | ") : "", curatedNote(item)]
      .map(csvCell)
      .join(",");
  });
  // CRLF line endings keep Excel happy when a field contains quotes or newlines.
  const preamble = exportHeader ? [`# Query,${csvCell(exportHeader.query)}`, `# Lexicon version,${exportHeader.lexiconVersion}`, `# Date,${csvCell(exportHeader.date)}`] : [];
  return `${[...preamble, header.join(","), ...rows].join("\r\n")}\r\n`;
};

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
  // The shortlist is defined by the shared attention rule, not by whichever tier/filter the reader
  // happens to have selected in the table. Otherwise the default Read first view could silently omit
  // every Read next record from an action explicitly labelled "Export shortlist".
  const shortlistReadings = evidence ? shortlistRecords(evidence.papers) : [];
  const citationCount = readings.length;
  const sentQuery = evidence?.response?.europePmcQuery ?? null;
  const notSearched = searchQuery.trim() === "" && customQuery === suggestion;
  const sweep = formatSweep(evidence?.response?.fetchedAt ?? null);

  const handleExportCitations = (format: "bibtex" | "ris" | "csv", shortlistOnly = false) => {
    const records = shortlistOnly ? shortlistReadings : readings;
    if (records.length === 0) return;

    const exportHeader = { query: (sentQuery ?? searchQuery) || "Gene-wide default", lexiconVersion: LEXICON_VERSION, date: new Date(evidence?.response?.fetchedAt ?? Date.now()).toISOString().slice(0, 10) };

    let content = "";
    let mime = "text/plain";
    let ext = "txt";

    if (format === "bibtex") {
      content = toBibtex(records, exportHeader);
      ext = "bib";
    } else if (format === "ris") {
      content = toRis(records, exportHeader);
      ext = "ris";
    } else {
      content = toCsv(records, gene || "", variant || "", exportHeader);
      mime = "text/csv;charset=utf-8";
      ext = "csv";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gene || "gene"}_literature_${shortlistOnly ? "shortlist" : "export"}.${ext}`;
    a.click();
    // Deferred: revoking synchronously can tear the URL down before the browser has
    // started reading it, aborting the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div className="lit-rail" data-testid="literature-rail">
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
        {evidence?.faults.map(f => (
          <p key={f} className="lit-rail__warn" role="status">{f}</p>
        ))}
      </section>

      <section className="rail-section" aria-labelledby="lit-rail-shortlist">
        <h3 className="eyebrow" id="lit-rail-shortlist">Shortlist</h3>
        {evidence ? (
          <dl className="rail-kv">
            <div className="rail-kv__row"><dt>Read first</dt><dd>{evidence.shortlist.readFirst}</dd></div>
            <div className="rail-kv__row"><dt>Read next</dt><dd>{evidence.shortlist.readNext}</dd></div>
            <div className="rail-kv__row"><dt>Order</dt><dd>{evidence.trace.find(step => step.key === "order")?.sub ?? "Not reported"}</dd></div>
          </dl>
        ) : <p className="lit-rail__empty">No shortlist until papers are loaded.</p>}
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
        <button type="button" className="lit-btn lit-btn--block" onClick={handleApplySearch} aria-live="polite">
          {justApplied ? <Check aria-hidden="true" /> : <Search aria-hidden="true" />}
          {justApplied ? "Applied to the list" : "Search Europe PMC"}
        </button>
        <p className="rail-step__sub">Enter applies; Shift+Enter adds a line. The gene is added to any query that does not name it.</p>
      </section>

      {/* ── 3. Export ── */}
      <section className="rail-section" aria-labelledby="lit-rail-export">
        <h3 className="eyebrow" id="lit-rail-export">
          <Download className="w-3.5 h-3.5" />
          Export
        </h3>
        <p className="lit-rail__lead">
          {citationCount > 0
            ? `The ${citationCount} ${citationCount === 1 ? "paper" : "papers"} shown, with any filter applied.`
            : "No papers are shown, so there is nothing to export."}
        </p>
        <div className="lit-rail__export">
          {(["bibtex", "ris", "csv"] as const).map(fmt => (
            <button
              key={fmt}
              type="button"
              className="lit-btn lit-btn--quiet"
              onClick={() => handleExportCitations(fmt)}
              disabled={citationCount === 0}
              title={citationCount === 0 ? "Load papers first" : `Download ${fmt.toUpperCase()} of the shown papers`}
            >
              <Download aria-hidden="true" />
              {fmt === "bibtex" ? "BibTeX" : fmt.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="lit-btn lit-btn--quiet lit-shortlist-export"
          onClick={() => handleExportCitations("csv", true)}
          disabled={shortlistReadings.length === 0}
          title="Download Read first and Read next papers as CSV"
        >
          <Download aria-hidden="true" /> Export shortlist
        </button>
        {evidence && evidence.counts.pinned > 0 && (
          <p className="rail-step__sub">{evidence.counts.pinned} pinned for the Report — pins are kept per variant and appear in its literature block.</p>
        )}
      </section>

      {/* ── 4. What reads this list ── */}
      <section className="rail-section" aria-labelledby="lit-rail-reads">
        <h3 className="eyebrow" id="lit-rail-reads">
          <Sparkles className="w-3.5 h-3.5" />
          What reads this list
        </h3>
        <dl className="rail-kv">
          <div className="rail-kv__row"><dt>ACMG engine</dt><dd>Nothing. No criterion is scored from literature.</dd></div>
          <div className="rail-kv__row"><dt>AI summary</dt><dd>Up to 5 relevant abstracts from bounded gene, protein-notation and clinical/functional searches plus curated links. Ordered by screening tier, then available similarity and date. Searches here do not change the summary.</dd></div>
          <div className="rail-kv__row"><dt>Screener</dt><dd>Reads titles and abstracts to order this list. It is not evidence and enters no ACMG criterion.</dd></div>
          <div className="rail-kv__row"><dt>Report</dt><dd>Only papers you pin.</dd></div>
        </dl>
      </section>

      {/* ── 5. Method ── */}
      <section className="rail-section" aria-labelledby="lit-rail-summary-inputs">
        <h3 className="eyebrow" id="lit-rail-summary-inputs"><Sparkles className="w-3.5 h-3.5" />Summary inputs</h3>
        {summaryReceipt ? <>
          <p className="lit-rail__lead">{summaryReceipt.citations.length} {summaryReceipt.citations.length === 1 ? "abstract" : "abstracts"} supplied to the current AI narrative. Selection is separate from this tab's filters.</p>
          <ol className="lit-summary-papers">{summaryReceipt.citations.map(c => <li key={c.id}><a className="lit-link" href={c.url ?? `https://europepmc.org/search?query=${encodeURIComponent(c.id)}`} target="_blank" rel="noopener noreferrer">{c.title}</a><span className="lit-dim lit-mono">{c.id} / tier {c.tier}</span></li>)}</ol>
          {summaryReceipt.coverage.map((row, i) => <p className="lit-rail__field" key={`${row.scope}-${i}`}>{row.scope}: {row.loaded} loaded{row.matched !== null ? ` of ${row.matched}` : "; total not reported"}{row.truncated ? " / bounded, more matches remain" : ""}{row.state === "error" ? " / retrieval incomplete" : ""}</p>)}
          {Object.entries(summaryReceipt.scopes).filter(([, state]) => state !== "complete").map(([scope, state]) => <p className="lit-rail__field" key={scope}>{scope}: {state === "error" ? "retrieval incomplete" : "not available"}</p>)}
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
