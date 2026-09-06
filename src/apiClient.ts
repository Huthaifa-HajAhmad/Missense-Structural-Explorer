import { useCallback, useMemo } from "react";
import { useSettings } from "./context/SettingsContext";
import { z } from "zod";
import {
  translateVariantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  biophysicalAnalysisResponseSchema,
  esmFoldResponseSchema,
  structuralAlignResponseSchema,
  structuralDiffResponseSchema,
  TranslateVariantResponse,
  NearestResiduesResponse,
  PocketFinderResponse,
  BiophysicalAnalysisResponse,
  EsmFoldResponse,
  StructuralAlignResponse,
  StructuralDiffResponse
} from "./shared/contracts";
import { fetchWithRetry } from "./shared/fetch-retry";

// Circuit-breaker set to prevent repetitive 403 authentication spam loops when an API key is invalid
const invalidApiKeys = new Set<string>();

/**
 * Unified helper to extract researcher-friendly error messages from API responses.
 * Gracefully parses standardized { error: { message } }, { message }, { detail },
 * plain text error bodies, and provides clear HTTP status codes without trailing colons.
 */
export async function extractErrorMessage(res: Response, fallbackPrefix: string): Promise<string> {
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data) {
        if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
        if (data.error?.message && typeof data.error.message === "string" && data.error.message.trim()) return data.error.message.trim();
        if (data.message && typeof data.message === "string" && data.message.trim()) return data.message.trim();
        if (data.detail && typeof data.detail === "string" && data.detail.trim()) return data.detail.trim();
      }
    } else {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        return text.length > 250 ? `${text.slice(0, 250)}...` : text.trim();
      }
    }
  } catch (_) {
    // Ignore JSON/text body consumption errors
  }
  const statusInfo = res.status ? `(HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""})` : "";
  return `${fallbackPrefix} ${statusInfo}`.trim();
}

