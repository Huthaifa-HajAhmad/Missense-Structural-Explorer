import React, { useState, useEffect, useRef } from "react";
import { BookOpen, Search, Download, RotateCcw, Check } from "lucide-react";
import type { Citation } from "../LiteratureView";

interface LiteratureInspectorProps {
  gene: string;
  variant: string;
  searchQuery?: string;
  onSearch?: (query: string) => void;
  /** Citations currently displayed in the Literature view (local filter applied).
   *  The export serializes exactly this list — never canned data. */
  citations?: Citation[];
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

export const toBibtex = (list: Citation[]): string => {
  const keys = uniqueKeys(list);
  return `${list.map((c, i) => {
    const fields = [
      `  author  = {${splitAuthors(c.authors).map(toSurnameFirst).map(bibtexEscape).join(" and ")}}`,
      `  title   = {${bibtexEscape(c.title)}}`,
      `  journal = {${bibtexEscape(c.journal)}}`,
      ...(c.year ? [`  year    = {${c.year}}`] : []),
      ...(c.url ? [`  url     = {${bibtexEscape(c.url)}}`] : []),
      `  note    = {${bibtexEscape(identifierLabel(c.id))}}`
    ];
    return `@article{${keys[i]},\n${fields.join(",\n")}\n}`;
  }).join("\n\n")}\n`;
};

/** RIS is line-oriented: a newline inside a value would start a bogus record line. */
const risLine = (text: string): string => text.replace(/\s*\r?\n\s*/g, " ");

export const toRis = (list: Citation[]): string =>
  `${list.map(c => {
    const lines = [
      "TY  - JOUR",
      `TI  - ${risLine(c.title)}`,
      ...splitAuthors(c.authors).map(a => `AU  - ${toSurnameFirst(a)}`),
      `JO  - ${risLine(c.journal)}`,
      ...(c.abstract ? [`AB  - ${risLine(c.abstract)}`] : []),
      ...(c.year ? [`PY  - ${c.year}`] : []),
      ...(c.url ? [`UR  - ${c.url}`] : []),
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

export const toCsv = (list: Citation[], gene: string, variant: string): string => {
  const header = ["Gene", "Variant", "ID", "Title", "Authors", "Journal", "Year", "URL"];
  const rows = list.map(c =>
    [gene, variant, c.id, c.title, c.authors, c.journal, c.year ?? "", c.url ?? ""]
      .map(csvCell)
      .join(",")
  );
  // CRLF line endings keep Excel happy when a field contains quotes or newlines.
  return `${[header.join(","), ...rows].join("\r\n")}\r\n`;
};

export const LiteratureInspector: React.FC<LiteratureInspectorProps> = ({
  gene,
  variant,
  searchQuery = "",
  onSearch,
  citations = []
}) => {
  const defaultQuery = `(${gene || "GENE"}[Gene]) AND ("missense"[All Fields] OR "mutation"[All Fields] OR ${variant || "variant"})`;
  const [customQuery, setCustomQuery] = useState(searchQuery || defaultQuery);
  const [justApplied, setJustApplied] = useState(false);
  const appliedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (searchQuery) {
      setCustomQuery(searchQuery);
    } else {
      setCustomQuery(defaultQuery);
    }
    // defaultQuery is derived from gene/variant, so those cover its inputs too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gene, variant, searchQuery]);

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

  const handleResetQuery = () => {
    setCustomQuery(defaultQuery);
    onSearch?.(defaultQuery);
    flashApplied();
  };

  const citationCount = citations.length;

  const handleExportCitations = (format: "bibtex" | "ris" | "csv") => {
    if (citationCount === 0) return;

    let content = "";
    let mime = "text/plain";
    let ext = "txt";

    if (format === "bibtex") {
      content = toBibtex(citations);
      ext = "bib";
    } else if (format === "ris") {
      content = toRis(citations);
      ext = "ris";
    } else {
      content = toCsv(citations, gene || "", variant || "");
      mime = "text/csv;charset=utf-8";
      ext = "csv";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${gene || "gene"}_literature_export.${ext}`;
    a.click();
    // Deferred: revoking synchronously can tear the URL down before the browser has
    // started reading it, aborting the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {/* ── 1. Interactive Europe PMC query ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-cs-accent-clay" />
            PubMed / Europe PMC Query
          </span>
          {customQuery !== defaultQuery && (
            <button
              type="button"
              onClick={handleResetQuery}
              className="text-[9.5px] font-mono text-cs-text-muted hover:text-cs-accent-clay flex items-center gap-1 cursor-pointer transition-colors"
              title="Reset to standard gene & variant query"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset Query
            </button>
          )}
        </div>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-cs-text-secondary uppercase tracking-wider block">
              Search Query String:
            </span>
            <textarea
              value={customQuery}
              onChange={(e) => setCustomQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleApplySearch();
                }
              }}
              rows={3}
              aria-label="Europe PMC search query"
              className="w-full p-2 rounded bg-cs-surface border border-cs-border font-mono text-[10px] text-cs-text-primary leading-relaxed resize-y focus:outline-none focus:border-cs-accent-clay transition-colors"
              placeholder="Enter PubMed MeSH or keyword query..."
            />
          </div>

          <button
            type="button"
            onClick={handleApplySearch}
            aria-live="polite"
            className={`w-full py-2 px-3 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs ${
              justApplied
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                : "bg-cs-accent-clay text-white border-cs-accent-clay hover:opacity-90"
            }`}
          >
            {justApplied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Query Applied to Literature View</span>
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" />
                <span>Search Europe PMC</span>
              </>
            )}
          </button>

          <div className="flex justify-between items-center text-[10px] text-cs-text-muted pt-1 border-t border-cs-border-subtle">
            <span>Query Target:</span>
            <span className="font-mono">Live In-App Citation Feed</span>
          </div>
        </div>
      </div>

      {/* ── 2. Batch Citation Export Tools ── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-cs-accent-clay" />
          Citation Export Tools
        </span>

        <div className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2">
          <span className="text-[10px] font-semibold text-cs-text-secondary">
            {citationCount > 0
              ? `Export the ${citationCount} citation${citationCount === 1 ? "" : "s"} currently shown:`
              : "No citations loaded to export."}
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {(["bibtex", "ris", "csv"] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => handleExportCitations(fmt)}
                disabled={citationCount === 0}
                title={citationCount === 0 ? "Load citations in the Literature view first" : `Download ${fmt.toUpperCase()} of the shown citations`}
                className="py-1.5 rounded border border-cs-border bg-cs-surface hover:border-cs-accent-clay hover:text-cs-accent-clay font-mono text-[10.5px] uppercase font-bold text-cs-text-secondary cursor-pointer transition-all flex items-center justify-center gap-1 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-cs-border disabled:hover:text-cs-text-secondary"
              >
                <Download className="w-2.5 h-2.5" />
                {fmt}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(LiteratureInspector);
