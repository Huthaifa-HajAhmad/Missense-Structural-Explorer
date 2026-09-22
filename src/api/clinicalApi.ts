import { z } from "zod";
import { extractErrorMessage, FetchWithAuth } from "./authSession";

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
      customQuery?: string
    ): Promise<{
      gene: string;
      citations: Array<{
        id: string;
        title: string;
        abstract: string;
        authors: string;
        journal: string;
        year: number | null;
        url?: string | null;
      }>;
      /** Europe PMC's total match count for the query — normally larger than the single
       *  page of citations returned, so the UI can explain the difference. */
      hitCount?: number | null;
      returnedCount?: number;
      query?: string | null;
    }> {
      const params = new URLSearchParams();
      if (force) params.set("force", "true");
      if (customQuery && customQuery.trim()) params.set("query", customQuery.trim());
      const qStr = params.toString() ? `?${params.toString()}` : "";
      const res = await fetchWithAuth(`/api/v1/literature/${encodeURIComponent(gene)}${qStr}`, {
        timeout: 45000,
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
        citations: z.array(z.object({
          id: z.string(),
          title: z.string(),
          abstract: z.string(),
          authors: z.string(),
          journal: z.string(),
          year: z.number().nullable(),
          url: z.string().nullable().optional()
        })),
        hitCount: z.number().nullable().optional(),
        returnedCount: z.number().optional(),
        query: z.string().nullable().optional()
      }).parse(await res.json());
    }
  };
}
