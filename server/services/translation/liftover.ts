/**
 * liftover.ts — assembly policy #2, implemented.
 *
 * `src/shared/assembly.ts` declares: "Coordinates are LIFTED to the canonical build when the
 * input build differs, and the lift is REVERSE-VERIFIED before use." Before this module the
 * declaration was a type (`LiftedCoordinate`) and a test — no code. The consequence was the
 * "unmapping defect": a variant whose coordinate arrives GRCh37-tagged (MyVariant.info fallback,
 * or an hg19-annotated user input) was REFUSED by every GRCh38-only source — splice-junction
 * geometry, AlphaGenome, PopEVE, GPN-Star, gnomAD r4 — permanently, with no recovery path.
 * See doc/UNMAPPING_DEFECT_SPLICE_AUDIT.md (F-3).
 *
 * Verification is three-fold, and a lift that fails ANY of them yields `null` (never a flagged
 * value — `LiftedCoordinate.reverseVerified` exists precisely so an unverified lift cannot be
 * expressed):
 *   1. FORWARD map: exactly one GRCh37→GRCh38 mapping, single base, same contig, strand 1.
 *   2. REVERSE map: mapping the result back reproduces the original position exactly.
 *   3. REFERENCE check: the GRCh38 base at the lifted position equals the supplied REF allele.
 *      This is the check that turns "plausible coordinate" into "same variant": assembly.ts
 *      warns that a wrong-build position whose REF coincidentally matches will be ACCEPTED by
 *      build-pinned services and score a DIFFERENT locus. A lift that passes 1-2 but fails 3
 *      is a reference discontinuity, and refusing it is the whole point.
 *
 * Only single-base substitutions are lifted. Indels map to ranges or fail the round-trip far
 * more often, and silently approximating one is worse than refusing it.
 *
 * Results are reference data: cached in L1 and persisted to the L2 external cache with a
 * ~10-year TTL. Failures are NOT cached — a transient Ensembl outage must not pin a variant
 * to the unlifted state (that was finding F-4's cache-amplification pattern). The cache key
 * carries the ALLELES, not just the position: the cached value embeds ref/alt, and two SNVs
 * at one position would otherwise serve each other's alt (external review H3 — the one
 * silent-wrongness a position-only mapping invites).
 */
import { LRUCache } from "lru-cache";
import { fetchWithRetry, isHostAvailable } from "../infra/http-client.ts";
import { getCachedOrFetch, defaultCacheRegistry } from "../infra/cache.ts";
import { buildCoordinateLiftKey } from "../infra/cache-keys.ts";
import {
  CANONICAL_ASSEMBLY,
  normalizeContigName,
  type AssemblyTaggedCoordinate,
  type LiftedCoordinate
} from "../../../src/shared/assembly.ts";
import type { GenomeAssembly } from "../../../src/shared/variantNotation.ts";

/** ~10 years — a GRCh37↔GRCh38 mapping is a property of the reference assemblies. */
const LIFT_TTL_SECONDS = 315_360_000;

const liftCache = new LRUCache<string, LiftedCoordinate>({
  max: 2000,
  ttl: LIFT_TTL_SECONDS / 1000
});
defaultCacheRegistry.registerCache("coordinateLiftCache", liftCache, {
  ttlDesc: "10y (immutable reference mapping; failures not cached)"
});

/** Chromosomes the map/sequence endpoints address by bare name (1..22, X, Y, MT). */
const CANONICAL_CONTIG = /^(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT)$/;

interface SingleMapping {
  chrom: string;
  start: number;
  end: number;
}

/**
 * Why a lift was refused.
 *
 * The distinction is not cosmetic: a caller (and the reader behind it) must be able to tell a
 * RETRYABLE cause from a definitive one. An assembly map that did not answer, or that we stopped at
 * our own deadline, may succeed in a minute; a coordinate whose alleles do not match the target
 * reference will never lift on its own, and a paralogous region maps more than once no matter how
 * often it is asked. Before this, every refusal arrived as `null` and the reason could only be
 * guessed at in prose — so a retry could not be advised even in the case where it works.
 */
