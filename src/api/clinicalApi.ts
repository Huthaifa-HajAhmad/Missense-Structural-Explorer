import { z } from "zod";
import { extractErrorMessage, FetchWithAuth } from "./authSession";

export function createClinicalApi(fetchWithAuth: FetchWithAuth) {
  return {
    async getNarrative(
      params: any,
      signal?: AbortSignal
    ): Promise<{ analysis: string; isFallback?: boolean; fallbackReason?: string; insights?: any }> {
      const res = await fetchWithAuth("/api/v1/analyze-variant-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 120000,
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
