/** A bounded, reproducible input snapshot for narrative literature context. Never an ACMG input. */
import { buildLiteratureEvidence, type Citation } from "./literatureEvidence";
import { LEXICON_VERSION, type PaperScreening } from "./literatureScreening";

export const SUMMARY_SELECTION_VERSION = 1;
export const SUMMARY_CITATION_LIMIT = 5;
export type LiteratureScopeState = "complete" | "unavailable" | "error";
export interface SummaryCandidate extends Citation { similarity?: number | null }
export interface SummaryCitation extends Citation { screening: PaperScreening; similarity: number | null }
export interface LiteratureSummarySelection {
  citations: SummaryCitation[];
  scopes: { gene: LiteratureScopeState; variant: LiteratureScopeState; curated: LiteratureScopeState };
  withoutEmbeddings: number;
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
  const ranked = evidence.papers.map(paper => ({
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

/** Server-owned cache identity, separate from the client-owned biological evidence revision. */
export function canonicalLiteratureSummary(selection: LiteratureSummarySelection): string {
  return JSON.stringify(stableValue({ selectionVersion: SUMMARY_SELECTION_VERSION, lexiconVersion: LEXICON_VERSION, ...selection }));
}

export function literatureSummaryPrompt(selection: LiteratureSummarySelection): string {
  return `[CITED SCIENTIFIC LITERATURE & CLINICAL ABSTRACTS]:
Selection: at most ${SUMMARY_CITATION_LIMIT} abstracts, ordered by screening tier, then available embedding similarity and publication year.
Retrieval scopes: ${JSON.stringify(selection.scopes)}. Candidates without embedding similarity: ${selection.withoutEmbeddings}.
${selection.citations.length ? selection.citations.map((citation, index) => `Citation #${index + 1}:
- Identifier: ${citation.id}
- Title: ${citation.title}
- Authors: ${citation.authors} (${citation.year ?? "year not reported"})
- Journal: ${citation.journal}
- Screening tier: ${citation.screening.tier}
- Screening observations: ${JSON.stringify(citation.screening.tags)}
- Curated record relationships: ${JSON.stringify(stableValue((citation as Citation & { curatedLinks?: unknown }).curatedLinks ?? []))}
- Abstract excerpt: ${citation.abstract.slice(0, 800)}`).join("\n\n") : "No abstracts selected; draw no conclusion about absence of published evidence."}
INSTRUCTION: These are title/abstract observations and provider record relationships, not validated clinical evidence. Screening tags and curated citation links must NOT create or strengthen an ACMG/AMP criterion (including PS3, PS4, PP4, PM5 or PVS1). Never call lexical assay language a validated functional result. Cite identifier, authors and year only for claims actually supported by the supplied abstract excerpt; do not extrapolate from tags, full text, tables or unseen passages. An incomplete scope or missing embedding is not absence of literature.`;
}
