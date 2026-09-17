/**
 * SpliceAI client — Broad Institute SpliceAI Lookup REST API.
 *
 * Replaces reliance on Illumina's frozen precomputed `SpliceAI_pred_*` columns, which
 * were generated against GENCODE v24 with `-D 50`. Those columns are the reason the
 * Splicing tab could report no score for a variant that SpliceAI actually scores: a
 * variant absent from the precomputed tables produced a null, which the UI rendered as
 * "Unavailable / Unmapped" rather than as a measured result.
 *
 * This endpoint runs the model per request against a current GENCODE annotation, so
 * variants that the precomputed files never held now resolve, and the reporting window
 * (`-D`, exposed here as `distance`) is a per-request parameter rather than a frozen
 * property of the data set.
 *
 * Contract (verified against production):
 *   GET {base}/spliceai/?variant=chr1-25484258-G-A&hg=38&distance=500&mask=1&raw=1
 *   -> { variant, hg, distance, mask, raw, chrom, pos, ref, alt,
 *        scores: [ { DS_AG, DS_AL, DS_DG, DS_DL, DP_AG, DP_AL, DP_DG, DP_DL,
 *                    g_id, g_name, t_id, t_priority, t_refseq_ids, t_type, t_strand,
 *                    EXON_STARTS, EXON_ENDS, CDS_START, CDS_END, ... } ],
 *        source, allNonZeroScores, sai10kPredictions, ... }
 *
 * Design notes:
 *  - Selection is the `basic` GENCODE service. The application renders exactly one
 *    transcript (MANE Select preferred), so the `comprehensive` variants would return
 *    many records per query only for all but one to be discarded.
 *  - `masked` is the default because it is what Illumina recommends for variant
 *    interpretation and what the Broad web tool displays, so the numbers agree with what
 *    a researcher sees there. Masking zeroes delta scores for strengthening annotated
 *    sites and weakening unannotated sites, which are typically far less pathogenic.
 *    Because `mask` participates in the cache key, switching to raw is a configuration
 *    change rather than a code change.
 *  - Failures return null rather than throwing: this is a third-party academic service
 *    with an interactive-use rate limit, so callers fall through to their existing
 *    sources. Availability is a degradation, never an error.
 */
import { z } from "zod";
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";

/** Cloud Run services, one per genome build. Selected by `-comprehensive` suffix upstream. */
const SPLICEAI_BASE_URLS = {
  GRCh38: "https://spliceai-38-xwkwwwxdwq-uc.a.run.app",
  GRCh37: "https://spliceai-37-xwkwwwxdwq-uc.a.run.app",
} as const;

/**
 * Reporting window: the maximum distance between the variant and a gained or lost splice
 * site. 500 matches the Broad web tool's default, so scores are comparable with what a
 * researcher obtains there. The API accepts up to 10,000 (its MAX_DISTANCE_LIMIT); raise
 * this to reach further into introns at the cost of more reported positions.
 */
export const SPLICEAI_DEFAULT_DISTANCE = 500;

/** Masking: 1 = masked (recommended for interpretation), 0 = raw. */
export const SPLICEAI_DEFAULT_MASK = 1;

const REQUEST_TIMEOUT_MS = 20_000;

/** Immutable per (variant, build, distance, mask): a long TTL is safe. */
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Sentinel stored for a negative result, so a miss is cacheable with a short TTL. */
const NO_SCORE = Symbol("spliceai-no-score");

interface SpliceAiCache {
  get(key: string): SpliceAiScoreRecord | typeof NO_SCORE | undefined;
  set(key: string, value: SpliceAiScoreRecord | typeof NO_SCORE, options?: { ttl?: number }): unknown;
  delete(key: string): unknown;
  clear(): void;
}

/**
 * `LRUCache`'s value type excludes symbols and null, so the cache is declared through this
 * narrow seam. The sentinel keeps "we asked and there is no score" distinguishable from
 * "we never asked": the former gets a short TTL rather than being re-queried on every
 * request, and unlike `null` it survives a cache that treats falsy values as absent.
 */
const spliceAiCache = new LRUCache<string, SpliceAiScoreRecord | typeof NO_SCORE>({
  max: 2000,
}) as unknown as SpliceAiCache;

