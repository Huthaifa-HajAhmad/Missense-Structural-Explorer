/**
 * literatureEvidence.ts — the one model the Literature tab and its inspector rail both render.
 *
 * ONE QUESTION: what has been published about this gene and this variant, how was that list obtained,
 * and what in it actually names the variant? Nothing here is scored: the ACMG engine reads no
 * literature, and this module computes no verdict.
 *
 * INVARIANTS (each pinned in `__tests__/literatureEvidence.test.ts`):
 *   • The query shown is the query that ran. The trace reads `europePmcQuery` from the response (the
 *     string the server actually sent), never a string rebuilt on the client. The previous rail
 *     pre-filled `(GENE[Gene]) AND ("missense"… OR variant)` while the list came from
 *     `GENE AND (mutation OR variant OR functional OR "pathogenic")`.
 *   • "Names the variant" is a literal text match on the title and abstract we hold, for the notations
 *     listed. It is not a curated assertion, it does not read full text, and it says so.
 *   • Europe PMC also matches open-access FULL TEXT, so a record can be returned without the gene
 *     appearing in its title or abstract. Those are labelled "matched elsewhere in the text" rather than
 *     presented as gene literature (this is what put a fish gene-editing review at the top of NAE1).
 *   • A zero is worded as a count of records matched by a stated query, never as "no evidence".
 *   • A search that fell back to cached rows (`degraded`) is reported as a fault, and its hit count is
 *     not shown.
 *   • No journal quality metric is computed or shown: none is sourced here.
 */
import { AMINO_ACID_3_TO_1 } from "./aminoAcids";
import { LEXICON_VERSION, screenPaper, type PaperScreening, type ScreeningTagName } from "./literatureScreening";
import type { CuratedCoverage, CuratedVariantLink } from "./curatedLiterature";

// Re-exported so a consumer that already imports the literature model finds the curated-link shape
// beside it. The relationship type itself lives in curatedLiterature.ts, which imports nothing at
// runtime, so this stays a type-only reference.
export type { CuratedCoverage, CuratedCoverageState, CuratedLinkProvider, CuratedVariantLink } from "./curatedLiterature";
export { CURATED_LINK_LABELS, curatedLinkDetail, curatedLinkLabel } from "./curatedLiterature";

// ── Types ─────────────────────────────────────────────────────────────────────────────────────────

export interface Citation {
  id: string;
  title: string;
  abstract: string;
  authors: string;
  journal: string;
  year: number | null;
  /** Canonical link resolved server-side: PubMed, PMC, or Europe PMC for preprints. */
  url?: string | null;
  /** Europe PMC core metadata. Optional so older API responses remain valid. */
  publicationTypes?: string[] | null;
  meshHeadings?: string[] | null;
  authorKeywords?: string[] | null;
  /**
   * Curated database record → paper relationships (Phase 1b). A relationship only: it may carry no
   * abstract sentence, it is not proof the paper supports pathogenicity, and it enters no ACMG
   * criterion. Optional so older payloads remain valid.
   */
  curatedLinks?: CuratedVariantLink[] | null;
}

export type MentionLevel = "variant" | "gene" | "elsewhere";
export type MentionField = "title" | "abstract";

export interface VariantForms {
  /** How the variant is written in this app, e.g. `p.Asp116Gly`. */
  label: string;
  /** Every notation searched and matched, e.g. `p.Asp116Gly`, `Asp116Gly`, `D116G`, `p.D116G`. */
  forms: string[];
}

export interface CitationMentions {
  level: MentionLevel;
  /** Where the variant was found, title first. `null` when it was not found. */
  variantIn: MentionField | null;
  matchedForm: string | null;
  geneIn: MentionField[];
  hasAbstract: boolean;
  /** The sentence of the abstract that names the variant: a quote, so the match can be checked. */
  snippet: string | null;
}

export interface PaperIdentifier {
  kind: "pmid" | "pmcid" | "preprint" | "other";
  /** The label a reader sees: `PMID 41695624`, `PMC13295995`, `Preprint PPR123`. */
  label: string;
}

export interface PaperReading {
  citation: Citation;
  identifier: PaperIdentifier;
  href: string;
  hrefLabel: string;
  mentions: CitationMentions;
  screening: PaperScreening;
  pinned: boolean;
}

export type LiteratureScope = "gene" | "variant" | "custom";
export type GroupFilter = "all" | MentionLevel;

