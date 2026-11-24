/* ── Citation serializers ──────────────────────────────────────────────────
 * Each operates on the citations the user can actually see in the Literature
 * view, with field-level escaping appropriate to the format. Exported via
 * LiteratureInspector.tsx for the unit tests in ./__tests__/literatureExport.test.ts. */

import type { Citation, PaperReading } from "../../shared/literatureEvidence";
import { curatedLinkLabel } from "../../shared/curatedLiterature";

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

export type ExportItem = Citation | PaperReading;
export interface ExportHeader { query: string; lexiconVersion: number; date: string; }
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

export function buildCitationExport(
  format: "bibtex" | "ris" | "csv",
  records: readonly ExportItem[],
  meta: { gene: string; variant: string; header: ExportHeader }
): { content: string; mime: string; ext: string } {
  if (format === "bibtex") {
    return { content: toBibtex(records, meta.header), mime: "text/plain", ext: "bib" };
  }
  if (format === "ris") {
    return { content: toRis(records, meta.header), mime: "text/plain", ext: "ris" };
  }
  return { content: toCsv(records, meta.gene, meta.variant, meta.header), mime: "text/csv;charset=utf-8", ext: "csv" };
}