/**
 * The API returns every score as a string ("0.004") and delta positions as numbers.
 * `z.coerce` is avoided so a malformed value surfaces as null instead of NaN.
 */
const numericString = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  });

const transcriptRecordSchema = z.object({
  DS_AG: numericString,
  DS_AL: numericString,
  DS_DG: numericString,
  DS_DL: numericString,
  DP_AG: z.number().nullish(),
  DP_AL: z.number().nullish(),
  DP_DG: z.number().nullish(),
  DP_DL: z.number().nullish(),
  g_name: z.string().nullish(),
  t_id: z.string().nullish(),
  /** Transcript priority. "MS" = MANE Select. */
  t_priority: z.string().nullish(),
  t_refseq_ids: z.array(z.string()).nullish(),
  t_type: z.string().nullish(),
  t_strand: z.string().nullish(),
});

const responseSchema = z.object({
  variant: z.string().nullish(),
  chrom: z.string().nullish(),
  pos: z.number().nullish(),
  ref: z.string().nullish(),
  alt: z.string().nullish(),
  distance: z.number().nullish(),
  mask: z.union([z.string(), z.number()]).nullish(),
  /** "spliceai:model" when the model ran, "spliceai:precomputed" if a table answered. */
  source: z.string().nullish(),
  scores: z.array(transcriptRecordSchema).nullish(),
});

export interface SpliceAiDeltaPositions {
  ds_ag: number | null;
  ds_al: number | null;
  ds_dg: number | null;
  ds_dl: number | null;
}

export interface SpliceAiScoreRecord {
  ds_ag: number | null;
  ds_al: number | null;
  ds_dg: number | null;
  ds_dl: number | null;
  max_ds: number | null;
  /**
   * Where splicing changes, relative to the variant (negative = upstream). The delta
   * magnitude alone cannot say whether a shift lands on a real junction; these can, and
   * a large |DP| with a small DS is the signature of a variant nowhere near a splice site.
   */
  dp: SpliceAiDeltaPositions;
  /** MANE Select transcript id reported by the service, when it answered for one. */
  transcriptId: string | null;
  transcriptRefSeqIds: string[];
  isManeSelect: boolean;
  geneSymbol: string | null;
  /** Which reporting window these scores were produced under. */
  distance: number;
  /** 1 = masked, 0 = raw. */
  mask: number;
  /** Provenance: "model" (computed now) or "precomputed" (served from a table). */
  computedLive: boolean;
  source: string | null;
}

/** Cache key: every input that changes the answer must participate. */
export function buildSpliceAiCacheKey(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  assembly: keyof typeof SPLICEAI_BASE_URLS,
  distance: number,
  mask: number
): string {
  return [
    "spliceai",
    assembly,
    String(chrom).replace(/^chr/i, "").toUpperCase(),
    pos,
    ref.toUpperCase(),
    alt.toUpperCase(),
    distance,
    mask,
  ].join(":");
}

/**
 * Prefer the MANE Select record, then any record, so the score we surface corresponds to
 * the transcript the rest of the application reports against.
 */
function selectTranscript(records: z.infer<typeof transcriptRecordSchema>[]) {
  return records.find((r) => r.t_priority === "MS") ?? records[0] ?? null;
}

export interface FetchSpliceAiOptions {
  assembly?: keyof typeof SPLICEAI_BASE_URLS;
  distance?: number;
  mask?: number;
  signal?: AbortSignal;
  /** Bypass the in-memory cache (used by tests). */
  skipCache?: boolean;
}

/**
 * Score one variant with SpliceAI via the Broad Lookup API.
 *
 * Returns null when the variant cannot be scored (upstream unreachable, rate limited,
 * malformed or empty response). Callers must treat null as "no live score" and fall
 * through to another source — never as evidence of benign splicing.
 */
