import { LRUCache } from "lru-cache";
import {
  type AlphaGenomeAviData,
  alphagenomeAviSchema,
  type AlphaGenomeRegionSaturationRequest,
  type AlphaGenomeRegionSaturationResponse,
  alphaGenomeRegionSaturationRequestSchema,
  alphaGenomeRegionSaturationResponseSchema,
  type AtlasUrls,
  generateAtlasUrls
} from "../../../src/shared/contracts.ts";
import { defaultCacheRegistry } from "../infra/cache-registry.ts";
import { buildAlphaGenomeKey } from "../infra/cache-keys.ts";
import { THRESHOLDS } from "../../../src/shared/thresholds.ts";
import { CONFIG } from "../../config.ts";

export type { AtlasUrls };
export { generateAtlasUrls };

export type AlphaGenomeProvider = (
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  signal?: AbortSignal
) => Promise<AlphaGenomeAviData>;

export type AlphaGenomeRegionProvider = (
  params: AlphaGenomeRegionSaturationRequest,
  signal?: AbortSignal
) => Promise<AlphaGenomeRegionSaturationResponse>;

// In-memory 30-day LRU cache for AlphaGenome predictions
export const alphagenomeCache = new LRUCache<string, NonNullable<AlphaGenomeAviData>>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 30 // 30 days
});

// In-memory 30-day LRU cache for AlphaGenome region saturation predictions
export const alphagenomeRegionCache = new LRUCache<string, NonNullable<AlphaGenomeRegionSaturationResponse>>({
  max: 500,
  ttl: 1000 * 60 * 60 * 24 * 30 // 30 days
});

// Register with global cache registry for telemetry diagnostics and unified flushes
defaultCacheRegistry.registerCache("alphagenomeCache", alphagenomeCache, { ttlDesc: "30d" });
defaultCacheRegistry.registerCache("alphagenomeRegionCache", alphagenomeRegionCache, { ttlDesc: "30d" });

export function clearAlphaGenomeCache(): void {
  alphagenomeCache.clear();
  alphagenomeRegionCache.clear();
}

let mockProvider: AlphaGenomeProvider | null = null;
let mockRegionProvider: AlphaGenomeRegionProvider | null = null;

export function setAlphaGenomeMockProvider(provider: AlphaGenomeProvider | null): void {
  mockProvider = provider;
}

export function setAlphaGenomeRegionMockProvider(provider: AlphaGenomeRegionProvider | null): void {
  mockRegionProvider = provider;
}

import {
  calculateAlphaGenomeAcmgStrength,
  queryAlphaGenomeVariantGrpc,
  queryAlphaGenomeRegionGrpc
} from "./alphagenome-client.ts";
import { governedFetch } from "../infra/http-client.ts";
import { isEgressRefusal } from "../infra/egress-governor.ts";

export { calculateAlphaGenomeAcmgStrength };

export interface FetchAlphaGenomeOptions {
  signal?: AbortSignal;
  apiKey?: string | null;
  apiUrl?: string | null;
  /**
   * Build the coordinates belong to, when known. Part of the cache key.
   *
   * AlphaGenome is GRCh38-only and looks up by numeric position, so an id from another build whose
   * alleles coincide resolves to a different locus. Absent is recorded as "unknown" rather than
   * defaulted to GRCh38, so a build-less coordinate cannot silently share an entry with a real
   * GRCh38 one.
   */
  assembly?: string | null;
}

/**
 * Which key and endpoint an AlphaGenome request may use.
 *
 * THE RULE: the server's own key only ever goes to the server's own endpoint.
 *
 * The endpoint can come from the request (`x-alphagenome-url`, `alphagenomeApiUrl`), so a researcher can
 * point at their own proxy. The key used to fall back to `ALPHAGENOME_API_KEY` regardless of where the
 * request was going, which let any caller have the server send its key, as a Bearer token, to a URL of
 * their choosing. Now a request-supplied endpoint gets a request-supplied key or none.
 *
 * The guard compares against the server key's VALUE, not where the argument came from, because several
 * callers merge the env key into `apiKey` before calling the bridge. Whatever they pass, the server key
 * cannot reach a foreign endpoint. The GPN path applies the same rule to `HF_TOKEN` through
 * `resolveGpnAccess` (`external-api/gpn.ts`).
 *
 * `customEndpoint` also keeps that proxy's answers out of the shared cache: a result from one user's
 * proxy must not be served to everyone for 30 days.
 */
