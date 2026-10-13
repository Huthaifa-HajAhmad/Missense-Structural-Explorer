import { LRUCache } from "lru-cache";
import { TabixIndexedFile } from "@gmod/tabix";
import { getCachedOrFetch } from "../infra/cache.ts";
import { defaultCacheRegistry } from "../infra/cache-registry.ts";
import { sanitizeErrorMessage } from "../../utils/security.ts";
import { governedFetch } from "../infra/http-client.ts";

export interface ModelInferenceResult {
  score: number | null;
  status: "live" | "token_required" | "unavailable";
  message?: string;
}

// 30-day LRU cache for Song Lab GPN-Star predictions
const gpnCache = new LRUCache<string, ModelInferenceResult>({
  max: 2000,
  ttl: 1000 * 60 * 60 * 24 * 30 // 30 days
});
defaultCacheRegistry.registerCache("gpnCache", gpnCache, { ttlDesc: "30d" });

export function clearGpnCache(): void {
  gpnCache.clear();
}

let tabixInstance: TabixIndexedFile | null = null;

function getGpnTabix(): TabixIndexedFile {
  if (!tabixInstance) {
    tabixInstance = new TabixIndexedFile({
      url: "https://huggingface.co/datasets/songlab/gpn-msa-hg38-scores/resolve/main/scores.tsv.bgz",
      tbiUrl: "https://huggingface.co/datasets/songlab/gpn-msa-hg38-scores/resolve/main/scores.tsv.bgz.tbi"
    });
  }
  return tabixInstance;
}

/**
 * For test injection to mock the Tabix reader.
 */
export function setGpnTabixInstance(instance: TabixIndexedFile | null): void {
  tabixInstance = instance;
}

const COMPLEMENT_NUC: Record<string, string> = {
  A: "T",
  T: "A",
  C: "G",
  G: "C"
};

function getComplement(seq: string): string {
  if (!seq) return "";
  return seq
    .toUpperCase()
    .split("")
    .map(c => COMPLEMENT_NUC[c] || c)
    .join("");
}

/**
 * Queries Song Lab GPN-Star whole-genome vertebrate MSA predictions on-demand
 * via remote HTTP range Tabix queries against songlab/gpn-msa-hg38-scores (GRCh38).
 * 
 * 100% keyless and covers all ~9 billion single nucleotide variants in human GRCh38.
 */
export async function fetchGpnStarByCoordinate(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  signal?: AbortSignal,
  customEndpoint?: string | null,
  options?: { l1Cache?: LRUCache<string, any>; bypassSqlite?: boolean }
): Promise<ModelInferenceResult> {
  if (!chrom || typeof pos !== "number" || pos < 1 || !ref || !alt) {
    return {
      score: null,
      status: "unavailable",
      message: "Invalid genomic coordinates for GPN-Star"
    };
  }

  // 1. If researcher configured a dedicated local GPN sidecar, prioritize it
  const sidecarUrl = (customEndpoint || process.env.GPN_API_URL)?.replace(/\/+$/, "");
  if (sidecarUrl) {
    try {
      const combinedSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000);

      const res = await governedFetch(sidecarUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chrom, pos, ref, alt }),
        signal: combinedSignal
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const s =
          typeof data.score === "number"
            ? data.score
            : typeof data.delta_llr === "number"
            ? data.delta_llr
            : null;
        if (s !== null && Number.isFinite(s)) {
          return { score: s, status: "live" };
        }
      }
    } catch (_) {}
  }

  // 2. On-demand remote HTTP Range Tabix query against Song Lab whole-genome index
  const cleanChrom = chrom.replace(/^chr/i, "");
  const cleanRef = ref.toUpperCase();
  const cleanAlt = alt.toUpperCase();
  const compRef = getComplement(cleanRef);
  const compAlt = getComplement(cleanAlt);
  const cacheKey = `gpn_tabix_${cleanChrom}_${pos}_${cleanRef}_${cleanAlt}`;

  return getCachedOrFetch({
    key: cacheKey,
    source: "Song Lab GPN-Star (Whole-Genome MSA Tabix)",
    l1Cache: options?.l1Cache ?? gpnCache,
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days
    bypassSqlite: options?.bypassSqlite,
    shouldCache: (res) => res.status === "live" || (res.status === "unavailable" && !res.message?.includes("timed out") && !res.message?.includes("error")),
    fetcher: async () => {
      try {
        const tbi = getGpnTabix();
        let matchedScore: number | null = null;

        // 0-based half-open interval covering the position
        const start = Math.max(0, pos - 1);
        const end = pos + 1;

        const combinedSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000);

        await tbi.getLines(
          cleanChrom,
          start,
          end,
          {
            signal: combinedSignal,
            lineCallback: (line: string) => {
              if (!line || line.startsWith("#")) return;
              const cols = line.split("\t");
              // TSV format: chrom, pos, ref, alt, score
              if (cols.length >= 5) {
                const linePos = parseInt(cols[1], 10);
                const lineRef = cols[2]?.toUpperCase();
                const lineAlt = cols[3]?.toUpperCase();
                if (linePos === pos) {
                  const isDirectMatch = lineRef === cleanRef && lineAlt === cleanAlt;
                  const isCompMatch = lineRef === compRef && lineAlt === compAlt;
                  if (isDirectMatch) {
                    const parsed = parseFloat(cols[4]);
                    if (!isNaN(parsed) && Number.isFinite(parsed)) {
                      matchedScore = parsed;
                    }
                  } else if (isCompMatch && matchedScore === null) {
                    const parsed = parseFloat(cols[4]);
                    if (!isNaN(parsed) && Number.isFinite(parsed)) {
                      matchedScore = parsed;
                    }
                  }
                }
              }
            }
          }
        );

        if (matchedScore !== null) {
          return {
            score: matchedScore,
            status: "live"
          };
        }

        return {
          score: null,
          status: "unavailable",
          message: `Unindexed in GPN-Star whole-genome MSA (${cleanChrom}:${pos}${cleanRef}>${cleanAlt})`
        };
      } catch (err: any) {
        const isTimeout = err.name === "TimeoutError" || err.message?.includes("timeout");
        const safeErr = sanitizeErrorMessage(err);
        return {
          score: null,
          status: "unavailable",
          message: isTimeout
            ? "Remote GPN Tabix query timed out (20s limit)"
            : `Remote GPN Tabix error: ${safeErr}`
        };
      }
    }
  });
}