export type LiftFailureCode =
  /** Not a single-base substitution on a contig the assembly map addresses. */
  | "invalid-coordinate"
  /** The map answered with no mapping at all for that position. */
  | "no-mapping"
  /** More than one mapping, or a strand / range expansion — the position cannot be located uniquely. */
  | "ambiguous-mapping"
  /** A single mapping that lands on a different chromosome: not the same locus. */
  | "contig-changed"
  /** Mapping back did not reproduce the submitted position. */
  | "round-trip-failed"
  /** The target build's base at the lifted position is not the submitted REF allele. */
  | "reference-discontinuity"
  /** The map (or the reference-base endpoint) could not be consulted. */
  | "map-unavailable"
  /** Our own deadline, or an open breaker, stopped the attempt before an answer arrived. */
  | "budget-exceeded";

export type LiftAttempt =
  | { lifted: LiftedCoordinate }
  | { failure: LiftFailureCode };

/** Parses one mapping, reporting WHY it is unusable rather than collapsing every case to null. */
export function classifyMapping(json: unknown): { mapping: SingleMapping } | { failure: LiftFailureCode } {
  const mappings = (json as any)?.mappings;
  if (!Array.isArray(mappings)) return { failure: "map-unavailable" };
  if (mappings.length === 0) return { failure: "no-mapping" };
  // More than one candidate is the paralogous-region case: locatable, but not uniquely.
  if (mappings.length !== 1) return { failure: "ambiguous-mapping" };

  const mapped = mappings[0]?.mapped;
  if (!mapped || typeof mapped.start !== "number" || typeof mapped.end !== "number") {
    return { failure: "ambiguous-mapping" };
  }
  if (mapped.strand !== 1) return { failure: "ambiguous-mapping" };
  // A range (start ≠ end) is not a point lift: the alleles would need re-derivation, which is out of
  // contract here. (Caught by the substitute harness — this check is the contract.)
  if (mapped.start !== mapped.end) return { failure: "ambiguous-mapping" };
  if (typeof mapped.seq_region_name !== "string") return { failure: "map-unavailable" };

  return {
    mapping: {
      chrom: normalizeContigName(mapped.seq_region_name),
      start: mapped.start,
      end: mapped.end,
    },
  };
}

/**
 * Parse an Ensembl assembly-map response into exactly one single-base, strand-1 mapping.
 * Anything else — zero mappings, multiple mappings (a paralogous region maps ambiguously),
 * a range expansion, or a strand flip — is a refusal, not a guess.
 *
 * Retained as the boolean-shaped accessor: every existing caller and test asks "is this ONE usable
 * mapping?", and `classifyMapping` is where the reason lives.
 */
export function parseSingleMapping(json: unknown): SingleMapping | null {
  const classified = classifyMapping(json);
  return "mapping" in classified ? classified.mapping : null;
}

/**
 * The REST host for a build's sequence endpoints — the same host mapping the annotation path uses.
 */
function hostForAssembly(assembly: GenomeAssembly): string {
  return assembly === "GRCh37" ? "https://grch37.rest.ensembl.org" : "https://rest.ensembl.org";
}

/**
 * A failure code for a non-OK assembly-map / sequence answer.
 *
 * A 4xx (other than a rate limit) is a statement about the REQUEST — the map is telling us it cannot
 * address that position — so it is reported as a definitive refusal and not as a retryable outage.
 * Measured live: `sequence/region/human/1:999999999..999999999` answers 400 "Cannot request a slice
 * whose start (999999999) is greater than 248956422 for 1", which is not something a retry changes.
 */
function failureForStatus(status: number): LiftFailureCode {
  return status >= 500 || status === 429 ? "map-unavailable" : "no-mapping";
}