export interface AlphaGenomeAccess {
  apiKey: string | null;
  endpoint: string | null;
  customEndpoint: boolean;
}

function normaliseEndpoint(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function resolveAlphaGenomeAccess(apiKey?: string | null, apiUrl?: string | null): AlphaGenomeAccess {
  const serverKey = process.env.ALPHAGENOME_API_KEY || CONFIG.services.alphagenomeApiKey || null;
  const serverEndpoint = process.env.ALPHAGENOME_API_URL || CONFIG.services.alphagenomeUrl || null;
  const endpoint = apiUrl || serverEndpoint;
  const customEndpoint = Boolean(apiUrl) && (!serverEndpoint || normaliseEndpoint(apiUrl as string) !== normaliseEndpoint(serverEndpoint));
  let key = apiKey || serverKey;
  if (customEndpoint && serverKey && key === serverKey) key = null;
  return { apiKey: key, endpoint, customEndpoint };
}

/**
 * Fetches AlphaGenome Variant Impact (AVI) scores and biological modality attributions.
 * Protected by an in-memory 30-day LRU cache, singleFlight deduplication, and a 2.5-second fast deadline.
 */
export async function fetchAlphaGenome(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  signalOrOptions?: AbortSignal | FetchAlphaGenomeOptions
): Promise<AlphaGenomeAviData> {
  const signal = signalOrOptions instanceof AbortSignal ? signalOrOptions : signalOrOptions?.signal;
  const apiKey = !(signalOrOptions instanceof AbortSignal) ? signalOrOptions?.apiKey : undefined;
  const apiUrl = !(signalOrOptions instanceof AbortSignal) ? signalOrOptions?.apiUrl : undefined;

  if (!chrom || typeof pos !== "number" || pos < 1 || !ref || !alt) {
    return {
      status: "unavailable",
      aviPhred: null,
      aviRaw: null,
      aviQuantile: null,
      topPercentile: null,
      topModality: null,
      topFeatureImportance: null,
      featureAttributions: null,
      acmgStrength: "indeterminate",
      message: "Invalid genomic coordinates for AlphaGenome"
    };
  }

  const normChrom = chrom.toLowerCase().startsWith("chr") ? chrom : `chr${chrom}`;
  const normRef = ref.toUpperCase();
  const normAlt = alt.toUpperCase();
  const { apiKey: effectiveApiKey, endpoint, customEndpoint } = resolveAlphaGenomeAccess(apiKey, apiUrl);
  const hasCredentials = Boolean(effectiveApiKey || endpoint);
  const assembly = !(signalOrOptions instanceof AbortSignal) ? (signalOrOptions?.assembly ?? null) : null;
  const cacheKey = buildAlphaGenomeKey(normChrom, pos, normRef, normAlt, assembly);

  const cached = alphagenomeCache.get(cacheKey);
  const isNegativeCached = Boolean(cached?.message?.includes("not indexed"));
  if (cached && (!hasCredentials || cached.status === "live" || isNegativeCached)) {
    return cached;
  }

  // A request aimed at its own proxy is private: it neither shares a flight with, nor writes to, the
  // cache every other user reads (see resolveAlphaGenomeAccess).
  const remember = (...args: Parameters<typeof alphagenomeCache.set>): void => {
    if (!customEndpoint) alphagenomeCache.set(...args);
  };
  const flightKey = customEndpoint ? `${cacheKey}|endpoint:${endpoint}` : cacheKey;

  return defaultCacheRegistry.singleFlight(flightKey, async () => {
    const doubleChecked = alphagenomeCache.get(cacheKey);
    const isDoubleNegative = Boolean(doubleChecked?.message?.includes("not indexed"));
    if (doubleChecked && (!hasCredentials || doubleChecked.status === "live" || isDoubleNegative)) {
      return doubleChecked;
    }

    const urls = generateAtlasUrls(normChrom, pos, normRef, normAlt);

    // Fast-deadline abort signal: race against 2.5s window
    const timeoutSignal = AbortSignal.timeout(2500);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    // If a test or sidecar provider is injected, use it directly with timeout bounds
    if (mockProvider) {
      try {
        if (combinedSignal.aborted) {
          throw new Error("Query aborted / timeout");
        }
        const res = await mockProvider(normChrom, pos, normRef, normAlt, combinedSignal);
        if (res && (res.status === "live" || res.message?.includes("not indexed"))) {
          remember(cacheKey, res);
        }
        return res;
      } catch (err: any) {
        return {
          status: "unavailable",
          aviPhred: null,
          aviRaw: null,
          aviQuantile: null,
          topPercentile: null,
          topModality: null,
          topFeatureImportance: null,
          featureAttributions: null,
          acmgStrength: "indeterminate",
          atlasUrl: urls.trackPredictionsUrl,
          message: err.message || "Provider query failed"
        };
      }
    }

    if (!endpoint && !effectiveApiKey) {
      // Unconfigured environment (neither endpoint nor API key provided): clean standby state (Zero synthetic fallback)
      const standbyResult: AlphaGenomeAviData = {
        status: "unavailable",
        aviPhred: null,
        aviRaw: null,
        aviQuantile: null,
        topPercentile: null,
        topModality: null,
        topFeatureImportance: null,
        featureAttributions: null,
        acmgStrength: "indeterminate",
        atlasUrl: urls.trackPredictionsUrl,
        message: "AlphaGenome Atlas: Key Required / Standby"
      };
      return standbyResult;
    }

    // Direct native gRPC connection to DeepMind when an API key is provided and no custom REST proxy is specified
    if (effectiveApiKey && !endpoint) {
      try {
        const grpcResult = await queryAlphaGenomeVariantGrpc(
          normChrom,
          pos,
          normRef,
          normAlt,
          effectiveApiKey,
          { signal: combinedSignal, timeoutMs: 2500 }
        );
        if (grpcResult && (grpcResult.status === "live" || grpcResult.message?.includes("not indexed"))) {
          remember(cacheKey, grpcResult);
        }
        return grpcResult;
      } catch (grpcErr: any) {
        return {
          status: "unavailable",
          aviPhred: null,
          aviRaw: null,
          aviQuantile: null,
          topPercentile: null,
          topModality: null,
          topFeatureImportance: null,
          featureAttributions: null,
          acmgStrength: "indeterminate",
          atlasUrl: urls.trackPredictionsUrl,
          message: grpcErr.message || "AlphaGenome Atlas query failed"
        };
      }
    }

    if (!endpoint) {
      return {
        status: "unavailable",
        aviPhred: null,
        aviRaw: null,
        aviQuantile: null,
        topPercentile: null,
        topModality: null,
        topFeatureImportance: null,
        featureAttributions: null,
        acmgStrength: "indeterminate",
        atlasUrl: urls.trackPredictionsUrl,
        message: "AlphaGenome endpoint not configured"
      };
    }

    try {
      const res = await governedFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(effectiveApiKey ? { Authorization: `Bearer ${effectiveApiKey}` } : {})
        },
        body: JSON.stringify({
          chrom: normChrom,
          pos,
          ref: normRef,
          alt: normAlt
        }),
        signal: combinedSignal
      });

    if (!res.ok) {
      throw new Error(`AlphaGenome API responded with status ${res.status}`);
    }

    const json = (await res.json()) as any;
    const phred = typeof json.avi_phred === "number" ? json.avi_phred : typeof json.phred === "number" ? json.phred : null;
    const raw = typeof json.avi_raw === "number" ? json.avi_raw : typeof json.raw === "number" ? json.raw : null;
    const quantile = typeof json.avi_quantile === "number" ? json.avi_quantile : null;
    const topPercentile = typeof json.top_percentile === "number" ? json.top_percentile : (phred !== null && phred >= 0 ? Math.pow(10, -phred / 10) * 100 : null);
    const topModality = typeof json.top_modality === "string" ? json.top_modality : null;
    const topFeatureImportance = typeof json.top_feature_importance === "number" ? json.top_feature_importance : null;
    const rawAttributions = (json.feature_attributions && typeof json.feature_attributions === "object" && !Array.isArray(json.feature_attributions))
      ? json.feature_attributions
      : null;

    const candidateData: AlphaGenomeAviData = {
      status: "live",
      aviPhred: phred,
      aviRaw: raw,
      aviQuantile: quantile,
      topPercentile,
      topModality,
      topFeatureImportance,
      featureAttributions: rawAttributions,
      acmgStrength: calculateAlphaGenomeAcmgStrength(phred),
      atlasUrl: urls.trackPredictionsUrl,
      message: null
    };

    const validated = alphagenomeAviSchema.safeParse(candidateData);
    if (!validated.success) {
      console.warn(`[AlphaGenome Bridge] Schema validation failed for ${cacheKey}:`, validated.error.format());
      const failData: AlphaGenomeAviData = {
        status: "unavailable",
        aviPhred: null,
        aviRaw: null,
        aviQuantile: null,
        topPercentile: null,
        topModality: null,
        topFeatureImportance: null,
        featureAttributions: null,
        acmgStrength: "indeterminate",
        atlasUrl: urls.trackPredictionsUrl,
        message: "Upstream AlphaGenome payload failed schema validation"
      };
      remember(cacheKey, failData, { ttl: 300_000 });
      return failData;
    }

    const data = validated.data!;
    remember(cacheKey, data);
    return data;
  } catch (err: any) {
    const errorResult: AlphaGenomeAviData = {
      status: "unavailable",
      aviPhred: null,
      aviRaw: null,
      aviQuantile: null,
      topPercentile: null,
      topModality: null,
      topFeatureImportance: null,
      featureAttributions: null,
      acmgStrength: "indeterminate",
      atlasUrl: urls.trackPredictionsUrl,
      message: err.message || "AlphaGenome query timed out / unavailable"
    };
    // A call the server held back (fair-share wait, team-wide 429 pause) says nothing about
    // AlphaGenome: caching it would show "unavailable" for five minutes after a 10 s pause.
    if (!isEgressRefusal(err)) remember(cacheKey, errorResult, { ttl: 300_000 });
    return errorResult;
  }
  });
}