export interface LiteratureResponseMeta {
  hitCount: number | null;
  /** The Europe PMC query string the server sent for this list. `null` before any response. */
  europePmcQuery: string | null;
  /** The upstream search failed and the rows are this gene's cached set, not this query's own. */
  degraded: boolean;
  /** When the server last completed a sweep of this query (ms since epoch), if it knows. */
  fetchedAt: number | null;
  pageSize: number | null;
  nextCursor?: string | null;
}

export interface VariantProbe {
  state: "idle" | "loading" | "done" | "error";
  hitCount: number | null;
}

export type LiteratureLoadState = "idle" | "loading" | "ready" | "error";

export interface LiteratureEvidenceInput {
  gene: string;
  variant: string | null;
  /** Everything the server returned for the current query, in the server's order. */
  citations: readonly Citation[];
  response: LiteratureResponseMeta | null;
  /** The custom query that produced `citations`; empty for the gene-wide default. */
  executedQuery: string;
  /** What is typed in the box, when it differs from the executed query: narrows the loaded list locally. */
  narrowingFilter: string;
  groupFilter: GroupFilter;
  pinnedIds: ReadonlySet<string>;
  probe: VariantProbe;
  /** The gene-wide default query's hit count, remembered across a scope switch; `null` when unknown. */
  geneHitCount?: number | null;
  load: LiteratureLoadState;
  error: string | null;
  /** Attention is the default; newest sorts loaded records by publication year. */
  sortOrder?: "attention" | "newest";
  /**
   * Phase 1b coverage of the curated variant-citation lookup, when one was requested. `null` means no
   * curated lookup ran, which the trace reports as "Not checked" rather than as an absence of links.
   */
  curated?: CuratedCoverage | null;
  /**
   * Curated records among `citations` that the query itself did NOT match. They are shown, but they are
   * not query membership: the loaded/hit-count facts must never treat them as Europe PMC records for
   * this query.
   */
  curatedAdded?: number;
}

export interface FactCell {
  label: string;
  value: string;
  sub: string;
}

export interface TraceStep {
  key: string;
  label: string;
  value: string;
  mono?: boolean;
  sub?: string;
  state?: "done" | "warn" | "idle";
}

export interface LiteratureEvidence {
  gene: string;
  forms: VariantForms | null;
  scope: LiteratureScope;
  /** Query to run for the variant scope; `null` when the variant has no searchable protein notation. */
  variantQuery: string | null;
  /** Every loaded paper, ordered by attention tier or publication year. */
  papers: PaperReading[];
  /** What the list shows after the group and narrowing filters. */
  visible: PaperReading[];
  counts: { total: number; variant: number; gene: number; elsewhere: number; visible: number; pinned: number };
  shortlist: ShortlistCounts;
  finding: { figure: string; figureLabel: string; headline: string; predicate: string };
  facts: FactCell[];
  trace: TraceStep[];
  /** Plain-language faults, in order; empty when the run is clean. */
  faults: string[];
  response: LiteratureResponseMeta | null;
  pageSize: number;
  load: LiteratureLoadState;
  /** The citations a reader can see right now, in the order shown — what the export serialises. */
  displayed: Citation[];
  /** Curated variant-citation coverage for this run, or `null` when no lookup was requested. */
  curated: CuratedCoverage | null;
  /** Curated records shown among `papers` that the query itself did not match. */
  curatedAdded: number;
}

export interface ShortlistCounts {
  /** Attention tiers 1-2. */
  readFirst: number;
  /** Attention tiers 3-4. */
  readNext: number;
  /** Counts are observations, not scores. Every taxonomy tag is present, including zeros. */
  tags: Record<ScreeningTagName, number>;
}

/** Europe PMC returns one page per request (`EUROPE_PMC_PAGE_SIZE` on the server). */
export const LITERATURE_PAGE_SIZE = 25;

// ── Variant notation ──────────────────────────────────────────────────────────────────────────────

const ONE_LETTER_TO_THREE: Record<string, string> = {};
for (const [three, one] of Object.entries(AMINO_ACID_3_TO_1)) {
  if (/^[A-Z][a-z]{2}$/.test(three)) ONE_LETTER_TO_THREE[one] = three;
}

const VARIANT_RE = /(?:p\.)?\(?([A-Z][a-z]{2}|[A-Z])(\d+)([A-Z][a-z]{2}|[A-Z*=])\)?/;