export async function fetchSpliceAiBroad(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  options: FetchSpliceAiOptions = {}
): Promise<SpliceAiScoreRecord | null> {
  const assembly = options.assembly ?? "GRCh38";
  const distance = options.distance ?? SPLICEAI_DEFAULT_DISTANCE;
  const mask = options.mask ?? SPLICEAI_DEFAULT_MASK;

  const baseUrl = SPLICEAI_BASE_URLS[assembly];
  if (!baseUrl) return null;
  if (!chrom || !Number.isFinite(pos) || !ref || !alt) return null;

  const cacheKey = buildSpliceAiCacheKey(chrom, pos, ref, alt, assembly, distance, mask);
  if (!options.skipCache) {
    const cached = spliceAiCache.get(cacheKey);
    if (cached === NO_SCORE) return null;
    if (cached !== undefined) return cached;
  }

  const hg = assembly === "GRCh38" ? 38 : 37;
  // Alleles are upper-cased: the service documents and returns `chr-pos-REF-ALT` in upper
  // case, and the cache key is upper-cased too, so a lower-case caller must not produce a
  // differently-spelled request for the same variant.
  const contig = String(chrom).replace(/^chr/i, "");
  const variant = `chr${contig}-${pos}-${ref.toUpperCase()}-${alt.toUpperCase()}`;
  const url =
    `${baseUrl}/spliceai/?variant=${encodeURIComponent(variant)}` +
    `&hg=${hg}&distance=${distance}&mask=${mask}&raw=1`;

  try {
    const response = await fetchWithRetry(
      url,
      { headers: { Accept: "application/json", "User-Agent": "Missense-Structural-Explorer/1.0" }, timeout: REQUEST_TIMEOUT_MS, signal: options.signal },
      // A single attempt: this is an interactive service behind a per-user rate limit, so
      // retrying aggressively would work against it. A miss degrades to the fallback path.
      1
    );

    if (!response.ok) {
      console.warn(`[SpliceAI Broad] ${variant} returned HTTP ${response.status}; falling back.`);
      spliceAiCache.set(cacheKey, NO_SCORE, { ttl: 60_000 });
      return null;
    }

    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn(`[SpliceAI Broad] ${variant} returned an unrecognised payload; falling back.`);
      spliceAiCache.set(cacheKey, NO_SCORE, { ttl: 60_000 });
      return null;
    }

    const body = parsed.data;
    const records = body.scores ?? [];
    const selected = selectTranscript(records);
    if (!selected) {
      // A scored variant always carries at least one transcript record. An empty list is a
      // real "cannot score" (outside any gene, near a chromosome end), so cache it briefly
      // and report null rather than fabricating zeros.
      spliceAiCache.set(cacheKey, NO_SCORE, { ttl: 60_000 });
      return null;
    }

    const channels = [selected.DS_AG, selected.DS_AL, selected.DS_DG, selected.DS_DL];
    const hasAny = channels.some((c) => c !== null);

    const record: SpliceAiScoreRecord = {
      ds_ag: selected.DS_AG,
      ds_al: selected.DS_AL,
      ds_dg: selected.DS_DG,
      ds_dl: selected.DS_DL,
      max_ds: hasAny ? Math.max(...channels.map((c) => c ?? 0)) : null,
      dp: {
        ds_ag: selected.DP_AG ?? null,
        ds_al: selected.DP_AL ?? null,
        ds_dg: selected.DP_DG ?? null,
        ds_dl: selected.DP_DL ?? null,
      },
      transcriptId: selected.t_id ?? null,
      transcriptRefSeqIds: selected.t_refseq_ids ?? [],
      isManeSelect: selected.t_priority === "MS",
      geneSymbol: selected.g_name ?? null,
      distance: body.distance ?? distance,
      mask: Number(body.mask ?? mask),
      // The service reports "spliceai:model" when it ran the model for this request, which
      // distinguishes a live computation from a table lookup and belongs in provenance.
      computedLive: (body.source ?? "").includes("model"),
      source: body.source ?? null,
    };

    spliceAiCache.set(cacheKey, record, { ttl: CACHE_TTL_MS });
    return record;
  } catch (err: any) {
    if (options.signal?.aborted) throw err;
    console.warn(`[SpliceAI Broad] ${variant} lookup failed: ${err?.message ?? "unknown error"}; falling back.`);
    spliceAiCache.set(cacheKey, NO_SCORE, { ttl: 60_000 });
    return null;
  }
}

/** Test seam: clears the module cache. */
export function clearSpliceAiCache(): void {
  spliceAiCache.clear();
}
