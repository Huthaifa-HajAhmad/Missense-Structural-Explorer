import {
  biophysicalAnalysisResponseSchema,
  BiophysicalAnalysisResponse
} from "../shared/contracts";
import { extractErrorMessage, FetchWithAuth } from "./authSession";

export function createBiophysicsApi(fetchWithAuth: FetchWithAuth) {
  return {
    async getBiophysicalAnalysis(
      params: { gene: string; uniprotId: string; variant: string; wtPdb?: string; options?: any },
      signal?: AbortSignal
    ): Promise<BiophysicalAnalysisResponse> {
      const res = await fetchWithAuth("/api/v1/analyze-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 90000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to get biophysical analysis");
        throw new Error(errorMsg);
      }
      const data = await res.json();
      return biophysicalAnalysisResponseSchema.parse(data);
    },

    async streamBiophysicalAnalysis(
      params: { gene: string; uniprotId: string; variant: string; acmgWeighting?: string; options?: any },
      onChunk: (chunk: any) => void,
      signal?: AbortSignal
    ): Promise<BiophysicalAnalysisResponse> {
      const res = await fetchWithAuth("/api/v1/analyze-variant/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 90000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to stream biophysical analysis");
        throw new Error(errorMsg);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Streaming not supported by browser environment.");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let finalPayload: any = null;
      const IDLE_WATCHDOG_MS = 30000;

      try {
        while (true) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let abortListener: (() => void) | undefined;

          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Streaming connection stalled: no data received for ${IDLE_WATCHDOG_MS / 1000}s.`));
            }, IDLE_WATCHDOG_MS);
          });

          const abortPromise = new Promise<never>((_, reject) => {
            if (signal?.aborted) {
              reject(new Error("Biophysical analysis stream aborted by client."));
              return;
            }
            if (signal) {
              abortListener = () => reject(new Error("Biophysical analysis stream aborted by client."));
              signal.addEventListener("abort", abortListener, { once: true });
            }
          });

          let readResult: ReadableStreamReadResult<Uint8Array>;
          try {
            readResult = await Promise.race([
              reader.read(),
              timeoutPromise,
              abortPromise
            ]);
          } finally {
            if (timer) clearTimeout(timer);
            if (signal && abortListener) {
              signal.removeEventListener("abort", abortListener);
            }
          }

          const { done, value } = readResult;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            let parsed: any;
            try {
              parsed = JSON.parse(line);
            } catch (err: any) {
              console.warn("[Stream Parse Warning]:", err);
              continue;
            }

            if (parsed.type === "error") {
              throw new Error(parsed.error || "Stream error");
            }
            if (parsed.isFinal || parsed.type === "full") {
              finalPayload = parsed.data || parsed.payload;
            }
            onChunk(parsed.data || parsed.payload || parsed);
          }
        }
      } catch (err) {
        try {
          await reader.cancel();
        } catch (_) {}
        throw err;
      } finally {
        try {
          reader.releaseLock();
        } catch (_) {}
      }

      if (buffer.trim()) {
        let parsed: any;
        try {
          parsed = JSON.parse(buffer);
        } catch (_) {}
        if (parsed) {
          if (parsed.type === "error") {
            throw new Error(parsed.error || "Stream error");
          }
          if (parsed.isFinal || parsed.type === "full") {
            finalPayload = parsed.data || parsed.payload;
          }
          onChunk(parsed.data || parsed.payload || parsed);
        }
      }

      return biophysicalAnalysisResponseSchema.parse(finalPayload);
    },

    async getLandscapeData(
      params: { gene: string; uniprotId: string; variant: string },
      signal?: AbortSignal
    ): Promise<{ landscapeData: any[] }> {
      const res = await fetchWithAuth("/api/v1/analyze-variant/landscape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        timeout: 130000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to get landscape data");
        throw new Error(errorMsg);
      }
      return await res.json();
    },

    async getStructuralAssessments(
      params: { gene: string; uniprotId: string; variant: string; acmgWeighting?: string; saprotEngine?: string },
      signal?: AbortSignal
    ): Promise<{
      esm3Eval: any;
      esmcEval: any;
      esm2Eval: any;
      saprotEval: any;
      ruleBasedInsights: any;
    }> {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (params.saprotEngine) {
        headers["X-SaProt-Engine"] = params.saprotEngine;
      }
      const res = await fetchWithAuth("/api/v1/analyze-variant/structural", {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        timeout: 125000,
        signal
      });
      if (!res.ok) {
        const errorMsg = await extractErrorMessage(res, "Failed to get structural assessments");
        throw new Error(errorMsg);
      }
      return await res.json();
    }
  };
}
