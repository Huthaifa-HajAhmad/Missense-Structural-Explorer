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
 * WHAT "RESOLVED" MEANS HERE
 * --------------------------
 * A provider answering is not the same as the question being answered: this platform models
 * missense substitutions, so a payload whose transcripts carry no HGVSp (intronic, UTR,
 * non-coding) is a MISS for the ladder, not an answer — another provider's annotation release
 * may number the coordinate. The ladder therefore requires a protein-altering consequence of
 * every rung, and only returns a protein-free payload (with `proteinChangeFound: false`) once
 * every rung has been asked, so the caller can explain why instead of reporting "not found".
 *
 * The ladder also owns protein-NUMBERING reconciliation (`isoform-numbering.ts`), because the
 * cache decision depends on it: an answer whose numbering could not be tied to the canonical
 * UniProt isoform must never be stored as settled truth for a decade. See {@link isCacheable}.
 *
 * DELIBERATE SCOPE BOUNDARY
 * -------------------------
 * gnomAD / MyVariant-style databases were evaluated and REJECTED as fallbacks: they only
 * answer for variants already observed by their cohorts, whereas this platform's core use
 * case is rare/novel VUS (a routine missense SNV returned "Variant not found" from gnomAD).
 * Only reference-sequence translators can answer for a novel variant.
 */

