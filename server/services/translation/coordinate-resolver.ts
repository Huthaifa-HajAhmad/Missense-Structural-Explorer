/**
 * coordinate-resolver.ts — Provider ladder for genomic/cDNA -> protein resolution.
 *
 * PROBLEM ADDRESSED
 * -----------------
 * `rest.ensembl.org` was a single point of failure: when VEP was unreachable, every
 * coordinate query failed. Worse, a circuit-breaker trip surfaced to the clinician as a
 * generic 500 ("internal server error"), which both mis-signalled an internal bug and
 * offered no workaround.
 *
 * THE LADDER
 * ----------
 *   0. L2 persistent cache  — coordinate->protein mappings are IMMUTABLE, so a previously
 *                             resolved coordinate returns instantly and survives outages.
 *   1. Ensembl VEP          — primary; fast and rich (UniProt, MANE, canonical flags).
 *   2. VariantValidator     — independent infrastructure; survives a total VEP outage.
 *
 * Every tier is recorded in `attempts` so the answer stays auditable, and the route
 * reports which provider actually answered.
 *
 * DELIBERATE SCOPE BOUNDARY
 * -------------------------
 * gnomAD / MyVariant-style databases were evaluated and REJECTED as fallbacks: they only
 * answer for variants already observed by their cohorts, whereas this platform's core use
 * case is rare/novel VUS (a routine missense SNV returned "Variant not found" from gnomAD).
 * Only reference-sequence translators can answer for a novel variant. See doc/FUTURE_WORK.md
 * for the deferred fully-offline (tier 3) resolver.
 */

import { z } from "zod";
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { defaultCacheRegistry, getCachedOrFetch } from "../infra/cache.ts";
import { buildCoordinateTranslationKey } from "../infra/cache-keys.ts";
import { anySignal } from "../../utils.ts";
import type { GenomeAssembly } from "../../../src/shared/variantNotation.ts";
import { fetchVariantValidatorConsequence } from "./variant-validator.ts";
import {
  CoordinateResolutionError,
  type ProviderAttempt,
  type ResolutionFailureKind,
  type ResolutionOutcome,
  type ResolvedConsequence,
  type TranslationProvider,
} from "./types.ts";

/**
 * Ensembl REST hosts are genome-build specific: the default host serves GRCh38 while
 * `grch37.rest.ensembl.org` serves GRCh37. Both were verified live to accept the full
 * query-parameter set used below (including `mane=1`).
 *
 * NOTE: Ensembl's regional mirrors (useast/asia) do NOT serve REST/VEP — they return
 * 403/503 — so they are deliberately absent here.
 */
export const ENSEMBL_HOSTS: Record<GenomeAssembly, string> = {
  GRCh38: "https://rest.ensembl.org",
  GRCh37: "https://grch37.rest.ensembl.org",
};

/** Ensembl's default host serves GRCh38, so unannotated notations keep their prior behavior. */
export const DEFAULT_ASSEMBLY: GenomeAssembly = "GRCh38";