/**
 * Fetches AlphaGenome saturation mutagenesis and 1D intolerance profile across a genomic region.
 * Protected by an in-memory 30-day LRU cache, singleFlight deduplication, and a 3.5-second fast deadline.
 */
export async function fetchAlphaGenomeRegionSaturation(
  params: AlphaGenomeRegionSaturationRequest,
  signalOrOptions?: AbortSignal | FetchAlphaGenomeOptions
): Promise<AlphaGenomeRegionSaturationResponse> {
  const signal = signalOrOptions instanceof AbortSignal ? signalOrOptions : signalOrOptions?.signal;
  const apiKey = !(signalOrOptions instanceof AbortSignal) ? signalOrOptions?.apiKey : undefined;
  const apiUrl = !(signalOrOptions instanceof AbortSignal) ? signalOrOptions?.apiUrl : undefined;

  const parsed = alphaGenomeRegionSaturationRequestSchema.safeParse(params);
  if (!parsed.success) {
    const errorDetail = parsed.error.issues?.[0]?.message;
    return {
      status: "unavailable",
      chrom: params?.chrom || "unknown",
      start: params?.start || 0,
      end: params?.end || 0,
      strand: params?.strand || null,
      transcriptId: params?.transcriptId || null,
      exonNumber: params?.exonNumber || null,
      exonStart: params?.exonStart || null,
      exonEnd: params?.exonEnd || null,
      positions: [],
      message: errorDetail
        ? `Invalid region parameters: ${errorDetail}`
        : "Invalid region parameters for AlphaGenome saturation request"
    };
  }

  const { chrom, start, end, strand, transcriptId, exonNumber, exonStart, exonEnd } = parsed.data;
  const normChrom = chrom.toLowerCase().startsWith("chr") ? chrom : `chr${chrom}`;
  const exonKey = exonNumber !== undefined || exonStart !== undefined || exonEnd !== undefined
    ? `:ex:${exonNumber ?? ""}_${exonStart ?? ""}-${exonEnd ?? ""}`
    : "";
  const cacheKey = `alphagenome:region:${normChrom}:${start}-${end}:${transcriptId || "all"}${exonKey}`;

  const { apiKey: effectiveApiKey, endpoint: baseEndpoint, customEndpoint } = resolveAlphaGenomeAccess(apiKey, apiUrl);
  const hasCredentials = Boolean(effectiveApiKey || baseEndpoint);

  const cached = alphagenomeRegionCache.get(cacheKey);
  const isNegativeCached = Boolean(cached?.message?.includes("not indexed"));
  if (cached && (!hasCredentials || cached.status === "live" || isNegativeCached)) {
    return cached;
  }

  // A request aimed at its own proxy is private: it neither shares a flight with, nor writes to, the
  // cache every other user reads (see resolveAlphaGenomeAccess).
  const remember = (...args: Parameters<typeof alphagenomeRegionCache.set>): void => {
    if (!customEndpoint) alphagenomeRegionCache.set(...args);
  };
  const flightKey = customEndpoint ? `${cacheKey}|endpoint:${baseEndpoint}` : cacheKey;

  return defaultCacheRegistry.singleFlight(flightKey, async () => {
    const doubleChecked = alphagenomeRegionCache.get(cacheKey);
    const isDoubleNegative = Boolean(doubleChecked?.message?.includes("not indexed"));
    if (doubleChecked && (!hasCredentials || doubleChecked.status === "live" || isDoubleNegative)) {
      return doubleChecked;
    }

    const locusUrl = `https://deepmind.google.com/science/alphagenome/atlas/locus?interval=${encodeURIComponent(normChrom)}%3A${start}-${end}`;

    // Fast-deadline abort signal: 3.5s window
    const timeoutSignal = AbortSignal.timeout(3500);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    if (mockRegionProvider) {
      try {
        if (combinedSignal.aborted) {
          throw new Error("Query aborted / timeout");
        }
        const res = await mockRegionProvider(parsed.data, combinedSignal);
        if (res && (res.status === "live" || res.message?.includes("not indexed"))) {
          remember(cacheKey, res);
        }
        return res;
      } catch (err: any) {
        return {
          status: "unavailable",
          chrom: normChrom,
          start,
          end,
          strand: strand || null,
          transcriptId: transcriptId || null,
          exonNumber: exonNumber || null,
          exonStart: exonStart || null,
          exonEnd: exonEnd || null,
          positions: [],
          atlasLocusUrl: locusUrl,
          message: err.message || "Mock provider query failed"
        };
      }
    }

    if (!baseEndpoint && !effectiveApiKey) {
      // Unconfigured environment (neither endpoint nor API key provided): clean standby state (Zero synthetic fallback)
      const standbyResult: AlphaGenomeRegionSaturationResponse = {
        status: "unavailable",
        chrom: normChrom,
        start,
        end,
        strand: strand || null,
        transcriptId: transcriptId || null,
        exonNumber: exonNumber || null,
        exonStart: exonStart || null,
        exonEnd: exonEnd || null,
        positions: [],
        atlasLocusUrl: locusUrl,
        message: "AlphaGenome Atlas: Key Required / Standby"
      };
      return standbyResult;
    }

    // Direct native gRPC connection to DeepMind when an API key is provided and no custom REST proxy is specified
    if (effectiveApiKey && !baseEndpoint) {
      try {
        const grpcResult = await queryAlphaGenomeRegionGrpc(
          parsed.data,
          effectiveApiKey,
          { signal: combinedSignal, timeoutMs: 3500 }
        );
        if (grpcResult && (grpcResult.status === "live" || grpcResult.message?.includes("not indexed"))) {
          remember(cacheKey, grpcResult);
        }
        return grpcResult;
      } catch (grpcErr: any) {
        return {
          status: "unavailable",
          chrom: normChrom,
          start,
          end,
          strand: strand || null,
          transcriptId: transcriptId || null,
          exonNumber: exonNumber || null,
          exonStart: exonStart || null,
          exonEnd: exonEnd || null,
          positions: [],
          atlasLocusUrl: locusUrl,
          message: grpcErr.message || "AlphaGenome Atlas region query failed"
        };
      }
    }

    if (!baseEndpoint) {
      return {
        status: "unavailable",
        chrom: normChrom,
        start,
        end,
        strand: strand || null,
        transcriptId: transcriptId || null,
        exonNumber: exonNumber || null,
        exonStart: exonStart || null,
        exonEnd: exonEnd || null,
        positions: [],
        atlasLocusUrl: locusUrl,
        message: "AlphaGenome endpoint not configured"
      };
    }

    try {
      const url = `${baseEndpoint.replace(/\/+$/, "")}/region-saturation`;
      const res = await governedFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(effectiveApiKey ? { Authorization: `Bearer ${effectiveApiKey}` } : {})
        },
        body: JSON.stringify({
          chrom: normChrom,
          start,
          end,
          strand,
          transcriptId,
          exonNumber,
          exonStart,
          exonEnd
        }),
        signal: combinedSignal
      });

      if (!res.ok) {
        throw new Error(`AlphaGenome API responded with status ${res.status}`);
      }

      const json = (await res.json()) as any;
      const rawPositions: any[] = Array.isArray(json.positions) ? json.positions : [];
      
      const positions = rawPositions.map((p) => {
        const variantsMap: Record<string, any> = {};
        const rawVars = p.variants || {};
        let phredSum = 0;
        let phredCount = 0;
        let maxPhred: number | null = null;
        let dominantModality: string | null = null;

        for (const base of ["A", "C", "G", "T"] as const) {
          if (base === p.ref) continue;
          const v = rawVars[base];
          if (v) {
            const phred = typeof v.phred === "number" ? v.phred : typeof v.avi_phred === "number" ? v.avi_phred : null;
            const acmgStrength = v.acmgStrength || calculateAlphaGenomeAcmgStrength(phred);
            const topModality = v.topModality || v.top_modality || null;
            variantsMap[base] = {
              alt: base,
              phred,
              raw: typeof v.raw === "number" ? v.raw : null,
              acmgStrength,
              topModality
            };
            if (phred !== null && !isNaN(phred) && phred >= 0) {
              phredSum += phred;
              phredCount++;
              if (maxPhred === null || phred > maxPhred) {
                maxPhred = phred;
                dominantModality = topModality;
              }
            }
          }
        }

        const meanPhred = phredCount > 0 ? phredSum / phredCount : null;

        return {
          pos: p.pos,
          ref: p.ref,
          // Provider's word first, then the exon bounds; with neither, a codon index is the only evidence
          // a base is coding. Defaulting to `true` labelled splice-flank bases exonic.
          isExonic: Boolean(
            p.isExonic ??
              (exonStart && exonEnd ? p.pos >= exonStart && p.pos <= exonEnd : typeof p.codonIndex === "number")
          ),
          codonIndex: typeof p.codonIndex === "number" ? p.codonIndex : null,
          codonPosition: typeof p.codonPosition === "number" ? p.codonPosition : null,
          variants: variantsMap,
          meanPhred: typeof p.meanPhred === "number" ? p.meanPhred : meanPhred,
          maxPhred: typeof p.maxPhred === "number" ? p.maxPhred : maxPhred,
          topModality: p.topModality || dominantModality
        };
      });

      const candidateData: AlphaGenomeRegionSaturationResponse = {
        status: "live",
        chrom: normChrom,
        start,
        end,
        strand: strand || null,
        transcriptId: transcriptId || null,
        exonNumber: exonNumber || null,
        exonStart: exonStart || null,
        exonEnd: exonEnd || null,
        positions,
        atlasLocusUrl: locusUrl,
        message: null
      };

      const validated = alphaGenomeRegionSaturationResponseSchema.safeParse(candidateData);
      if (!validated.success) {
        console.warn(`[AlphaGenome Bridge] Schema validation failed for region ${cacheKey}:`, validated.error.format());
        const failData: AlphaGenomeRegionSaturationResponse = {
          status: "unavailable",
          chrom: normChrom,
          start,
          end,
          strand: strand || null,
          transcriptId: transcriptId || null,
          exonNumber: exonNumber || null,
          exonStart: exonStart || null,
          exonEnd: exonEnd || null,
          positions: [],
          atlasLocusUrl: locusUrl,
          message: "Upstream AlphaGenome payload failed schema validation"
        };
        remember(cacheKey, failData, { ttl: 300_000 });
        return failData;
      }

      const data = validated.data;
      remember(cacheKey, data);
      return data;
    } catch (err: any) {
      const errorResult: AlphaGenomeRegionSaturationResponse = {
        status: "unavailable",
        chrom: normChrom,
        start,
        end,
        strand: strand || null,
        transcriptId: transcriptId || null,
        exonNumber: exonNumber || null,
        exonStart: exonStart || null,
        exonEnd: exonEnd || null,
        positions: [],
        atlasLocusUrl: locusUrl,
        message: err.message || "AlphaGenome region query timed out / unavailable"
      };
      // A call the server held back (fair-share wait, team-wide 429 pause) says nothing about
    // AlphaGenome: caching it would show "unavailable" for five minutes after a 10 s pause.
    if (!isEgressRefusal(err)) remember(cacheKey, errorResult, { ttl: 300_000 });
      return errorResult;
    }
  });
}
