/** A bounded, reproducible input snapshot for narrative literature context. Never an ACMG input. */
import { buildLiteratureEvidence, type Citation } from "./literatureEvidence";
import { LEXICON_VERSION, type PaperScreening } from "./literatureScreening";

export const SUMMARY_SELECTION_VERSION = 3;
export const SUMMARY_CITATION_LIMIT = 5;
export type LiteratureScopeState = "complete" | "unavailable" | "error";
export interface SummaryCandidate extends Citation { similarity?: number | null }
export interface SummaryCitation extends Citation { screening: PaperScreening; similarity: number | null }
export interface LiteratureSummarySelection {
  citations: SummaryCitation[];
  scopes: { gene: LiteratureScopeState; variant: LiteratureScopeState; curated: LiteratureScopeState };
  withoutEmbeddings: number;
  coverage?: Array<{ scope: string; query: string; loaded: number; matched: number | null; state: "complete" | "error"; truncated: boolean }>;
}

/** Small server-authored receipt, retained with the narrative rather than recomputed by the tab. */
export interface LiteratureSummaryReceipt {
  citations: Array<{ id: string; title: string; url: string | null; tier: number }>;
  scopes: LiteratureSummarySelection["scopes"];
  coverage: NonNullable<LiteratureSummarySelection["coverage"]>;
}
export function literatureSummaryReceipt(selection: LiteratureSummarySelection): LiteratureSummaryReceipt {
  return { citations: selection.citations.map(c => ({ id: c.id, title: c.title, url: c.url ?? null, tier: c.screening.tier })), scopes: selection.scopes, coverage: selection.coverage ?? [] };
}

const SCOPE_ROWS = [
  { key: "gene", label: "Gene search" },
  { key: "variant", label: "Variant notation search" },
  { key: "clinical / functional", label: "Clinical and functional search" },
  { key: "curated", label: "Curated variant records" },
] as const;

/**
 * One plain row per retrieval scope for the rail. The receipt records a scope twice (its search
 * coverage and its scope state), and printing both listed "variant" twice with two different states.
 * A search row comes from coverage; a scope that left no coverage row ran out of time or never ran.
 */
export function summaryScopeRows(receipt: LiteratureSummaryReceipt): Array<{ label: string; text: string }> {
  return SCOPE_ROWS.flatMap(({ key, label }) => {
    const row = receipt.coverage.find(item => item.scope === key);
    if (row) {
      const read = row.matched !== null ? `${row.loaded} of ${row.matched} read` : `${row.loaded} read; total not reported`;
      const tail = row.state === "error" ? " · stopped before it finished" : row.truncated ? " · more matches not read" : "";
      return [{ label, text: `${read}${tail}` }];
    }
    // Older receipts carry no coverage at all, so the focused search cannot be described.
    if (key === "clinical / functional") return receipt.coverage.length ? [{ label, text: "Did not finish" }] : [];
    const state = receipt.scopes[key];
    return [{ label, text: state === "complete" ? "Complete" : state === "error" ? "Did not finish" : "Not available" }];
  });
}

export function buildLiteratureSummary(
  gene: string,
  variant: string,
  candidates: readonly SummaryCandidate[],
  scopes: LiteratureSummarySelection["scopes"] = { gene: "complete", variant: "complete", curated: "unavailable" },
): LiteratureSummarySelection {
  const byId = new Map<string, SummaryCandidate>();
  for (const candidate of candidates) {
    if (!candidate.abstract.trim()) continue;
    const previous = byId.get(candidate.id);
    // Curated records arrive first so the provider relation survives duplicate search hits.
    if (!previous) byId.set(candidate.id, candidate);
    else if (!Number.isFinite(previous.similarity) && Number.isFinite(candidate.similarity)) {
      byId.set(candidate.id, { ...previous, similarity: candidate.similarity });
    }
  }
  const evidence = buildLiteratureEvidence({ gene, variant, citations: [...byId.values()], response: null,
    executedQuery: "", narrowingFilter: "", groupFilter: "all", pinnedIds: new Set(),
    probe: { state: "idle", hitCount: null }, load: "ready", error: null });
  // An empty relevant pool is preferable to filling the narrative with unrelated abstracts.
  const ranked = evidence.papers.filter(paper => paper.mentions.level !== "elsewhere" || !!paper.screening.citedBy?.length).map(paper => ({
    ...paper.citation,
    screening: paper.screening,
    similarity: Number.isFinite(byId.get(paper.citation.id)?.similarity) ? byId.get(paper.citation.id)!.similarity! : null,
  })).sort((a, b) => a.screening.tier - b.screening.tier
    || (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity)
    || (b.year ?? -Infinity) - (a.year ?? -Infinity)
    || a.id.localeCompare(b.id));
  return { citations: ranked.slice(0, SUMMARY_CITATION_LIMIT), scopes,
    withoutEmbeddings: ranked.filter(citation => citation.similarity === null).length };
}