async function mapRegion(
  from: GenomeAssembly,
  to: GenomeAssembly,
  chrom: string,
  start: number,
  end: number,
  deadlineAt?: number
): Promise<{ mapping: SingleMapping } | { failure: LiftFailureCode }> {
  /**
   * The MAIN site's map endpoint, whatever the submitted build: it maps between any two assemblies in
   * one call (`/map/human/GRCh37/<region>/GRCh38`), which is why the lift only ever asks it. The
   * archive host serves the GRCh37-oriented REST surface, NOT this one — routing the map here (a
   * tempting symmetry with the sequence endpoint below) would ask a host that does not answer it.
   */
  const url = `https://rest.ensembl.org/map/human/${from}/${encodeURIComponent(chrom)}:${start}-${end}:1/${encodeURIComponent(to)}?content-type=application/json`;
  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers: { "Accept": "application/json" }, timeout: 8000, deadlineAt }, 1);
  } catch {
    // Transport failure, or our deadline stopped a retry: the caller maps this to a code using the
    // clock it already has, so the distinction survives without threading a signal through here.
    return { failure: "map-unavailable" };
  }
  if (!res.ok) return { failure: failureForStatus(res.status) };
  return classifyMapping(await res.json().catch(() => null));
}

/**
 * The reference base at one position, on any build's REST host.
 *
 * Returns the failure code rather than null so a discontinuity is distinguishable from an endpoint
 * that could not be consulted — the first is permanent, the second is worth retrying.
 *
 * EXPORTED because two callers must agree on what "the reference base there" means: the lift's own
 * verification, and the route's check of the build it is about to offer as a retry. Using one
 * implementation is the point — a second one could disagree with the lift about the same position.
 */
export async function fetchAssemblyReferenceBase(
  chrom: string,
  pos: number,
  assembly: GenomeAssembly,
  deadlineAt?: number
): Promise<{ base: string } | { failure: LiftFailureCode }> {
  const url = `${hostForAssembly(assembly)}/sequence/region/human/${encodeURIComponent(chrom)}:${pos}-${pos}?content-type=text/plain`;
  let res: Response;
  try {
    res = await fetchWithRetry(url, { headers: { "Accept": "text/plain" }, timeout: 8000, deadlineAt }, 1);
  } catch {
    return { failure: "map-unavailable" };
  }
  if (!res.ok) return { failure: failureForStatus(res.status) };
  const base = (await res.text().catch(() => "")).trim().toUpperCase();
  return /^[ACGTN]$/.test(base) ? { base } : { failure: "map-unavailable" };
}

/** The reference base on the canonical build — the lift's own use of {@link fetchAssemblyReferenceBase}. */
function fetchCanonicalReferenceBase(
  chrom: string,
  pos: number,
  deadlineAt?: number
): Promise<{ base: string } | { failure: LiftFailureCode }> {
  return fetchAssemblyReferenceBase(chrom, pos, CANONICAL_ASSEMBLY, deadlineAt);
}

/**
 * Every coordinate — lifted or already canonical — passes through this gate before it leaves
 * the module. The identity branch used to return the caller's object untouched (review M2):
 * the exported signature accepts any AssemblyTaggedCoordinate, so a future caller feeding
 * stored or unvalidated data would interpolate raw strings into URL path segments and skip
 * the contig/single-base contracts the mapped branch enforces.
 */
function validateCoordinate(coord: AssemblyTaggedCoordinate): { chrom: string; pos: number; ref: string; alt: string } | null {
  const chrom = normalizeContigName(coord.chrom);
  if (!CANONICAL_CONTIG.test(chrom)) return null;
  if (!Number.isInteger(coord.pos) || coord.pos <= 0 || coord.pos > 400_000_000) return null;
  const ref = coord.ref.toUpperCase();
  const alt = coord.alt.toUpperCase();
  if (ref.length !== 1 || alt.length !== 1) return null;
  if (!/^[ACGTN]$/.test(ref) || !/^[ACGTN]$/.test(alt)) return null;
  return { chrom, pos: coord.pos, ref, alt };
}