/**
 * The notations a paper might use for a protein change, from any of the forms this app accepts
 * (`p.Asp116Gly`, `Asp116Gly`, `D116G`, a transcript-prefixed HGVS string).
 *
 * `null` for anything that is not a substitution between two different residues — a synonymous change,
 * an indel or a nucleotide notation has no protein-level form to search for, and inventing one would
 * make the "names the variant" count meaningless.
 */
export function parseVariantForms(variant: string | null | undefined): VariantForms | null {
  if (!variant) return null;
  const m = variant.match(VARIANT_RE);
  if (!m) return null;
  const toOne = (token: string): string | null => {
    if (token === "*" || token === "=") return token;
    if (/^Ter$/i.test(token)) return "*";
    if (token.length === 1) return ONE_LETTER_TO_THREE[token.toUpperCase()] ? token.toUpperCase() : null;
    return AMINO_ACID_3_TO_1[token] ?? AMINO_ACID_3_TO_1[token[0].toUpperCase() + token.slice(1).toLowerCase()] ?? null;
  };
  const wt = toOne(m[1]);
  const mut = toOne(m[3]);
  const pos = m[2];
  if (!wt || !mut || wt === "=" || mut === "=" || wt === "*" || wt === mut) return null;
  const wt3 = ONE_LETTER_TO_THREE[wt];
  const mut3 = mut === "*" ? "Ter" : ONE_LETTER_TO_THREE[mut];
  if (!wt3 || !mut3) return null;

  const forms: string[] = [`p.${wt3}${pos}${mut3}`, `${wt3}${pos}${mut3}`];
  forms.push(`${wt}${pos}${mut === "*" ? "X" : mut}`, `p.${wt}${pos}${mut === "*" ? "X" : mut}`);
  if (mut === "*") forms.push(`${wt}${pos}*`, `p.${wt3}${pos}*`);
  return { label: forms[0], forms: [...new Set(forms)] };
}

/** One-letter residue identity of a substitution, for matching a provider's feature exactly. */
export interface VariantResidues {
  /** Reference residue, one-letter upper case, e.g. `D`. */
  wildType: string;
  /** 1-based position, e.g. `116`. */
  position: number;
  /** Alternate residue, one-letter upper case or `*` for a stop. */
  alternate: string;
}

/**
 * The one-letter identity of a substitution, or `null` for anything that is not a substitution between
 * two different residues — the same rule as `parseVariantForms`. Curated matching compares this against
 * a provider's `originalSequence`/`alternativeSequences` and position, so no notation is guessed.
 */
export function parseVariantResidues(variant: string | null | undefined): VariantResidues | null {
  if (!variant) return null;
  const m = variant.match(VARIANT_RE);
  if (!m) return null;
  const toOne = (token: string): string | null => {
    if (token === "*" || token === "=") return token;
    if (/^Ter$/i.test(token)) return "*";
    if (token.length === 1) return ONE_LETTER_TO_THREE[token.toUpperCase()] ? token.toUpperCase() : null;
    return AMINO_ACID_3_TO_1[token] ?? AMINO_ACID_3_TO_1[token[0].toUpperCase() + token.slice(1).toLowerCase()] ?? null;
  };
  const wildType = toOne(m[1]);
  const alternate = toOne(m[3]);
  const position = Number.parseInt(m[2], 10);
  if (!wildType || !alternate || wildType === "=" || alternate === "=" || wildType === "*" || wildType === alternate) return null;
  if (!Number.isInteger(position) || position <= 0) return null;
  return { wildType, position, alternate };
}

/** The variant-scope query. Quoted so each notation is one term; the gene keeps it scoped. */
export function variantSearchQuery(gene: string, forms: VariantForms | null): string | null {
  if (!forms || !gene.trim()) return null;
  return `${gene.trim().toUpperCase()} AND (${forms.forms.map(f => `"${f}"`).join(" OR ")})`;
}

// ── Mentions ──────────────────────────────────────────────────────────────────────────────────────

const B = "(?<![A-Za-z0-9])";
const E = "(?![A-Za-z0-9])";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Three-letter forms are matched ignoring case ("ASP116GLY" exists); one-letter forms exactly ("D116G"). */
function variantPatterns(forms: VariantForms): RegExp[] {
  return forms.forms.map(f => new RegExp(`${B}${escapeRe(f)}${E}`, /[a-z]{2}/.test(f) ? "gi" : "g"));
}