export interface GpnAccess {
  token: string | null;
  endpoint: string | null;
  customEndpoint: boolean;
}

function normaliseGpnEndpoint(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * WHO MAY BE CALLED WITH THE SERVER'S HUGGING FACE TOKEN.
 *
 * The rule is the one `resolveAlphaGenomeAccess` applies to `ALPHAGENOME_API_KEY`: the server's
 * `HF_TOKEN` only ever accompanies the endpoint the server itself is configured to use
 * (`GPN_API_URL`, or the built-in default when that is unset). A URL the request chose gets a
 * request-supplied token or none.
 *
 * This replaced a `String.includes(".huggingface.co")` test. A substring test asks "does this text
 * mention Hugging Face?", not "is this Hugging Face?", so a caller could point the request at a host
 * they control, put `.huggingface.co` in the query string, and have the server send its token there in
 * an `Authorization` header. A hostname test would not have been enough either: anyone may create a
 * Space, so a `*.hf.space` prefix is not a claim of identity.
 *
 * `customEndpoint` also keeps that proxy's answers out of the shared cache, for the same reason.
 */
export function resolveGpnAccess(callerToken?: string | null, callerUrl?: string | null): GpnAccess {
  const serverKey = process.env.HF_TOKEN || null;
  const serverEndpoint = process.env.GPN_API_URL || null;
  const endpoint = callerUrl || serverEndpoint;
  const customEndpoint =
    Boolean(callerUrl) &&
    (!serverEndpoint || normaliseGpnEndpoint(callerUrl as string) !== normaliseGpnEndpoint(serverEndpoint));
  let token = callerToken || serverKey;
  if (customEndpoint && serverKey && token === serverKey) token = null;
  return { token, endpoint, customEndpoint };
}

/**
 * Backwards-compatible variant coordinator that resolves GPN-Star score.
 */
export async function fetchGpnStarScore(
  sequence: string,
  pos: number,
  wt: string,
  mut: string,
  token?: string | null,
  signal?: AbortSignal,
  customEndpoint?: string | null
): Promise<ModelInferenceResult> {
  if (!sequence || typeof pos !== "number" || pos < 1 || !wt || !mut) {
    return {
      score: null,
      status: "unavailable",
      message: "Invalid sequence or mutation coordinates for GPN-Star"
    };
  }

  // If a custom dedicated endpoint was provided, query it
  const sidecarUrl = (customEndpoint || process.env.GPN_API_URL)?.replace(/\/+$/, "");
  if (sidecarUrl) {
    try {
      const combinedSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await governedFetch(sidecarUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ sequence, pos, wt: wt.toUpperCase(), mut: mut.toUpperCase() }),
        signal: combinedSignal
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        const s =
          typeof data.score === "number"
            ? data.score
            : typeof data.delta_llr === "number"
            ? data.delta_llr
            : null;
        if (s !== null && Number.isFinite(s)) {
          return { score: s, status: "live" };
        }
      }
    } catch (_) {}
  }

  // GPN-Star is an alignment-based nucleotide model; when called with sequence alone without coordinates,
  // indicate that genomic coordinates are required for whole-genome Tabix resolution.
  return {
    score: null,
    status: "unavailable",
    message: "GPN-Star requires genomic coordinates (GRCh38) for whole-genome Tabix lookup."
  };
}
