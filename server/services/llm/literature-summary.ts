import crypto from "node:crypto";
import { parseVariantForms, variantSearchQuery } from "../../../src/shared/literatureEvidence.ts";
import { buildLiteratureSummary, canonicalLiteratureSummary, type LiteratureSummarySelection, type SummaryCandidate } from "../../../src/shared/literatureSummary.ts";
import { searchGeneLiterature, retrieveRelevantLiterature, getLiteratureHitCount, getLiteratureNextCursor, literatureCacheKey, fetchLiteraturePage } from "./literature-rag.ts";

export const LITERATURE_SUMMARY_BUDGET_MS = 5_000;

/** Enforces the optional-context budget even when a transport or shared sync ignores cancellation. */
export async function boundedLiterature<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Literature retrieval cancelled"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

/**
 * Probe variant scope on a cold first synthesis, independently of whether the tab was opened.
 * No per-paper embedding calls: retrieved unembedded papers remain eligible by tier and year.
 */
export async function selectSummaryCitations(
  gene: string, variant: string, uniprotId: string, customApiKey?: string, outerSignal?: AbortSignal,
): Promise<LiteratureSummarySelection> {
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(new Error("Literature selection deadline exceeded")), LITERATURE_SUMMARY_BUDGET_MS);
  const signal = AbortSignal.any([budget.signal, ...(outerSignal ? [outerSignal] : [])]);
  try {
    const scopes: LiteratureSummarySelection["scopes"] = { gene: "error", variant: "unavailable", curated: "unavailable" };
    const pool: SummaryCandidate[][] = [[], [], [], []];
    const coverage: NonNullable<LiteratureSummarySelection["coverage"]> = [];
    const collect = async (slot: number, scope: string, query?: string, maxPages = 4) => {
      const result = await searchGeneLiterature(gene, customApiKey, signal, query);
      const rows = [...result.citations];
      const key = literatureCacheKey(gene, query);
      const matched = result.degraded ? null : getLiteratureHitCount(key);
      let cursor = result.degraded ? null : getLiteratureNextCursor(key);
      let failed = result.degraded;
      if (!result.degraded || slot === 1) pool[slot] = rows;
      const receipt: NonNullable<LiteratureSummarySelection["coverage"]>[number] = { scope, query: query ?? "Default gene search", loaded: rows.length, matched, state: "error", truncated: !!cursor || (matched !== null && rows.length < matched) };
      coverage.push(receipt);
      for (let page = 1; cursor && page < maxPages && !signal.aborted; page++) {
        try {
          const next = await fetchLiteraturePage(gene, query, cursor, signal);
          rows.push(...next.citations); cursor = next.nextCursor;
          receipt.loaded = new Set(rows.map(c => c.id)).size; receipt.truncated = !!cursor || (matched !== null && receipt.loaded < matched);
        } catch { failed = true; break; }
      }
      receipt.state = failed || signal.aborted ? "error" : "complete";
      return { citations: rows, degraded: result.degraded, incomplete: failed || signal.aborted };
    };
    const forms = parseVariantForms(variant);
    const query = forms ? variantSearchQuery(gene, forms) : null;
    const tasks = [
      (async () => {
        const result = await collect(1, "gene");
        pool[1] = result.citations;
        scopes.gene = result.incomplete ? "error" : "complete";
      })(),
      (async () => {
        if (!query) return;
        scopes.variant = "error";
        const result = await collect(2, "variant", query);
        // A degraded gene-wide fallback must never acquire variant-scope provenance.
        if (!result.degraded) { pool[2] = result.citations; scopes.variant = result.incomplete ? "error" : "complete"; }
      })(),
      (async () => {
        const focused = `TITLE_ABS:${gene} AND ("case report" OR proband OR patient OR segregation OR "functional assay" OR "loss of function")`;
        const result = await collect(3, "clinical / functional", focused, 2);
        if (!result.degraded) pool[3] = result.citations;
      })(),
      (async () => {
        if (!uniprotId) return;
        scopes.curated = "error";
        const { getCuratedVariantCitations } = await import("./curated-literature.ts");
        const result = await getCuratedVariantCitations(gene, variant, uniprotId, signal);
        pool[0] = result.citations;
        scopes.curated = result.state;
      })(),
    ];
    // Each branch owns its result; partial completed scopes survive a slow optional source.
    await boundedLiterature(Promise.allSettled(tasks), signal).catch(() => {});
    // Freeze before ranking so a late transport cannot change what is hashed and prompted.
    const candidates = pool.flat();
    const snapshotScopes = { ...scopes };
    const snapshotCoverage = coverage.map(row => ({ ...row }));
    let similarities = new Map<string, number>();
    if (!signal.aborted) {
      // Reuse similarities across the embedded default set, without its historical top-five cut.
      // Similarity never controls admission: every candidate is ranked by screening.
      const ranked = await boundedLiterature(retrieveRelevantLiterature(gene, `${gene} ${variant} functional activity pathogenicity stability`, customApiKey, signal, Infinity), signal).catch(() => []);
      similarities = new Map(ranked.filter(c => Number.isFinite(c.similarity)).map(c => [c.id, c.similarity]));
    }
    return { ...buildLiteratureSummary(gene, variant, candidates.map(c => ({ ...c, similarity: similarities.get(c.id) ?? null })), snapshotScopes), coverage: snapshotCoverage };
  } finally { clearTimeout(timer); }
}

export function literatureSummaryDigest(selection: LiteratureSummarySelection): string {
  return crypto.createHash("sha256").update(canonicalLiteratureSummary(selection)).digest("hex");
}