async function performLift(coord: AssemblyTaggedCoordinate, deadlineAt?: number): Promise<LiftAttempt> {
  const v = validateCoordinate(coord);
  if (!v) return { failure: "invalid-coordinate" };

  // A GRCh37→GRCh38 lift MAY legitimately land on the same numeric position; nothing here
  // requires the number to change — the round-trip and REF checks are what bind it.
  const forward = await mapRegion("GRCh37", CANONICAL_ASSEMBLY, v.chrom, v.pos, v.pos, deadlineAt);
  if ("failure" in forward) return forward;
  if (forward.mapping.chrom !== v.chrom) return { failure: "contig-changed" };

  /**
   * The two remaining checks are INDEPENDENT — neither consumes the other's result — so they run
   * together.
   *
   * Measured live on the reported coordinate: forward 1.9s, reverse 9.3s, reference base 0.1s,
   * 17.3s end to end. The lift's cost is provider LATENCY, not its number of checks, and the caller
   * has a bounded budget (`intake-assembly.ts`); sequencing two independent calls is what made a
   * perfectly verifiable coordinate lose its lift to a timeout. Both checks must still pass — this
   * is a scheduling change, not a relaxation.
   */
  const lifted = forward.mapping.start;
  const [back, refAtLifted] = await Promise.all([
    mapRegion(CANONICAL_ASSEMBLY, "GRCh37", v.chrom, lifted, lifted, deadlineAt),
    fetchCanonicalReferenceBase(v.chrom, lifted, deadlineAt),
  ]);

  if ("failure" in back) return back;
  if (back.mapping.chrom !== v.chrom || back.mapping.start !== v.pos || back.mapping.end !== v.pos) {
    return { failure: "round-trip-failed" };
  }
  if ("failure" in refAtLifted) return refAtLifted;
  // The base differs: a permanent, definitive refusal (the reference assemblies disagree there),
  // which is exactly the case a retry cannot fix.
  if (refAtLifted.base !== v.ref) return { failure: "reference-discontinuity" };

  return {
    lifted: {
      chrom: v.chrom,
      pos: lifted,
      ref: v.ref,
      alt: v.alt,
      assembly: CANONICAL_ASSEMBLY,
      originalAssembly: coord.assembly,
      original: { chrom: coord.chrom, pos: coord.pos },
      reverseVerified: true,
    },
  };
}

/**
 * Lift one coordinate onto the canonical build (GRCh38), reverse-verified.
 *
 * Returns `null` when no verified lift exists — an indel, an ambiguous or failed mapping, a
 * reference discontinuity, or an upstream outage. Callers must then keep the coordinate on its
 * original build and let the assembly gate refuse build-pinned sources: absence reads as
 * "not assessed", which is true; a coerced coordinate reads as evidence, and would not be.
 *
 * `deadlineAt` bounds the whole lift (≤3 sequential Ensembl calls). The predictor path runs
 * inside the analysis stream's idle budget, so an auxiliary recovery must not consume it —
 * a lift that cannot finish in time degrades to "not lifted", exactly like an outage (review M4).
 */
export async function liftCoordinateToCanonical(
  coord: AssemblyTaggedCoordinate | null | undefined,
  options?: { deadlineAt?: number }
): Promise<LiftedCoordinate | null> {
  const attempt = await attemptCoordinateLift(coord, options);
  return "lifted" in attempt ? attempt.lifted : null;
}