import { z } from "zod";
import { LRUCache } from "lru-cache";
import { fetchWithRetry } from "../infra/http-client.ts";
import { defaultCacheRegistry, getCachedOrFetch } from "../infra/cache.ts";
import { buildCoordinateTranslationKey } from "../infra/cache-keys.ts";
import { anySignal } from "../../utils.ts";
import type { GenomeAssembly } from "../../../src/shared/variantNotation.ts";
import { fetchVariantValidatorConsequence } from "./variant-validator.ts";
import { reconcileIsoformNumbering, type NumberingVerdict } from "./isoform-numbering.ts";
import {
  CoordinateResolutionError,
  type ProviderAttempt,
  type ProteinAlteringConsequence,
  type ResolutionFailureKind,
  type ResolutionOutcome,
  type ResolutionProviderOptions,
  type ResolvedConsequence,
  type ResolvedTranscriptConsequence,
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

/** Ensembl VEP's configured per-attempt tolerance. */
export const ENSEMBL_VEP_TIMEOUT_MS = 15_000;

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
            // VEP sends `canonical` as 1/0 or true/false and has been seen sending the string
            // form. Accepting all three keeps a payload carrying the field reconciliation
            // depends on from being discarded wholesale.
            canonical: z.union([z.number(), z.boolean(), z.string()]).optional(),
            mane_select: z.any().optional(),
            mane_plus_clinical: z.any().optional(),
            hgvsp: z.string().optional(),
            hgvsc: z.string().optional(),
            amino_acids: z.string().optional(),
            // Isoform the consequence's protein numbering belongs to. Accepts the string form
            // for the same reason: rejecting it silently degraded a resolution to the
            // metadata-free fallback provider.
            uniprot_isoform: z.union([z.array(z.string()), z.string()]).optional(),
            gene_symbol: z.string().optional(),
            consequence_terms: z.array(z.string()).optional(),
            swissprot: z.array(z.string()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
);

/** Canonical UniProt accession reported for a consequence (`Q9Y305.179` -> `Q9Y305`). */
export function canonicalAccessionOf(
  consequence: ResolvedTranscriptConsequence
): string | undefined {
  const accession = consequence.swissprot?.[0]?.split(".")[0]?.trim();
  return accession || undefined;
}

/** MANE Select, else Ensembl canonical, else any consequence that reports a protein change. */
export function selectProteinConsequence(
  consequences: ResolvedTranscriptConsequence[]
): ProteinAlteringConsequence | undefined {
  const mane = consequences.find(
    (t): t is ProteinAlteringConsequence => Boolean(t.mane_select && t.hgvsp)
  );
  const canonical = consequences.find(
    (t): t is ProteinAlteringConsequence =>
      Boolean((t.canonical === 1 || t.canonical === true || t.canonical === "1") && t.hgvsp)
  );
  const anyProtein = consequences.find(
    (t): t is ProteinAlteringConsequence => Boolean(t.hgvsp)
  );
  return mane ?? canonical ?? anyProtein;
}

/** Most informative consequence for explaining why no protein change exists. */
export function pickInformativeConsequence(
  consequences: ResolvedTranscriptConsequence[]
): ResolvedTranscriptConsequence | undefined {
  return (
    consequences.find((t) => t.mane_select) ??
    consequences.find((t) => t.canonical === 1 || t.canonical === true || t.canonical === "1") ??
    consequences[0]
  );
}

export interface ProteinTarget {
  proteinChangeFound: boolean;
  numbering?: NumberingVerdict;
}

/**
 * Turns a provider's consequence list into the reconciled protein target.
 *
 * Pure, so it can be re-run on a cached payload: entries written by earlier versions
 * (including protein-free ones) are interpreted correctly instead of being trusted
 * field-by-field, and the cache payload itself stays slim.
 */
export function resolveProteinTarget(
  consequences: ResolvedTranscriptConsequence[]
): ProteinTarget {
  const selected = selectProteinConsequence(consequences);
  if (!selected) return { proteinChangeFound: false };

  const canonicalAccession = canonicalAccessionOf(selected);
  return {
    proteinChangeFound: true,
    numbering: reconcileIsoformNumbering(selected, consequences, canonicalAccession),
  };
}

/**
 * Queries Ensembl VEP for a coordinate notation.
 * Throws {@link CoordinateResolutionError} on transport failure or unusable payload.
 */
export async function fetchEnsemblVepConsequence(
  notation: string,
  assembly: GenomeAssembly,
  signal?: AbortSignal,
  options?: ResolutionProviderOptions
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
    response = await fetchWithRetry(url, {
      headers: { Accept: "application/json" },
      timeout: options?.timeoutMs ?? ENSEMBL_VEP_TIMEOUT_MS,
      signal,
    });
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
  } catch (err: any) {
    // A body read killed by our own deadline or window is a timeout, not a malformed payload.
    if (signal?.aborted) throw err;
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
 * Whether a resolved payload may be stored as settled truth.
 *
 * EXCLUDES two shapes that must stay re-resolvable:
 *   - payloads with no protein change at all (another provider's annotation release may number
 *     the coordinate tomorrow), and
 *   - payloads whose numbering could not be verified against the canonical isoform — caching
 *     one pinned the ACOT9 mis-numbering for ten years, so it kept being served even after the
 *     primary provider (the one carrying the isoform metadata) had recovered.
 */
function isCacheable(outcome: { consequence: ResolvedConsequence }): boolean {
  if (!outcome?.consequence?.transcript_consequences?.length) return false;
  const target = resolveProteinTarget(outcome.consequence.transcript_consequences);
  if (!target.proteinChangeFound) return false;
  return target.numbering?.status === "canonical" || target.numbering?.status === "remapped";
}

/**
 * Total wall-clock budget for the whole provider ladder.
 *
 * A ladder of N providers must be able to give EACH rung one full attempt at its own
 * configured tolerance, or a rung is killed by arithmetic rather than by the provider being
 * slow. The previous 25s budget could not fit two 15s providers, and giving the primary the
 * whole budget starved the fallback entirely (see the window logic in {@link resolveCoordinate}).
 *
 * The client's per-request budget for this call is 45s (`src/api/structureApi.ts`), which must
 * stay above this value.
 */
export const DEFAULT_RESOLUTION_BUDGET_MS = 32_000;

/** Ordered provider chain: primary first, then independent fallbacks. */
const PROVIDER_CHAIN: Array<{
  provider: TranslationProvider;
  /** This provider's configured per-attempt tolerance (before the ladder caps it). */
  timeoutMs: number;
  resolve: (
    notation: string,
    assembly: GenomeAssembly,
    signal?: AbortSignal,
    options?: ResolutionProviderOptions
  ) => Promise<{ consequence: ResolvedConsequence; attempt: ProviderAttempt }>;
}> = [
  { provider: "ensembl-vep", timeoutMs: ENSEMBL_VEP_TIMEOUT_MS, resolve: fetchEnsemblVepConsequence },
  { provider: "variant-validator", timeoutMs: 15_000, resolve: fetchVariantValidatorConsequence },
];

/**
 * Collapses per-provider failures into a single machine-readable cause.
 *
 * Order matters. `invalid_response` is checked BEFORE `not_found`: when one provider answers
 * "nothing here" and another returns an unusable payload, "no transcript consequence was found
 * in any provider" is untrue — the honest report is that a provider was unusable, and the client
 * should retry rather than rewrite a coordinate that may be perfectly valid.
 */
function classifyTotalFailure(attempts: ProviderAttempt[]): ResolutionFailureKind {
  const kinds = attempts.map((a) => a.failureKind).filter(Boolean) as ResolutionFailureKind[];
  if (kinds.length > 0 && kinds.every((k) => k === "upstream_unavailable")) {
    return "upstream_unavailable";
  }
  if (kinds.includes("invalid_response")) return "invalid_response";
  if (kinds.includes("not_found")) return "not_found";
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
    "unreachable or failed to answer in time. You can enter the protein-level substitution " +
    "directly (for example p.Glu433Lys) — the rest of the analysis runs without coordinate translation."
  );
}

/** Rebuilds the outcome fields that are DERIVED (not stored) from a resolved payload. */
function buildOutcome(
  consequence: ResolvedConsequence,
  base: Omit<ResolutionOutcome, "consequence" | "proteinChangeFound" | "numbering">
): ResolutionOutcome {
  const target = resolveProteinTarget(consequence.transcript_consequences ?? []);
  return {
    ...base,
    consequence,
    proteinChangeFound: target.proteinChangeFound,
    ...(target.numbering ? { numbering: target.numbering } : {}),
  };
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
      // Never persist failures, protein-free answers, or unverified numbering.
      shouldCache: isCacheable,
      // …and never SERVE one either. Translations are cached for ~10 years, so a payload written
      // before numbering was verified (or one written by another deployment) would otherwise keep
      // being returned un-reconciled even though a metadata-carrying provider is reachable again.
      isUsable: (cached) => isCacheable(cached),
      fetcher: async () => {
        fetchedFresh = true;
        const attempts: ProviderAttempt[] = [];
        // Started AFTER the cache lookup: a slow L2 read must not consume the ladder's budget
        // and leave the loop with nothing to try.
        const ladderStartedAt = Date.now();
        // Kept so a fully protein-free outcome can still explain itself.
        let informative: ResolvedConsequence | null = null;
        let informativeProvider: TranslationProvider | null = null;

        for (let i = 0; i < PROVIDER_CHAIN.length; i++) {
          const { provider, timeoutMs, resolve } = PROVIDER_CHAIN[i];
          // A caller-initiated abort propagates untouched so the HTTP layer can answer 504.
          if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
          if (deadline.signal.aborted) break; // budget exhausted; stop trying providers

          // ── Fair share of the remaining budget ──────────────────────────────────────
          // Handing the primary the WHOLE budget let a slow Ensembl VEP (whose own retry
          // envelope is several attempts long) consume all of it, so the loop broke before
          // VariantValidator — the tier that exists for a degraded primary — was ever called,
          // and the clinician was told "all reference providers are unreachable" for a
          // primary-only problem.
          //
          // Each provider now gets an even share of what remains, so every rung is guaranteed
          // a window. When the primary answers or fails fast (the common case) nothing has
          // been consumed, so the fallback still inherits nearly the whole budget.
          const providersLeft = PROVIDER_CHAIN.length - i;
          const remainingMs = budgetMs - (Date.now() - ladderStartedAt);
          const windowMs = Math.floor(remainingMs / providersLeft);

          // A provider is skipped only when no positive window is left at all: while any budget
          // remains, every rung gets a chance to answer rather than being written off.
          if (windowMs <= 0) {
            attempts.push({
              provider,
              ok: false,
              durationMs: 0,
              reason: `skipped: only ${Math.max(0, remainingMs)}ms of the ${budgetMs}ms budget remained`,
              failureKind: "upstream_unavailable",
            });
            continue;
          }

          const windowController = new AbortController();
          const windowTimer = setTimeout(
            () =>
              windowController.abort(
                new Error(
                  `${provider} exceeded its ${windowMs}ms share of the ${budgetMs}ms resolution budget`
                )
              ),
            windowMs
          );
          const providerSignal = anySignal([ladderSignal, windowController.signal]);

          const providerStartedAt = Date.now();
          try {
            // The provider's own attempt timeout is CAPPED by the window, so its tolerance can
            // never exceed the time the ladder actually granted it: the provider reports a
            // clean timeout instead of being killed by our timer and then called "unreachable".
            const { consequence, attempt } = await resolve(notation, assembly, providerSignal, {
              timeoutMs: Math.min(timeoutMs, windowMs),
            });
            clearTimeout(windowTimer);

            const target = resolveProteinTarget(consequence.transcript_consequences ?? []);
            if (!target.proteinChangeFound) {
              // A provider that maps the coordinate only to non-coding consequences has not
              // answered this platform's question. Record the miss, keep the payload for the
              // explanation, and let the next rung try — its annotation release may differ.
              attempts.push({
                ...attempt,
                ok: false,
                reason: "no protein-altering consequence reported",
                failureKind: "not_found",
              });
              if (!informative) {
                informative = consequence;
                informativeProvider = provider;
              }
              continue;
            }

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
            clearTimeout(windowTimer);
            if (signal?.aborted) throw err;

            if (err instanceof CoordinateResolutionError) {
              attempts.push(...err.attempts);
              continue;
            }

            // Non-namespaced error: either this provider's window expired, the ladder's
            // deadline fired, or the provider threw something unexpected. Only the deadline
            // ends the ladder — an expired window moves on to the next rung with the budget
            // that is left, which is what keeps a slow primary from starving the fallback.
            attempts.push({
              provider,
              ok: false,
              durationMs: Math.max(1, Date.now() - providerStartedAt),
              reason: deadline.signal.aborted
                ? `resolution budget of ${budgetMs}ms exceeded`
                : windowController.signal.aborted
                  ? `${provider} did not answer within its ${windowMs}ms share of the resolution budget`
                  : err?.message || "unexpected provider error",
              failureKind: "upstream_unavailable",
            });

            if (deadline.signal.aborted) break;
            continue;
          }
        }

        // Every rung was asked and none reported a protein change. Return the payload anyway —
        // the caller can then explain what the coordinate actually is (422 carrying the gene,
        // consequence terms and HGVSc) instead of a bare "not found".
        if (informative) {
          lastAttempts = attempts;
          const provider = informativeProvider ?? PROVIDER_CHAIN[0].provider;
          return {
            consequence: informative,
            assembly,
            resolvedBy: provider,
            usedFallback: provider !== PROVIDER_CHAIN[0].provider,
          };
        }

        const kind = classifyTotalFailure(attempts);
        throw new CoordinateResolutionError(kind, buildResolutionUnavailableMessage(kind), attempts);
      },
    });

    const cacheHit = !fetchedFresh;
    const attempts: ProviderAttempt[] = cacheHit
      ? [{ provider: cached.resolvedBy, ok: true, durationMs: 0, reason: "cache_hit" }]
      : lastAttempts;

    return buildOutcome(cached.consequence, {
      assembly: cached.assembly,
      attempts,
      // Prefer the provenance stored with the payload; fall back to deriving it for
      // entries written before `usedFallback` was persisted.
      usedFallback:
        cached.usedFallback ??
        (!cacheHit && cached.resolvedBy !== PROVIDER_CHAIN[0].provider),
      cacheHit,
    });
  } finally {
    clearTimeout(timer);
  }
}
