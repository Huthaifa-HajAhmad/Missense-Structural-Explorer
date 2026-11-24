import crypto from "node:crypto";
import { parseVariantForms, variantSearchQuery } from "../../../src/shared/literatureEvidence.ts";
import { buildLiteratureSummary, canonicalLiteratureSummary, type LiteratureSummarySelection, type SummaryCandidate } from "../../../src/shared/literatureSummary.ts";
import { searchGeneLiterature, retrieveRelevantLiterature, getLiteratureHitCount, getLiteratureNextCursor, literatureCacheKey, fetchLiteraturePage } from "./literature-rag.ts";

export const LITERATURE_SUMMARY_BUDGET_MS = 12_000;
export const LITERATURE_SUMMARY_PAGINATION_FLOOR_MS = 2_500;

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

type SummaryScopeKey = "gene" | "variant" | "clinical / functional";

interface PendingPagination {
  slot: number;
  scopeKey: SummaryScopeKey;
  query?: string;
  rows: SummaryCandidate[];
  matched: number | null;
  receipt: NonNullable<LiteratureSummarySelection["coverage"]>[number];
  cursor: string;
  maxPages: number;
}

/**
 * Probe variant scope on a cold first synthesis, independently of whether the tab was opened.
 * Phase 1 fetches page 1 of all four pools concurrently; Phase 2 runs bounded deeper paging only
 * while enough budget remains. No per-paper embedding calls: retrieved unembedded papers remain
 * eligible by tier and year.
 */
export async function selectSummaryCitations(
  gene: string, variant: string, uniprotId: string, customApiKey?: string, outerSignal?: AbortSignal,
): Promise<LiteratureSummarySelection> {
  const deadlineAt = Date.now() + LITERATURE_SUMMARY_BUDGET_MS;
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(new Error("Literature selection deadline exceeded")), LITERATURE_SUMMARY_BUDGET_MS);
  const signal = AbortSignal.any([budget.signal, ...(outerSignal ? [outerSignal] : [])]);
  try {
    const scopes: LiteratureSummarySelection["scopes"] = { gene: "error", variant: "unavailable", curated: "unavailable" };
    const pool: SummaryCandidate[][] = [[], [], [], []];
    const coverage: NonNullable<LiteratureSummarySelection["coverage"]> = [];
    const pending: PendingPagination[] = [];

    const collectPage1 = async (slot: number, scopeKey: SummaryScopeKey, query?: string, maxPages = 3) => {
      const result = await searchGeneLiterature(gene, customApiKey, signal, query);
      const rows = [...result.citations];
      const key = literatureCacheKey(gene, query);
      const matched = result.degraded ? null : getLiteratureHitCount(key);
      const cursor = result.degraded ? null : getLiteratureNextCursor(key);
      if (!result.degraded || slot === 1) pool[slot] = rows;
      const receipt: NonNullable<LiteratureSummarySelection["coverage"]>[number] = {
        scope: scopeKey,
        query: query ?? "Default gene search",
        loaded: rows.length,
        matched,
        state: result.degraded || signal.aborted ? "error" : "complete",
        truncated: !!cursor || (matched !== null && rows.length < matched),
      };
      coverage.push(receipt);
      if (!result.degraded && !signal.aborted && cursor && maxPages > 1) {
        pending.push({ slot, scopeKey, query, rows, matched, receipt, cursor, maxPages });
      }
      return { degraded: result.degraded, incomplete: result.degraded || signal.aborted };
    };

    const forms = parseVariantForms(variant);
    const query = forms ? variantSearchQuery(gene, forms) : null;
    const phase1Tasks = [
      (async () => {
        const result = await collectPage1(1, "gene", undefined, 3);
        scopes.gene = result.incomplete ? "error" : "complete";
      })(),
      (async () => {
        if (!query) return;
        scopes.variant = "error";
        const result = await collectPage1(2, "variant", query, 3);
        // A degraded gene-wide fallback must never acquire variant-scope provenance.
        if (!result.degraded) scopes.variant = result.incomplete ? "error" : "complete";
      })(),
      (async () => {
        const focused = `TITLE_ABS:${gene} AND ("case report" OR proband OR patient OR segregation OR "functional assay" OR "loss of function")`;
        await collectPage1(3, "clinical / functional", focused, 2);
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
    // Phase 1: every scope finishes its first page (or times out) independently before deeper paging starts.
    await boundedLiterature(Promise.allSettled(phase1Tasks), signal).catch(() => {});

    // Phase 2: optional bounded deeper paging while enough budget remains; stopping before a hopeless
    // page preserves `state: "complete"` with `truncated: true`. Scopes page at the same time on
    // purpose: each has its own cursor and page cap, and the final order comes from screening tier, so
    // no scope needs to wait for another and more papers are read in the same budget.
    if (!signal.aborted && deadlineAt - Date.now() >= LITERATURE_SUMMARY_PAGINATION_FLOOR_MS && pending.length > 0) {
      const phase2Tasks = pending.map(async (item) => {
        let cursor: string | null = item.cursor;
        for (let page = 1; cursor && page < item.maxPages; page++) {
          if (signal.aborted || deadlineAt - Date.now() < LITERATURE_SUMMARY_PAGINATION_FLOOR_MS) {
            break;
          }
          item.receipt.state = "error";
          try {
            const next = await fetchLiteraturePage(gene, item.query, cursor, signal);
            if (signal.aborted) {
              if (item.scopeKey === "gene" || item.scopeKey === "variant") {
                scopes[item.scopeKey] = "error";
              }
              break;
            }
            item.rows.push(...next.citations);
            pool[item.slot] = item.rows;
            cursor = next.nextCursor;
            item.receipt.loaded = new Set(item.rows.map(c => c.id)).size;
            item.receipt.truncated = !!cursor || (item.matched !== null && item.receipt.loaded < item.matched);
            item.receipt.state = "complete";
          } catch {
            item.receipt.state = "error";
            if (item.scopeKey === "gene" || item.scopeKey === "variant") {
              scopes[item.scopeKey] = "error";
            }
            break;
          }
        }
      });
      await boundedLiterature(Promise.allSettled(phase2Tasks), signal).catch(() => {});
      for (const item of pending) {
        if (item.receipt.state === "error" && (item.scopeKey === "gene" || item.scopeKey === "variant")) {
          scopes[item.scopeKey] = "error";
        }
      }
    }

    // Freeze before ranking so a late transport cannot change what is hashed and prompted.
    const candidates = pool.flat();
    const snapshotScopes = { ...scopes };
    const snapshotCoverage = coverage.map(row => ({ ...row }));
    let similarities = new Map<string, number>();
    if (!signal.aborted && snapshotScopes.gene === "complete") {
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