const ensemblResponseSchema = z.array(
  z.object({
    seq_region_name: z.string().optional(),
    start: z.number().optional(),
    allele_string: z.string().optional(),
    transcript_consequences: z
      .array(
        z
          .object({
            transcript_id: z.string().optional(),
            canonical: z.union([z.number(), z.boolean()]).optional(),
            mane_select: z.any().optional(),
            mane_plus_clinical: z.any().optional(),
            hgvsp: z.string().optional(),
            gene_symbol: z.string().optional(),
            consequence_terms: z.array(z.string()).optional(),
            swissprot: z.array(z.string()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
);

/**
 * Queries Ensembl VEP for a coordinate notation.
 * Throws {@link CoordinateResolutionError} on transport failure or unusable payload.
 */
export async function fetchEnsemblVepConsequence(
  notation: string,
  assembly: GenomeAssembly,
  signal?: AbortSignal
): Promise<{ consequence: ResolvedConsequence; attempt: ProviderAttempt }> {
  const startedAt = Date.now();
  const url =
    `${ENSEMBL_HOSTS[assembly]}/vep/human/hgvs/${encodeURIComponent(notation)}` +
    `?content-type=application/json&hgvs=1&canonical=1&uniprot=1&mane=1`;

  const attempt = (
    ok: boolean,
    reason?: string,
    failureKind?: ProviderAttempt["failureKind"]
  ): ProviderAttempt => ({
    provider: "ensembl-vep",
    ok,
    durationMs: Math.max(1, Date.now() - startedAt),
    reason,
    failureKind,
  });

  let response: Response;
  try {
    response = await fetchWithRetry(url, { headers: { Accept: "application/json" }, timeout: 15000, signal });
  } catch (err: any) {
    // A caller-initiated abort must propagate untouched so the HTTP layer can answer 504.
    if (signal?.aborted) throw err;
    throw new CoordinateResolutionError(
      "upstream_unavailable",
      `Ensembl VEP unreachable: ${err?.message || "network error"}`,
      [attempt(false, err?.message || "network error", "upstream_unavailable")]
    );
  }

  if (!response.ok) {
    const failureKind: ProviderAttempt["failureKind"] =
      response.status === 429 || response.status >= 500 ? "upstream_unavailable" : "invalid_response";
    const text = await response.text().catch(() => "");
    throw new CoordinateResolutionError(
      failureKind,
      `Ensembl VEP API returned status ${response.status}: ${text.slice(0, 300)}`,
      [attempt(false, `status ${response.status}`, failureKind)]
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new CoordinateResolutionError("invalid_response", "Ensembl VEP returned malformed JSON.", [
      attempt(false, "malformed JSON", "invalid_response"),
    ]);
  }

  const parsed = ensemblResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CoordinateResolutionError(
      "invalid_response",
      "Ensembl VEP API returned an invalid response structure.",
      [attempt(false, "invalid response structure", "invalid_response")]
    );
  }

  const data = parsed.data;
  if (data.length === 0 || !data[0].transcript_consequences) {
    throw new CoordinateResolutionError(
      "not_found",
      "No transcript consequences found for the provided variant.",
      [attempt(false, "no transcript consequences", "not_found")]
    );
  }

  return {
    consequence: {
      provider: "ensembl-vep",
      seq_region_name: data[0].seq_region_name,
      start: data[0].start,
      allele_string: data[0].allele_string,
      transcript_consequences:
        data[0].transcript_consequences as ResolvedConsequence["transcript_consequences"],
    },
    attempt: attempt(true),
  };
}

// ---------------------------------------------------------------------------
// Tier 0 — immutable persistent cache
// ---------------------------------------------------------------------------

/** Slim cache payload: only what is needed to rebuild a {@link ResolutionOutcome}. */
interface CachedResolution {
  consequence: ResolvedConsequence;
  assembly: GenomeAssembly;
  resolvedBy: TranslationProvider;
  /**
   * Whether the cached answer came from the fallback provider.
   *
   * Without this, `usedFallback` was recomputed as `!cacheHit && ...`, so once a
   * degraded fallback answer (typically missing transcript_id / UniProt) was cached
   * — for ~10 years — every subsequent read reported it as a first-choice answer and
   * the client had no way to tell it came from an outage.
   *
   * Optional so entries written by earlier versions still parse.
   */
  usedFallback?: boolean;
}

/**
 * L1 memory cache for resolved coordinates.
 *
 * Registered with the central cache registry so it appears in memory telemetry AND is
 * flushed by `clearAllCaches()` (which the test suite relies on for isolation).
 * The mapping is immutable reference data, so a very long TTL is used purely to keep LRU
 * memory bounded rather than to expire stale data.
 */
const coordinateTranslationCache = new LRUCache<string, CachedResolution>({
  max: 5000,
  ttl: 1000 * 60 * 60 * 24 * 365,
});
defaultCacheRegistry.registerCache("coordinateTranslationCache", coordinateTranslationCache, {
  ttlDesc: "365d (immutable)",
});

/** ~10 years in seconds — coordinate -> protein mappings are immutable reference data. */
const COORDINATE_TRANSLATION_TTL_SECONDS = 315_360_000;

/**
 * Total wall-clock budget for the whole provider ladder.
 *
 * Without this, the worst case is the sum of every provider's retries and timeouts (tens of
 * seconds), which is unacceptable in a clinical UI. The budget is enforced with a single
 * deadline signal shared by all providers, so the ladder always answers in bounded time.
 */
export const DEFAULT_RESOLUTION_BUDGET_MS = 25_000;

/** Ordered provider chain: primary first, then independent fallbacks. */
const PROVIDER_CHAIN: Array<{
  provider: TranslationProvider;
  resolve: (
    notation: string,
    assembly: GenomeAssembly,
    signal?: AbortSignal
  ) => Promise<{ consequence: ResolvedConsequence; attempt: ProviderAttempt }>;
}> = [
  { provider: "ensembl-vep", resolve: fetchEnsemblVepConsequence },
  { provider: "variant-validator", resolve: fetchVariantValidatorConsequence },
];

/**
 * Collapses per-provider failures into a single machine-readable cause.
 * All-unreachable ⇒ upstream outage (503); any definitive "not found" ⇒ 404.
 */
function classifyTotalFailure(attempts: ProviderAttempt[]): ResolutionFailureKind {
  const kinds = attempts.map((a) => a.failureKind).filter(Boolean) as ResolutionFailureKind[];
  if (kinds.length > 0 && kinds.every((k) => k === "upstream_unavailable")) {
    return "upstream_unavailable";
  }
  if (kinds.includes("not_found")) return "not_found";
  if (kinds.includes("invalid_response")) return "invalid_response";
  return "upstream_unavailable";
}

/**
 * User-facing explanation for a total resolution failure. Names the cause and tells the
 * clinician exactly what to do next, because the rest of the pipeline works from
 * protein-level notation alone.
 *
 * DELIBERATELY FREE OF INTERNAL DETAIL: raw provider reasons are NOT embedded here. Two
 * reasons: (a) `sendError` sanitizes every status >= 500 message, and a reason such as
 * "fetch failed" would trip that rewriter and silently replace this guidance with a generic
 * string; (b) provider jargon is noise for a clinician. The machine-readable trail is
 * returned in the response `details.attempts` instead.
 */
export function buildResolutionUnavailableMessage(kind: ResolutionFailureKind): string {
  if (kind === "not_found") {
    return (
      "No transcript consequence was found for this coordinate in any reference provider. " +
      "Verify the chromosome, position, alleles and genome build — or the coordinate may lie " +
      "outside the coding sequence of any transcript, in which case no protein variant (HGVSp) " +
      "exists and a missense analysis is not possible."
    );
  }
  if (kind === "invalid_response") {
    return "Coordinate translation providers returned unusable responses. Please retry shortly.";
  }
  return (
    "Coordinate translation is temporarily unavailable because all reference providers are " +
    "unreachable. You can enter the protein-level substitution directly (for example " +
    "p.Glu433Lys) — the rest of the analysis runs without coordinate translation."
  );
}

/**
 * Resolves a genomic/cDNA coordinate notation to a protein-level consequence.
 *
 * Tier 0 (immutable cache) -> Tier 1 (Ensembl VEP) -> Tier 2 (VariantValidator).
 * Throws {@link CoordinateResolutionError} on total failure so the HTTP layer can answer
 * 503 / 404 / 502 honestly instead of a blanket 500.
 */
export async function resolveCoordinate(
  notation: string,
  assembly: GenomeAssembly,
  signal?: AbortSignal,
  options?: { budgetMs?: number }
): Promise<ResolutionOutcome> {
  const key = buildCoordinateTranslationKey(assembly, notation);
  const budgetMs = options?.budgetMs ?? DEFAULT_RESOLUTION_BUDGET_MS;

  // Enforce a single wall-clock deadline across every provider.
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error(`Coordinate resolution exceeded its ${budgetMs}ms budget`)),
    budgetMs
  );
  const ladderSignal = signal ? anySignal([signal, deadline.signal]) : deadline.signal;

  // Precise cache-hit detection: `singleFlight` guarantees the fetcher runs at most once,
  // so a flag flipped inside it reliably distinguishes a fresh fetch from an L2 hit.
  let fetchedFresh = false;
  // Cached payloads are deliberately slim, so the live attempt trail is captured here.
  let lastAttempts: ProviderAttempt[] = [];

  try {
    const cached = await getCachedOrFetch<CachedResolution>({
      key,
      source: "coordinate_translation",
      l1Cache: coordinateTranslationCache,
      ttlSeconds: COORDINATE_TRANSLATION_TTL_SECONDS,
      // Never persist failures: an outage must not poison the immutable cache.
      shouldCache: (result) => Boolean(result?.consequence?.transcript_consequences?.length),
      fetcher: async () => {
        fetchedFresh = true;
        const attempts: ProviderAttempt[] = [];

        for (const { provider, resolve } of PROVIDER_CHAIN) {
          // A caller-initiated abort propagates untouched so the HTTP layer can answer 504.
          if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
          if (deadline.signal.aborted) break; // budget exhausted; stop trying providers

          const providerStartedAt = Date.now();
          try {
            const { consequence, attempt } = await resolve(notation, assembly, ladderSignal);
            lastAttempts = [...attempts, attempt];
            // Persist fallback provenance with the payload so a later cache read does
            // not silently upgrade a degraded answer to a first-choice one.
            return {
              consequence,
              assembly,
              resolvedBy: consequence.provider,
              usedFallback: consequence.provider !== PROVIDER_CHAIN[0].provider,
            };
          } catch (err: any) {
            if (signal?.aborted) throw err;

            if (err instanceof CoordinateResolutionError) {
              attempts.push(...err.attempts);
              continue;
            }

            // Non-namespaced error: almost always the shared deadline aborting an in-flight
            // provider call. Record it and stop — remaining providers share the same signal.
            attempts.push({
              provider,
              ok: false,
              durationMs: Math.max(1, Date.now() - providerStartedAt),
              reason: deadline.signal.aborted
                ? `resolution budget of ${budgetMs}ms exceeded`
                : err?.message || "unexpected provider error",
              failureKind: "upstream_unavailable",
            });
            break;
          }
        }

        const kind = classifyTotalFailure(attempts);
        throw new CoordinateResolutionError(kind, buildResolutionUnavailableMessage(kind), attempts);
      },
    });

    const cacheHit = !fetchedFresh;
    const attempts: ProviderAttempt[] = cacheHit
      ? [{ provider: cached.resolvedBy, ok: true, durationMs: 0, reason: "cache_hit" }]
      : lastAttempts;

    return {
      consequence: cached.consequence,
      assembly: cached.assembly,
      attempts,
      // Prefer the provenance stored with the payload; fall back to deriving it for
      // entries written before `usedFallback` was persisted.
      usedFallback:
        cached.usedFallback ??
        (!cacheHit && cached.resolvedBy !== PROVIDER_CHAIN[0].provider),
      cacheHit,
    };
  } finally {
    clearTimeout(timer);
  }
}
