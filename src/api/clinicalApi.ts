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
    ): Promise<{ gene: string; citations: any[] }> {
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
      return await res.json();
    }
  };
}