/**
 * The same lift, reporting WHY it was refused.
 *
 * `liftCoordinateToCanonical` answers "is there a verified lift?" — the only question the predictor
 * path asks, and it stays the boolean-shaped API so nothing there changes. A caller that must DECIDE
 * something (annotate on the submitted build? advise a retry? tell the reader the two references
 * disagree?) needs the reason, and it cannot be reconstructed from `null`: a map outage is worth
 * retrying, a reference discontinuity never is, and a paralogous region maps more than once however
 * often it is asked.
 *
 * Successes are cached exactly as before; failures deliberately are not (F-4), so the reason is
 * always fresh and a transient outage cannot pin a variant.
 */
export async function attemptCoordinateLift(
  coord: AssemblyTaggedCoordinate | null | undefined,
  options?: { deadlineAt?: number }
): Promise<LiftAttempt> {
  if (!coord) return { failure: "invalid-coordinate" };
  const deadlineAt = options?.deadlineAt;

  // Already canonical: an identity lift through the SAME validation gate, so consumers get one
  // shape and no unvalidated string reaches a URL (review M2). The position is, trivially,
  // already on the canonical build — reverseVerified is vacuously true for a no-op lift, and
  // the REF check that carries real weight happens at the caller's VEP echo comparison.
  if (coord.assembly === CANONICAL_ASSEMBLY) {
    const v = validateCoordinate(coord);
    if (!v) return { failure: "invalid-coordinate" };
    return {
      lifted: {
        ...v,
        assembly: CANONICAL_ASSEMBLY,
        originalAssembly: coord.assembly,
        original: { chrom: coord.chrom, pos: coord.pos },
        reverseVerified: true,
      },
    };
  }

  // The lift is an auxiliary recovery on the same shared per-host breaker as the primary
  // annotation path. When the host is already ejected, skip it: the calls would fail instantly
  // anyway, and consuming the breaker's HALF-OPEN probe slot for an auxiliary feature delays
  // the recovery of real traffic (review M3). Reported as retryable, because that is what it is.
  if (!isHostAvailable("https://rest.ensembl.org")) return { failure: "budget-exceeded" };

  const key = buildCoordinateLiftKey(coord.chrom, coord.pos, coord.ref, coord.alt, coord.assembly, CANONICAL_ASSEMBLY);

  /**
   * A refused lift is expressed as a THROW carrying its code, not as a sentinel value.
   *
   * Why: the cache stores SUCCESSES only, so the stored payload shape stays `LiftedCoordinate` — no
   * cache-generation bump, no purge of every unrelated cache, and a failure still cannot be pinned
   * for a decade. The throw is caught immediately below and converted back into a value.
   */
  class LiftRefused extends Error {
    constructor(readonly code: LiftFailureCode) {
      super(`coordinate lift refused: ${code}`);
    }
  }

  try {
    const lifted = await getCachedOrFetch<LiftedCoordinate>({
      key,
      source: "Ensembl Assembly Map",
      l1Cache: liftCache,
      ttlSeconds: LIFT_TTL_SECONDS,
      fetcher: async () => {
        const attempt = await performLift(coord, deadlineAt);
        if ("failure" in attempt) throw new LiftRefused(attempt.failure);
        return attempt.lifted;
      },
    });
    return { lifted };
  } catch (err: any) {
    if (err instanceof LiftRefused) {
      /**
       * ONLY a retryable code may be upgraded to `budget-exceeded`.
       *
       * The clock can tell us "we stopped asking", but it must not overwrite what the map SAID: a
       * definitive refusal (a reference discontinuity, a mapping that lands elsewhere) is a fact about
       * the coordinate, and relabelling it as our own deadline made `isRetryableLiftRefusal` return
       * true for it — advising a retry that can never succeed, and contradicting the schema's own
       * description of those codes. `map-unavailable` is the code the clock legitimately explains.
       */
      const expired = deadlineAt !== undefined && Date.now() >= deadlineAt;
      const retryable = err.code === "map-unavailable";
      return { failure: expired && retryable ? "budget-exceeded" : err.code };
    }
    // Anything else is a transport failure inside the cache layer: retryable, never definitive.
    return { failure: "map-unavailable" };
  }
}
