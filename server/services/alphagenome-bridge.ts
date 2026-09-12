import { LRUCache } from "lru-cache";
import {
  type AlphaGenomeAviData,
  alphagenomeAviSchema,
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

// In-memory 30-day LRU cache for AlphaGenome predictions
export const alphagenomeCache = new LRUCache<string, NonNullable<AlphaGenomeAviData>>({
  max: 1000,
  ttl: 1000 * 60 * 60 * 24 * 30 // 30 days
});

// Register with global cache registry for telemetry diagnostics and unified flushes
defaultCacheRegistry.registerCache("alphagenomeCache", alphagenomeCache, { ttlDesc: "30d" });

export function clearAlphaGenomeCache(): void {
  alphagenomeCache.clear();
}

let mockProvider: AlphaGenomeProvider | null = null;

export function setAlphaGenomeMockProvider(provider: AlphaGenomeProvider | null): void {
  mockProvider = provider;
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

/**
 * Fetches AlphaGenome Variant Impact (AVI) scores and biological modality attributions.
 * Protected by an in-memory 30-day LRU cache, singleFlight deduplication, and a 2.5-second fast deadline.
 */
export async function fetchAlphaGenome(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  signal?: AbortSignal
): Promise<AlphaGenomeAviData> {
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

    const effectiveApiKey = process.env.ALPHAGENOME_API_KEY || CONFIG.services.alphagenomeApiKey;
    const endpoint = process.env.ALPHAGENOME_API_URL || CONFIG.services.alphagenomeUrl || "https://api.japanfold.aiand.com/v1/alphagenome";

    if (!effectiveApiKey && !process.env.ALPHAGENOME_API_URL) {
      // Unconfigured environment: clean standby state (Zero synthetic fallback)
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
