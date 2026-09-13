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
} from "../../src/shared/contracts.ts";
import { defaultCacheRegistry } from "./cache-registry.ts";
import { buildAlphaGenomeKey } from "./cache-keys.ts";
import { THRESHOLDS } from "../../src/shared/thresholds.ts";
import { CONFIG } from "../config.ts";

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

/**
 * Maps calibrated continuous AVI Phred scores to ClinGen SVI Bayesian pathogenicity tiers.
 * Strictly guards against negative numbers (sentinels or calculation errors).
 */
export function calculateAlphaGenomeAcmgStrength(
  phred: number | null | undefined
): "PP3_Strong" | "PP3_Moderate" | "PP3_Supporting" | "BP4_Supporting" | "BP4_Moderate" | "indeterminate" {
  if (phred === null || phred === undefined || isNaN(phred) || phred < 0) {
    return "indeterminate";
  }
  if (phred >= THRESHOLDS.alphagenome.pathogenicStrong) return "PP3_Strong";
  if (phred >= THRESHOLDS.alphagenome.pathogenicModerate) return "PP3_Moderate";
  if (phred >= THRESHOLDS.alphagenome.pathogenicSupporting) return "PP3_Supporting";
  if (phred <= THRESHOLDS.alphagenome.benignModerate) return "BP4_Moderate";
  if (phred <= THRESHOLDS.alphagenome.benign) return "BP4_Supporting";
  return "indeterminate";
}

export interface FetchAlphaGenomeOptions {
  signal?: AbortSignal;
  apiKey?: string | null;
  apiUrl?: string | null;
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
  const cacheKey = buildAlphaGenomeKey(normChrom, pos, normRef, normAlt);

  const cached = alphagenomeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return defaultCacheRegistry.singleFlight(cacheKey, async () => {
    const doubleChecked = alphagenomeCache.get(cacheKey);
    if (doubleChecked) {
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
        if (res && res.status === "live") {
          alphagenomeCache.set(cacheKey, res);
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

    const effectiveApiKey = apiKey || process.env.ALPHAGENOME_API_KEY || CONFIG.services.alphagenomeApiKey;
    const endpoint = apiUrl || process.env.ALPHAGENOME_API_URL || CONFIG.services.alphagenomeUrl;

    if (!endpoint) {
      // Unconfigured environment or endpoint: clean standby state (Zero synthetic fallback)
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

    try {
      const res = await fetch(endpoint, {
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
      alphagenomeCache.set(cacheKey, failData, { ttl: 300_000 });
      return failData;
    }

    const data = validated.data!;
    alphagenomeCache.set(cacheKey, data);
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
    alphagenomeCache.set(cacheKey, errorResult, { ttl: 300_000 });
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

  const cached = alphagenomeRegionCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  return defaultCacheRegistry.singleFlight(cacheKey, async () => {
    const doubleChecked = alphagenomeRegionCache.get(cacheKey);
    if (doubleChecked) {
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
        if (res && res.status === "live") {
          alphagenomeRegionCache.set(cacheKey, res);
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

    const effectiveApiKey = apiKey || process.env.ALPHAGENOME_API_KEY || CONFIG.services.alphagenomeApiKey;
    const baseEndpoint = apiUrl || process.env.ALPHAGENOME_API_URL || CONFIG.services.alphagenomeUrl;

    if (!baseEndpoint) {
      // Unconfigured environment or endpoint: clean standby state (Zero synthetic fallback)
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

    try {
      const url = `${baseEndpoint.replace(/\/+$/, "")}/region-saturation`;
      const res = await fetch(url, {
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
          isExonic: Boolean(p.isExonic ?? (exonStart && exonEnd ? p.pos >= exonStart && p.pos <= exonEnd : true)),
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
        alphagenomeRegionCache.set(cacheKey, failData, { ttl: 300_000 });
        return failData;
      }

      const data = validated.data;
      alphagenomeRegionCache.set(cacheKey, data);
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
      alphagenomeRegionCache.set(cacheKey, errorResult, { ttl: 300_000 });
      return errorResult;
    }
  });
}