export function useApiClient() {
  const { settings, updateSetting } = useSettings();

  const { 
    geminiSessionId, 
    geminiSessionExpiresAt, 
    geminiApiKey, 
    appApiToken, 
    biohubApiToken, 
    tamarindApiKey, 
    hfToken
  } = settings;

  const fetchWithAuth = useCallback(async (
    url: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<Response> => {
    let currentSessionId = geminiSessionId;
    const expiresAt = geminiSessionExpiresAt || 0;

    let timeoutId: any = null;
    let signal = options.signal;
    const controller = options.timeout ? new AbortController() : null;

    if (controller && options.timeout) {
      if (options.signal) {
        options.signal.addEventListener("abort", () => controller.abort());
      }
      signal = controller.signal;
      timeoutId = setTimeout(() => {
        controller.abort();
      }, options.timeout);
    }

    try {
      // Proactively refresh session ID if near expiry (< 60s) or missing
      if (currentSessionId && Date.now() < expiresAt && Date.now() >= (expiresAt - 60000)) {
        try {
          const refreshHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Gemini-Session-ID": currentSessionId
          };
          if (appApiToken) {
            refreshHeaders["Authorization"] = `Bearer ${appApiToken}`;
          }
          const refreshRes = await fetch("/api/v1/session/refresh", {
            method: "POST",
            headers: refreshHeaders,
            signal
          });
          if (refreshRes.ok) {
            const refreshData = await refreshRes.json();
            if (refreshData.sessionId) {
              currentSessionId = refreshData.sessionId;
              updateSetting("geminiSessionId", refreshData.sessionId);
              updateSetting("geminiSessionExpiresAt", refreshData.expiresAt || (Date.now() + 15 * 60 * 1000));
            }
          }
        } catch (err) {
          // Fall back to attempting request with current credentials
        }
      } else if (geminiApiKey && !invalidApiKeys.has(geminiApiKey) && (!currentSessionId || Date.now() >= expiresAt)) {
        try {
          const reauthHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (appApiToken) {
            reauthHeaders["Authorization"] = `Bearer ${appApiToken}`;
          }
          const sessionRes = await fetch("/api/v1/session/keys", {
            method: "POST",
            headers: reauthHeaders,
            body: JSON.stringify({ apiKey: geminiApiKey }),
            signal: signal
          });
          if (sessionRes.ok) {
            invalidApiKeys.delete(geminiApiKey);
            const sessionData = await sessionRes.json();
            if (sessionData.sessionId) {
              currentSessionId = sessionData.sessionId;
              updateSetting("geminiSessionId", sessionData.sessionId);
              updateSetting("geminiSessionExpiresAt", sessionData.expiresAt || (Date.now() + 15 * 60 * 1000));
            }
          } else if (sessionRes.status === 400 || sessionRes.status === 403) {
            invalidApiKeys.add(geminiApiKey);
            console.warn("[apiClient] Gemini API key is invalid or unauthorized. Pausing auto-authentication attempts for this key until updated in Settings.");
          }
        } catch (err) {
          // Fall back to attempting request with current credentials
        }
      }

      const headers = { ...(options.headers as Record<string, string> || {}) };
      const isRelativeOrSameOrigin = !url.startsWith("http://") && !url.startsWith("https://");
      if (isRelativeOrSameOrigin) {
        if (currentSessionId) {
          headers["X-Gemini-Session-ID"] = currentSessionId;
        }
        if (appApiToken) {
          headers["Authorization"] = `Bearer ${appApiToken}`;
        }
        if (biohubApiToken) {
          headers["x-biohub-token"] = biohubApiToken;
        }
        if (tamarindApiKey) {
          headers["x-tamarind-api-key"] = tamarindApiKey;
        }
        if (hfToken) {
          headers["x-hf-token"] = hfToken;
        }
      }

      let response = await fetchWithRetry(url, { ...options, headers, signal });

      // Attempt re-auth if 401 is returned (e.g. server restart)
      if (response.status === 401 && geminiApiKey && !invalidApiKeys.has(geminiApiKey)) {
        try {
          const reauthHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (appApiToken) {
            reauthHeaders["Authorization"] = `Bearer ${appApiToken}`;
          }
          const sessionRes = await fetch("/api/v1/session/keys", {
            method: "POST",
            headers: reauthHeaders,
            body: JSON.stringify({ apiKey: geminiApiKey }),
            signal: signal
          });
          if (sessionRes.ok) {
            invalidApiKeys.delete(geminiApiKey);
            const sessionData = await sessionRes.json();
            if (sessionData.sessionId) {
              updateSetting("geminiSessionId", sessionData.sessionId);
              updateSetting("geminiSessionExpiresAt", sessionData.expiresAt || (Date.now() + 15 * 60 * 1000));

              const retryHeaders = {
                ...headers
              };
              if (isRelativeOrSameOrigin && sessionData.sessionId) {
                retryHeaders["X-Gemini-Session-ID"] = sessionData.sessionId;
              }
              response = await fetchWithRetry(url, { ...options, headers: retryHeaders, signal });
            }
          } else if (sessionRes.status === 400 || sessionRes.status === 403) {
            invalidApiKeys.add(geminiApiKey);
          }
        } catch (reauthErr) {
          console.error("Transparent re-authentication failed:", reauthErr);
        }
      }

      return response;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }, [
    geminiSessionId, 
    geminiSessionExpiresAt, 
    geminiApiKey, 
    appApiToken, 
    biohubApiToken, 
    tamarindApiKey, 
    hfToken, 
    updateSetting
  ]);

  const apiClient = useMemo(() => {
    return {
      async resolveGene(gene: string, signal?: AbortSignal): Promise<{ gene: string; uniprotId: string; pdbUrl?: string | null }> {
        const res = await fetchWithAuth("/api/v1/resolve-gene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gene }),
          timeout: 10000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to resolve gene");
          throw new Error(errorMsg);
        }
        return await res.json();
      },

      async translateVariant(variant: string, signal?: AbortSignal): Promise<TranslateVariantResponse> {
        const res = await fetchWithAuth("/api/v1/translate-variant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variant }),
          timeout: 10000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to translate variant");
          throw new Error(errorMsg);
        }
        const data = await res.json();
        return translateVariantResponseSchema.parse(data);
      },

      async getSequence(uniprotId: string, signal?: AbortSignal): Promise<string> {
        const res = await fetchWithAuth(`/api/v1/sequence/${encodeURIComponent(uniprotId)}`, {
          timeout: 10000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to fetch sequence");
          throw new Error(errorMsg);
        }
        const data = await res.json();
        return z.object({ sequence: z.string() }).parse(data).sequence;
      },

      async getPdb(uniprotId: string, pos?: number, signal?: AbortSignal): Promise<string> {
        const posQuery = pos ? `?pos=${pos}` : "";
        const res = await fetchWithAuth(`/api/v1/pdb/${encodeURIComponent(uniprotId)}${posQuery}`, {
          timeout: 15000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to fetch PDB structure");
          throw new Error(errorMsg);
        }
        return await res.text();
      },

      async getAlphaFoldPdb(uniprotId: string, signal?: AbortSignal): Promise<string> {
        const res = await fetchWithAuth(`/api/v1/alphafold-pdb/${encodeURIComponent(uniprotId)}`, {
          timeout: 35000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to fetch AlphaFold model");
          throw new Error(errorMsg);
        }
        return await res.text();
      },

      async getHomologs(uniprotId: string, pos?: number, signal?: AbortSignal): Promise<any[]> {
        const query = pos != null ? `?pos=${encodeURIComponent(pos)}` : "";
        const res = await fetchWithAuth(`/api/v1/homologs/${encodeURIComponent(uniprotId)}${query}`, {
          timeout: 35000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to fetch homologs");
          throw new Error(errorMsg);
        }
        const data = await res.json();
        return z.object({ homologs: z.array(z.any()) }).parse(data).homologs;
      },

      async getNearestResidues(params: { pdbText?: string, pdbRef?: string, uniprotId?: string, targetIndex: number, distanceThreshold: number, targetChain?: string }, signal?: AbortSignal): Promise<NearestResiduesResponse> {
        const res = await fetchWithAuth("/api/v1/nearest-residues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 10000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to fetch nearest residues");
          throw new Error(errorMsg);
        }
        const data = await res.json();
        return nearestResiduesResponseSchema.parse(data);
      },

      async findPocket(params: { pdbText?: string, pdbRef?: string, uniprotId?: string, mutIndex: number, targetChain?: string }, signal?: AbortSignal): Promise<PocketFinderResponse> {
        const res = await fetchWithAuth("/api/v1/pocket-finder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 30000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to find binding pocket");
          throw new Error(errorMsg);
        }
        const initialData = await res.json();
        if (initialData.status === "queued" && initialData.pocketJobId) {
          let attempt = 0;
          const maxAttempts = 60;
          while (attempt < maxAttempts) {
            if (signal?.aborted) {
              throw new Error("Pocket search query aborted by client.");
            }
            const jobRes = await fetchWithAuth(`/api/v1/pocket-job/${initialData.pocketJobId}`, {
              method: "GET",
              signal
            });
            if (!jobRes.ok) {
              const errorMsg = await extractErrorMessage(jobRes, "Failed to poll pocket job status");
              throw new Error(errorMsg);
            }
            const jobData = await jobRes.json();
            if (jobData.status === "completed") {
              return pocketFinderResponseSchema.parse(jobData.result);
            } else if (jobData.status === "failed") {
              throw new Error(jobData.error || "Pocket search job failed.");
            }
            attempt++;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          throw new Error("Pocket search job timed out on server.");
        }
        return pocketFinderResponseSchema.parse(initialData);
      },

      async detectPocket(params: { pdbText?: string, pdbRef?: string, uniprotId?: string, targetIndex: number, targetChain?: string }, signal?: AbortSignal): Promise<PocketFinderResponse> {
        const res = await fetchWithAuth("/api/v1/pocket-detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 30000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to detect binding pocket");
          throw new Error(errorMsg);
        }
        const initialData = await res.json();
        if (initialData.status === "queued" && initialData.pocketJobId) {
          let attempt = 0;
          const maxAttempts = 60;
          while (attempt < maxAttempts) {
            if (signal?.aborted) {
              throw new Error("Pocket detection query aborted by client.");
            }
            const jobRes = await fetchWithAuth(`/api/v1/pocket-job/${initialData.pocketJobId}`, {
              method: "GET",
              signal
            });
            if (!jobRes.ok) {
              const errorMsg = await extractErrorMessage(jobRes, "Failed to poll pocket job status");
              throw new Error(errorMsg);
            }
            const jobData = await jobRes.json();
            if (jobData.status === "completed") {
              return pocketFinderResponseSchema.parse(jobData.result);
            } else if (jobData.status === "failed") {
              throw new Error(jobData.error || "Pocket detection job failed.");
            }
            attempt++;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          throw new Error("Pocket detection job timed out on server.");
        }
        return pocketFinderResponseSchema.parse(initialData);
      },

      async getBiophysicalAnalysis(params: { gene: string, uniprotId: string, variant: string, wtPdb?: string, options?: any }, signal?: AbortSignal): Promise<BiophysicalAnalysisResponse> {
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
        params: { gene: string, uniprotId: string, variant: string, acmgWeighting?: string, options?: any },
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
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to stream biophysical analysis: ${res.statusText}`);
        }

        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("Streaming not supported by browser environment.");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let finalPayload: any = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "error") {
                throw new Error(parsed.error || "Stream error");
              }
              if (parsed.isFinal || parsed.type === "full") {
                finalPayload = parsed.data || parsed.payload;
              }
              onChunk(parsed.data || parsed.payload || parsed);
            } catch (err: any) {
              console.warn("[Stream Parse Warning]:", err);
            }
          }
        }

        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.isFinal || parsed.type === "full") {
              finalPayload = parsed.data || parsed.payload;
            }
            onChunk(parsed.data || parsed.payload || parsed);
          } catch (_) {}
        }

        return biophysicalAnalysisResponseSchema.parse(finalPayload);
      },

      async getLandscapeData(params: { gene: string, uniprotId: string, variant: string }, signal?: AbortSignal): Promise<{ landscapeData: any[] }> {
        const res = await fetchWithAuth("/api/v1/analyze-variant/landscape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 130000,
          signal
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to get landscape data: ${res.statusText}`);
        }
        return await res.json();
      },

      async getStructuralAssessments(params: { gene: string, uniprotId: string, variant: string, acmgWeighting?: string }, signal?: AbortSignal): Promise<{
        esm3Eval: any;
        esmcEval: any;
        esm2Eval: any;
        saprotEval: any;
        ruleBasedInsights: any;
      }> {
        const res = await fetchWithAuth("/api/v1/analyze-variant/structural", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 45000,
          signal
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to get structural assessments: ${res.statusText}`);
        }
        return await res.json();
      },

      async getNarrative(params: any, signal?: AbortSignal): Promise<{ analysis: string; insights?: any }> {
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
          insights: z.any().optional()
        }).parse(data);
      },

      async foldSequence(params: { sequence?: string, uniprotId?: string, variant?: string }, signal?: AbortSignal): Promise<EsmFoldResponse> {
        const res = await fetchWithAuth("/api/v1/esmfold", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 45000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to run ESMFold");
          throw new Error(errorMsg);
        }
        const data = await res.json();
        return esmFoldResponseSchema.parse(data);
      },

      async structuralAlign(params: { pdb1: string, pdb2: string, targetIndex?: number }, signal?: AbortSignal): Promise<StructuralAlignResponse> {
        const res = await fetchWithAuth("/api/v1/structural-align", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 30000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to align structures");
          throw new Error(errorMsg);
        }
        const data = await res.json();
        return structuralAlignResponseSchema.parse(data);
      },

      async getStructuralDiff(params: { wtPdb: string, mutPdb: string, pos: number, chain: string }, signal?: AbortSignal): Promise<StructuralDiffResponse> {
        const res = await fetchWithAuth("/api/v1/structural-diff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          timeout: 30000,
          signal
        });
        if (!res.ok) {
          const errorMsg = await extractErrorMessage(res, "Failed to compute structural difference");
          throw new Error(errorMsg);
        }
        const data = await res.json();
        return structuralDiffResponseSchema.parse(data);
      },

      async getLiterature(
        gene: string, 
        force = false, 
        signal?: AbortSignal,
        customQuery?: string
      ): Promise<{ gene: string, citations: any[] }> {
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
      },

      async getSidecarHealth(signal?: AbortSignal): Promise<{
        reachable: boolean;
        baseUrl: string;
        latencyMs?: number;
        status?: string;
        modelLoaded?: boolean;
        activeModels?: number;
        error?: string;
        remediation?: { local: string; oci: string };
      }> {
        const res = await fetchWithAuth("/api/structure/sidecar-health", {
          timeout: 5000,
          signal
        });
        if (!res.ok) {
          return {
            reachable: false,
            baseUrl: "",
            error: `Health check failed with HTTP ${res.status}`
          };
        }
        return await res.json();
      }
    };
  }, [fetchWithAuth]);

  return { fetchWithAuth, apiClient };
}