/** The symbol as written, plus the mouse-style capitalisation ("Nae1") — never case-blind, so a gene
 *  named like a common word ("SET", "CAT") does not match ordinary prose. */
function genePattern(gene: string): RegExp | null {
  const g = gene.trim();
  if (!g) return null;
  const alt = new Set([g.toUpperCase()]);
  if (g.length >= 3) alt.add(g[0].toUpperCase() + g.slice(1).toLowerCase());
  return new RegExp(`${B}(?:${[...alt].map(escapeRe).join("|")})${E}`, "g");
}

function firstMatch(text: string, patterns: RegExp[]): { form: string; index: number } | null {
  let best: { form: string; index: number } | null = null;
  for (const re of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { form: m[0], index: m.index };
  }
  return best;
}

function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(". ", index) + 2, text.lastIndexOf("\n", index) + 1, 0);
  const endDot = text.indexOf(". ", index);
  const end = endDot === -1 ? text.length : endDot + 1;
  const sentence = text.slice(start, end).trim();
  return sentence.length > 320 ? `${sentence.slice(0, 317).trimEnd()}…` : sentence;
}

export function readMentions(citation: Citation, gene: string, forms: VariantForms | null): CitationMentions {
  const vPatterns = forms ? variantPatterns(forms) : [];
  const gPattern = genePattern(gene);
  const hasAbstract = citation.abstract.trim().length > 0;

  const inTitle = forms ? firstMatch(citation.title, vPatterns) : null;
  const inAbstract = forms && hasAbstract ? firstMatch(citation.abstract, vPatterns) : null;
  const variantIn: MentionField | null = inTitle ? "title" : inAbstract ? "abstract" : null;

  const geneIn: MentionField[] = [];
  if (gPattern) {
    gPattern.lastIndex = 0;
    if (gPattern.test(citation.title)) geneIn.push("title");
    gPattern.lastIndex = 0;
    if (hasAbstract && gPattern.test(citation.abstract)) geneIn.push("abstract");
  }

  const level: MentionLevel = variantIn ? "variant" : geneIn.length > 0 ? "gene" : "elsewhere";
  return {
    level,
    variantIn,
    matchedForm: inTitle?.form ?? inAbstract?.form ?? null,
    geneIn,
    hasAbstract,
    snippet: inAbstract ? sentenceAround(citation.abstract, inAbstract.index) : null,
  };
}

export interface TextSegment {
  text: string;
  kind: "variant" | "gene" | null;
}

/** Splits `text` into plain and highlighted runs: the variant notations first, then the gene symbol. */
export function highlightSegments(text: string, gene: string, forms: VariantForms | null): TextSegment[] {
  const ranges: Array<{ start: number; end: number; kind: "variant" | "gene" }> = [];
  const collect = (re: RegExp, kind: "variant" | "gene") => {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      ranges.push({ start: m.index, end: m.index + m[0].length, kind });
    }
  };
  if (forms) variantPatterns(forms).forEach(re => collect(re, "variant"));
  const gp = genePattern(gene);
  if (gp) collect(gp, "gene");
  if (ranges.length === 0) return [{ text, kind: null }];

  // Variant highlights win where they overlap a gene highlight.
  ranges.sort((a, b) => a.start - b.start || (a.kind === "variant" ? -1 : 1));
  const merged: typeof ranges = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) continue;
    merged.push(r);
  }
  const out: TextSegment[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) out.push({ text: text.slice(cursor, r.start), kind: null });
    out.push({ text: text.slice(r.start, r.end), kind: r.kind });
    cursor = r.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), kind: null });
  return out;
}

// ── Identifiers and links ─────────────────────────────────────────────────────────────────────────

export function paperIdentifier(id: string): PaperIdentifier {
  if (/^\d+$/.test(id)) return { kind: "pmid", label: `PMID ${id}` };
  if (/^PMC\d+$/i.test(id)) return { kind: "pmcid", label: id.toUpperCase() };
  if (/^PPR/i.test(id)) return { kind: "preprint", label: `Preprint ${id}` };
  return { kind: "other", label: id };
}

/**
 * Where "open the article" goes. A stored URL is trusted only when absolute: cached legacy rows can
 * carry `null`, and a non-PMID id must never become a dead `pubmed…/<id>/` deep link.
 */
