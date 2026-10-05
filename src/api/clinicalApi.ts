import { z } from "zod";
import { extractErrorMessage, FetchWithAuth } from "./authSession";
import { withTransientRetry } from "../shared/fetch-retry";

/**
 * Client-side ceiling for a narrative synthesis request.
 *
 * MUST stay strictly greater than the server's own synthesis budget
 * (`NARRATIVE_SYNTHESIS_BUDGET_MS` = 105s in server/services/llm/gemini.ts). These two were
 * previously both 120s: the client's clock starts first, so it aborted before the server
 * could finish its graceful degradation, the socket closed, and the server's request-close
 * handler cancelled the in-flight provider call. The user then saw a bare network timeout
 * instead of the rule-based report the server had already assembled.
 *
 * 140s leaves the server ~35s of headroom to classify the failure and stream the fallback.
 */
export const CLINICAL_NARRATIVE_CLIENT_TIMEOUT_MS = 140_000;

/**
 * Budget for one literature read, retries included.
 *
 * Kept as ONE budget across attempts rather than per attempt: the retry exists to survive a
 * severed response, and a per-attempt 45s would let a pathological case hold the view's spinner
 * for three times as long as the first version promised.
 */
export const LITERATURE_CLIENT_TIMEOUT_MS = 45_000;

/**
 * One curated database record → paper relationship as the server sends it (Phase 1b). Validated so a
 * malformed link is a fetch error, not a crash in the screening/export code that reads it.
 */
const curatedLinkSchema = z.object({
  provider: z.enum(["uniprot", "clinvar"]),
  featureId: z.string().nullable(),
  accession: z.string().nullable(),
  variant: z.string(),
  variantDescription: z.string().nullable(),
  evidenceCode: z.string().nullable(),
  pmid: z.string(),
  source: z.string().nullable(),
  sourceUrl: z.string(),
  retrievedAt: z.string()
});

/**
 * One literature record. `curatedLinks` is optional so an older server's payload still validates.
 */
const literatureCitationSchema = z.object({
  id: z.string(),
  title: z.string(),
  abstract: z.string(),
  authors: z.string(),
  journal: z.string(),
  year: z.number().nullable(),
  url: z.string().nullable().optional(),
  publicationTypes: z.array(z.string()).nullable().optional(),
  meshHeadings: z.array(z.string()).nullable().optional(),
  authorKeywords: z.array(z.string()).nullable().optional(),
  curatedLinks: z.array(curatedLinkSchema).nullable().optional()
});

export type LiteratureCitationPayload = z.infer<typeof literatureCitationSchema>;

export function createClinicalApi(fetchWithAuth: FetchWithAuth) {
  return {
    async getNarrative(
      params: any,
      signal?: AbortSignal
    ): Promise<{
      analysis: string;
      isFallback?: boolean;
      fallbackReason?: string;
      fallbackMessage?: string;
      fallbackRetryable?: boolean;
      providerDetail?: string;
      attemptedModels?: string[];
      insights?: any;
    }> {
      const res = await fetchWithAuth("/api/v1/analyze-variant-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: CLINICAL_NARRATIVE_CLIENT_TIMEOUT_MS,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to fetch narrative");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return z.object({
        analysis: z.string(),
        isFallback: z.boolean().optional(),
        fallbackReason: z.string().optional(),
        fallbackMessage: z.string().optional(),
        fallbackRetryable: z.boolean().optional(),
        providerDetail: z.string().optional(),
        attemptedModels: z.array(z.string()).optional(),
        insights: z.any().optional()
      }).parse(data);
    },

    async getLiterature(
      gene: string, 
      force = false, 
      signal?: AbortSignal,
      customQuery?: string,
      /**
       * Phase 1b context: the variant and its UniProt accession let the server attach curated
       * variant-record relationships. Optional, so an older caller keeps the plain search.
       */
      context?: { variant?: string; uniprot?: string }
    ): Promise<{
      gene: string;
      citations: LiteratureCitationPayload[];
      /**
       * Curated records the ordinary query did not match (Phase 1b). Returned separately so the caller
       * can show them without counting them as query membership.
       */
      curatedCitations?: LiteratureCitationPayload[];
      /** Europe PMC's total match count for the query — normally larger than the single
       *  page of citations returned, so the UI can explain the difference. */
      hitCount?: number | null;
      returnedCount?: number;
      query?: string | null;
      /** The Europe PMC query string the server sent (or, when `degraded`, tried to send). */
      europePmcQuery?: string | null;
      /** Europe PMC did not answer: the citations are the gene's cached set, not this query's own. */
      degraded?: boolean;
      /** When this query's own sweep last completed (ms since epoch); null when unknown or degraded. */
      fetchedAt?: number | null;
      pageSize?: number;
      /** Curated variant-citation coverage; null/absent when no variant+accession context was sent. */
      curated?: {
        state: "complete" | "unavailable" | "error";
        reason?: string;
        linked?: number;
      } | null;
    }> {
      const params = new URLSearchParams();
      if (force) params.set("force", "true");
      if (customQuery && customQuery.trim()) params.set("query", customQuery.trim());
      if (context?.variant && context.variant.trim()) params.set("variant", context.variant.trim());
      if (context?.uniprot && context.uniprot.trim()) params.set("uniprot", context.uniprot.trim());
      const qStr = params.toString() ? `?${params.toString()}` : "";
      const url = `/api/v1/literature/${encodeURIComponent(gene)}${qStr}`;

      /**
       * Request AND body read under one retry policy.
       *
       * `fetchWithRetry` inside `fetchWithAuth` only guards the connection: once the headers are
       * in, a response cut mid-body — the observed production failure, where the console stack had
       * a single frame in the body-stall watchdog's `pull` — rejected `res.json()` with the raw
       * `TypeError: Failed to fetch` and nothing retried it. This GET is idempotent, so the whole
       * operation is re-issued, capped by the budget below.
       */
      const deadlineAt = Date.now() + LITERATURE_CLIENT_TIMEOUT_MS;
      return await withTransientRetry(async () => {
        const res = await fetchWithAuth(url, {
          // Cap each attempt by the budget that is actually left, so a retry cannot outlive the
          // watchdog deadline the caller set for the whole read.
          timeout: Math.max(1_000, deadlineAt - Date.now()),
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to fetch literature");
          throw new Error(errorMsg);
        }
        // Validated, not cast: an unvalidated `any[]` here once let a malformed payload
        // through to the list view, where a missing `title` crashed rendering instead of
        // surfacing as the fetch error it is.
        return z.object({
          gene: z.string(),
          citations: z.array(literatureCitationSchema),
          curatedCitations: z.array(literatureCitationSchema).optional(),
          hitCount: z.number().nullable().optional(),
          returnedCount: z.number().optional(),
          query: z.string().nullable().optional(),
          // Absent from a server that predates the provenance fields; the tab then says "not reported".
          europePmcQuery: z.string().nullable().optional(),
          degraded: z.boolean().optional(),
          fetchedAt: z.number().nullable().optional(),
          pageSize: z.number().optional(),
          curated: z.object({
            state: z.enum(["complete", "unavailable", "error"]),
            reason: z.string().optional(),
            linked: z.number().optional()
          }).nullable().optional()
        }).parse(await res.json());
      }, { deadlineAt, signal });
    }
  };
}
