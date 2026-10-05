import crypto from "node:crypto";
import { parseVariantForms, variantSearchQuery } from "../../../src/shared/literatureEvidence.ts";
import { buildLiteratureSummary, canonicalLiteratureSummary, type LiteratureSummarySelection, type SummaryCandidate } from "../../../src/shared/literatureSummary.ts";
import { searchGeneLiterature, retrieveRelevantLiterature } from "./literature-rag.ts";

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
    const pool: SummaryCandidate[][] = [[], [], []];
    const forms = parseVariantForms(variant);
    const query = forms ? variantSearchQuery(gene, forms) : null;
    const tasks = [
      (async () => {
        const result = await searchGeneLiterature(gene, customApiKey, signal);
        pool[1] = result.citations;
        scopes.gene = result.degraded ? "error" : "complete";
      })(),
      (async () => {
        if (!query) return;
        scopes.variant = "error";
        const result = await searchGeneLiterature(gene, customApiKey, signal, query);
        // A degraded gene-wide fallback must never acquire variant-scope provenance.
        if (!result.degraded) { pool[2] = result.citations; scopes.variant = "complete"; }
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
    let similarities = new Map<string, number>();
    if (!signal.aborted) {
      // Reuse similarities across the embedded default set, without its historical top-five cut.
      // Similarity never controls admission: every candidate is ranked by screening.
      const ranked = await boundedLiterature(retrieveRelevantLiterature(gene, `${gene} ${variant} functional activity pathogenicity stability`, customApiKey, signal, Infinity), signal).catch(() => []);
      similarities = new Map(ranked.filter(c => Number.isFinite(c.similarity)).map(c => [c.id, c.similarity]));
    }
    return buildLiteratureSummary(gene, variant, candidates.map(c => ({ ...c, similarity: similarities.get(c.id) ?? null })), snapshotScopes);
  } finally { clearTimeout(timer); }
}

export function literatureSummaryDigest(selection: LiteratureSummarySelection): string {
  return crypto.createHash("sha256").update(canonicalLiteratureSummary(selection)).digest("hex");
}