/** Volatile retrieval timestamps do not change a citation relationship or the prompt. */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["retrievedAt", "fetchedAt", "similarity"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

/**
 * The coverage the cache key and the prompt are both made from.
 *
 * How many pages fit in the time budget depends on how fast the upstream answered, not on the inputs,
 * so `loaded` and `truncated` stay out: with them, the same gene and variant hashed differently from
 * one run to the next. They stay out of the prompt too. A summary is cached under this key, so
 * anything the model was shown must be part of the key, or a cached summary could describe coverage
 * the receipt beside it no longer shows. A search that stopped early still changes the key through `state`.
 */
function stableCoverage(selection: LiteratureSummarySelection) {
  return (selection.coverage ?? []).map(({ loaded: _loaded, truncated: _truncated, ...stable }) => stable);
}

/** Server-owned cache identity, separate from the client-owned biological evidence revision. */
export function canonicalLiteratureSummary(selection: LiteratureSummarySelection): string {
  return JSON.stringify(stableValue({ selectionVersion: SUMMARY_SELECTION_VERSION, lexiconVersion: LEXICON_VERSION, ...selection, coverage: stableCoverage(selection) }));
}

function abstractExcerpt(citation: SummaryCitation): string {
  const anchor = citation.screening.tags.find(tag => tag.source === "sentence-anchor" || tag.tag === "names-variant");
  const index = anchor ? citation.abstract.indexOf(anchor.quote) : -1;
  const start = index > 650 ? Math.max(0, index - 120) : 0;
  return `${start ? "[Earlier abstract text omitted] " : ""}${citation.abstract.slice(start, start + 800)}`;
}

export function literatureSummaryPrompt(selection: LiteratureSummarySelection): string {
  return `[CITED SCIENTIFIC LITERATURE & CLINICAL ABSTRACTS]:
Selection: at most ${SUMMARY_CITATION_LIMIT} abstracts, ordered by screening tier, then available embedding similarity and publication year.
Retrieval scopes: ${JSON.stringify(selection.scopes)}. Search coverage (a search can match more papers than were read, so matched is not the number read): ${JSON.stringify(stableCoverage(selection))}. Candidates without embedding similarity: ${selection.withoutEmbeddings}.
${selection.citations.length ? selection.citations.map((citation, index) => `Citation #${index + 1}:
- Identifier: ${citation.id}
- Title: ${citation.title}
- Authors: ${citation.authors} (${citation.year ?? "year not reported"})
- Journal: ${citation.journal}
- Screening tier: ${citation.screening.tier}
- Screening observations: ${JSON.stringify(citation.screening.tags)}
- Curated record relationships: ${JSON.stringify(stableValue((citation as Citation & { curatedLinks?: unknown }).curatedLinks ?? []))}
- Abstract excerpt: ${abstractExcerpt(citation)}`).join("\n\n") : "No abstracts selected; draw no conclusion about absence of published evidence."}
INSTRUCTION: These are title/abstract observations and provider record relationships, not validated clinical evidence. Screening tags and curated citation links must NOT create or strengthen an ACMG/AMP criterion (including PS3, PS4, PP4, PM5 or PVS1). Never call lexical assay language a validated functional result. Cite identifier, authors and year only for claims actually supported by the supplied abstract excerpt; do not extrapolate from tags, full text, tables or unseen passages. An incomplete scope or missing embedding is not absence of literature.`;
}