export function paperLink(citation: Citation): { href: string; label: string; usable: boolean } {
  const usable = !!citation.url && /^https?:\/\//i.test(citation.url);
  if (usable) {
    const pmid = /^\d+$/.test(citation.id);
    return { href: citation.url as string, label: pmid ? "View on PubMed" : "View article", usable: true };
  }
  if (/^\d+$/.test(citation.id)) return { href: `https://pubmed.ncbi.nlm.nih.gov/${citation.id}/`, label: "View on PubMed", usable: false };
  return { href: `https://europepmc.org/search?query=${encodeURIComponent(citation.id)}`, label: "Search Europe PMC", usable: false };
}

// ── Local narrowing ───────────────────────────────────────────────────────────────────────────────

/**
 * Typing narrows the loaded list without a request. Whole phrase first, then any free term once
 * field tags, boolean operators and punctuation are stripped (a pasted PubMed query still narrows).
 */
export function narrowCitations<T extends Citation>(list: readonly T[], filter: string): T[] {
  const raw = filter.trim();
  if (!raw) return [...list];
  const terms = raw
    .replace(/\[.*?\]/g, " ")
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .replace(/[()",]/g, " ")
    .split(/\s+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length > 1);
  return list.filter(c => {
    const text = `${c.title} ${c.abstract} ${c.authors} ${c.journal} ${c.year ?? ""} ${(c.meshHeadings ?? []).join(" ")} ${(c.authorKeywords ?? []).join(" ")}`.toLowerCase();
    if (text.includes(raw.toLowerCase())) return true;
    if (terms.length === 0) return true;
    return terms.some(t => text.includes(t));
  });
}

// ── The model ─────────────────────────────────────────────────────────────────────────────────────

const n = (value: number) => value.toLocaleString("en-GB");
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function scopeOf(executedQuery: string, variantQuery: string | null): LiteratureScope {
  const q = executedQuery.trim();
  if (!q) return "gene";
  if (variantQuery && q.toLowerCase() === variantQuery.toLowerCase()) return "variant";
  return "custom";
}

export function buildLiteratureEvidence(input: LiteratureEvidenceInput): LiteratureEvidence {
  const { gene, citations, response, executedQuery, pinnedIds, probe, load } = input;
  const forms = parseVariantForms(input.variant);
  const variantQuery = variantSearchQuery(gene, forms);
  const scope = scopeOf(executedQuery, variantQuery);
  const pageSize = response?.pageSize ?? LITERATURE_PAGE_SIZE;

  const readings: PaperReading[] = citations.map(citation => {
    const link = paperLink(citation);
    const mentions = readMentions(citation, gene, forms);
    return {
      citation,
      identifier: paperIdentifier(citation.id),
      href: link.href,
      hrefLabel: link.label,
      mentions,
      screening: screenPaper({ citation, gene, forms, mentions, curatedLinks: citation.curatedLinks }),
      pinned: pinnedIds.has(citation.id),
    };
  });
  // Stable ties preserve retrieval order, which may be Europe PMC relevance rather than date.
  const papers = readings
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (input.sortOrder ?? "attention") === "newest"
      ? (b.r.citation.year ?? -Infinity) - (a.r.citation.year ?? -Infinity) || a.i - b.i
      : a.r.screening.tier - b.r.screening.tier || a.i - b.i)
    .map(x => x.r);

  const counts = { total: papers.length, variant: 0, gene: 0, elsewhere: 0, visible: 0, pinned: 0 };
  for (const p of papers) {
    counts[p.mentions.level]++;
    if (p.pinned) counts.pinned++;
  }

  const tagNames: ScreeningTagName[] = [
    "names-variant", "names-gene", "functional-assay", "clinical-case", "mechanism", "review",
    "preprint", "full-text-only", "same-residue", "multi-variant", "model-system",
  ];
  const shortlist: ShortlistCounts = {
    readFirst: papers.filter(paper => paper.screening.tier <= 2).length,
    readNext: papers.filter(paper => paper.screening.tier >= 3 && paper.screening.tier <= 4).length,
    tags: Object.fromEntries(tagNames.map(tag => [tag, 0])) as Record<ScreeningTagName, number>,
  };
  for (const paper of papers) {
    for (const tag of paper.screening.tags) shortlist.tags[tag.tag]++;
  }

  const byGroup = input.groupFilter === "all" ? papers : papers.filter(p => p.mentions.level === input.groupFilter);
  const narrowed = new Set(narrowCitations(byGroup.map(p => p.citation), input.narrowingFilter));
  const visible = byGroup.filter(p => narrowed.has(p.citation));
  counts.visible = visible.length;

  const degraded = response?.degraded === true;
  const hitCount = degraded ? null : response?.hitCount ?? null;
  const label = forms?.label ?? null;
  // Curated additions are shown but are not this query's records: keep them out of the loaded page count.
  const curatedAdded = Math.max(0, Math.min(input.curatedAdded ?? 0, counts.total));
  const queryTotal = counts.total - curatedAdded;
  // "Gene-wide" is the default query's count. While another scope is showing, `hitCount` is THAT
  // query's count, so the fact reads the remembered gene-wide figure instead of mislabelling it.
  const geneWide = scope === "gene" ? hitCount : input.geneHitCount ?? null;

  // ── The finding ──
  let finding: LiteratureEvidence["finding"];
  const probeDone = probe.state === "done" && probe.hitCount !== null;
  if (!forms) {
    finding = {
      figure: hitCount !== null ? n(hitCount) : n(counts.total),
      figureLabel: hitCount !== null ? `Europe PMC records matching ${gene}` : `papers loaded for ${gene}`,
      headline: "This variant has no protein-level notation to search for.",
      predicate: `The list is gene-wide literature for ${gene}. Nucleotide changes, indels and synonymous variants are not searched by notation here; use a custom query.`,
    };
  } else if (probeDone) {
    const c = probe.hitCount as number;
    finding = {
      figure: n(c),
      figureLabel: `Europe PMC ${plural(c, "record matches", "records match")} these protein notations`,
      headline: c === 0 ? `No matches for the searched protein notations of ${label}.` : `Europe PMC matched ${n(c)} ${plural(c, "record", "records")} for these protein notations.`,
      predicate: c === 0
        ? `A search for ${gene} with ${forms.forms.join(", ")} matched 0 records, in titles, abstracts and open-access full text. A report under another notation, such as a nucleotide change, would not match`
        : `Matched on ${gene} with ${forms.forms.join(", ")}; ${scope === "variant" ? "they are listed below" : `choose "Naming ${label}" below to read them`}`,
    };
  } else if (probe.state === "error") {
    finding = {
      figure: `${counts.variant}`,
      figureLabel: `of ${counts.total} loaded ${plural(counts.total, "paper names", "papers name")} ${label}`,
      headline: `The variant-specific search did not complete.`,
      predicate: `Only the ${counts.total} loaded ${plural(counts.total, "paper has", "papers have")} been read for ${label}; that is not a count of everything Europe PMC holds`,
    };
  } else {
    finding = {
      figure: `${counts.variant}`,
      figureLabel: `of ${counts.total} loaded ${plural(counts.total, "paper names", "papers name")} ${label}`,
      headline: counts.variant === 0 ? `None of the loaded papers names ${label} in its title or abstract.` : `${counts.variant} of ${counts.total} loaded ${plural(counts.total, "paper names", "papers name")} ${label} in the title or abstract.`,
      predicate: probe.state === "loading" ? "Checking Europe PMC for records that name it" : "Only the loaded page has been read",
    };
  }

  // ── Facts ──
  const facts: FactCell[] = [
    {
      label: "Gene-wide matches",
      value: geneWide !== null ? n(geneWide) : "—",
      sub: scope === "gene" && degraded ? "Europe PMC did not answer" : geneWide !== null ? "Europe PMC, default gene query" : "Not reported yet",
    },
    {
      // A fixed label: table heads are uppercased by the house style, which would turn "p.Asp116Gly"
      // into "P.ASP116GLY" — a notation that is not the variant. The variant goes in the sub line.
      label: "Naming the variant",
      value: !forms ? "—" : probeDone ? n(probe.hitCount as number) : probe.state === "loading" ? "…" : probe.state === "error" ? "Search incomplete" : "Not searched",
      sub: !forms ? "No protein notation" : probeDone ? `${forms.label} · title, abstract or open-access text` : `${forms.label} · ${probe.state === "error" ? "search incomplete" : "not searched yet"}`,
    },
    {
      label: "Query matches loaded",
      value: n(queryTotal),
      sub: [
        degraded ? "Cached fallback; query membership unverified" : hitCount !== null && hitCount > queryTotal ? `${n(queryTotal)} of ${n(hitCount)} query matches loaded` : "All retrieved query matches",
        curatedAdded > 0 ? `${n(curatedAdded)} more from a curated variant record, not this query` : null,
      ].filter(Boolean).join(" · ")
    },
    { label: "Engine record", value: "None", sub: "Literature is read, not scored" },
  ];

  // ── Trace ──
  const faults: string[] = [];
  if (degraded) faults.push("Europe PMC did not answer this search. The papers shown are this gene's cached set and may not match the query.");
  if (input.error) faults.push(input.error);
  if (probe.state === "error") faults.push("The variant-specific search did not complete, so its count is not shown.");
  const curated = input.curated ?? null;
  if (curated?.state === "error") {
    faults.push(`The curated variant-citation lookup did not complete${curated.reason ? ` (${curated.reason})` : ""}. Papers cited only by a curated variant record may be missing.`);
  }

  const sent = response?.europePmcQuery ?? null;
  const trace: TraceStep[] = [
    {
      key: "scope",
      label: "Scope you chose",
      value: scope === "gene" ? `Default search on ${gene}` : scope === "variant" ? `Protein-notation search for ${label}` : "Your own query",
      sub: scope === "custom" ? "Scoped to the gene unless it already names it" : undefined,
      state: "done",
    },
    {
      key: "sent",
      label: "Sent to Europe PMC",
      value: sent ?? (load === "loading" ? "Sending…" : "Not sent yet"),
      mono: sent !== null,
      sub: sent ? "Exactly what the server sent, not a rebuilt copy" : undefined,
      state: degraded ? "warn" : sent ? "done" : "idle",
    },
    {
      key: "matched",
      label: "Europe PMC matched",
      value: degraded ? "No answer" : hitCount !== null ? `${n(hitCount)} ${plural(hitCount, "record", "records")}` : "Not reported",
      sub: hitCount !== null && !degraded ? `${n(queryTotal)} query matches loaded. Retrieval uses Europe PMC's default ranking; the cached list is ordered by year before screening.` : undefined,
      state: degraded ? "warn" : hitCount !== null ? "done" : "idle",
    },
    {
      key: "check",
      label: "Text check",
      value: forms ? `${counts.variant} name ${label} · ${counts.gene} name only ${gene} · ${counts.elsewhere} neither` : `${counts.gene} name ${gene} · ${counts.elsewhere} do not`,
      sub: forms ? `Literal match of ${forms.forms.join(", ")} in title or abstract` : `Gene symbol ${gene} in title or abstract`,
      state: "done",
    },
    {
      key: "curated",
      label: "Curated variant citations",
      value: curated === null
        ? "Not checked"
        : curated.state === "unavailable"
          ? "Not available"
          : curated.state === "error"
            ? "Did not load"
            : curated.linked > 0
              ? `${n(curated.linked)} ${plural(curated.linked, "record", "records")} linked to the variant record`
              : "No linked record",
      sub: curated?.state === "complete"
        ? "UniProt Natural variant evidence. A record relationship, not a pathogenicity claim and not an ACMG input."
        : curated?.reason ?? undefined,
      state: curated === null ? "idle" : curated.state === "error" ? "warn" : "done",
    },
    {
      key: "screening",
      label: "Screening",
      value: `Lexicon v${LEXICON_VERSION} · ${shortlist.readFirst} read first · ${shortlist.readNext} read next`,
      sub: `${papers.filter(paper => (paper.citation.publicationTypes?.length ?? 0) > 0).length} of ${papers.length} records include Europe PMC publication types.`,
      state: papers.length > 0 ? "done" : "idle",
    },
    {
      key: "order",
      label: "Order",
      value: `${n(queryTotal)} loaded${curatedAdded > 0 ? ` · ${n(curatedAdded)} curated added` : ""} · ${n(counts.visible)} shown`,
      sub: (input.sortOrder ?? "attention") === "newest"
        ? "Publication year, newest first; ties keep the supplied list order."
        : "Screening tiers 1–6; ties keep the supplied list order.",
      state: counts.total > 0 ? "done" : "idle",
    },
  ];

  return {
    gene,
    forms,
    scope,
    variantQuery,
    papers,
    visible,
    counts,
    shortlist,
    finding,
    facts,
    trace,
    faults,
    response,
    pageSize,
    load,
    displayed: visible.map(p => p.citation),
    curated,
    curatedAdded,
  };
}
