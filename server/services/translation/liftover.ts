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
  ttlDesc: "365d (immutable reference mapping; failures not cached)"
});

/** Chromosomes the map/sequence endpoints address by bare name (1..22, X, Y, MT). */
const CANONICAL_CONTIG = /^(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT)$/;

interface SingleMapping {
  chrom: string;
  start: number;
  end: number;
}

/**
 * Parse an Ensembl assembly-map response into exactly one single-base, strand-1 mapping.
 * Anything else — zero mappings, multiple mappings (a paralogous region maps ambiguously),
 * a range expansion, or a strand flip — is a refusal, not a guess.
 */
export function parseSingleMapping(json: unknown): SingleMapping | null {
  const mappings = (json as any)?.mappings;
  if (!Array.isArray(mappings) || mappings.length !== 1) return null;
  const mapped = mappings[0]?.mapped;
  if (!mapped || typeof mapped.start !== "number" || typeof mapped.end !== "number") return null;
  if (mapped.strand !== 1) return null;
  // A range (start ≠ end) is not a point lift: the alleles would need re-derivation, which is
  // out of contract here. (Caught by the substitute harness — this check is the contract.)
  if (mapped.start !== mapped.end) return null;
  if (typeof mapped.seq_region_name !== "string") return null;
  return { chrom: normalizeContigName(mapped.seq_region_name), start: mapped.start, end: mapped.end };
}

async function mapRegion(
  from: GenomeAssembly,
  to: GenomeAssembly,
  chrom: string,
  start: number,
  end: number,
  deadlineAt?: number
): Promise<SingleMapping | null> {
  const url = `https://rest.ensembl.org/map/human/${from}/${encodeURIComponent(chrom)}:${start}-${end}:1/${encodeURIComponent(to)}?content-type=application/json`;
  const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" }, timeout: 8000, deadlineAt }, 1);
  if (!res.ok) return null;
  return parseSingleMapping(await res.json().catch(() => null));
}

/** The reference base at one position on the build the REST host serves (GRCh38). */
async function fetchCanonicalReferenceBase(chrom: string, pos: number, deadlineAt?: number): Promise<string | null> {
  const url = `https://rest.ensembl.org/sequence/region/human/${encodeURIComponent(chrom)}:${pos}-${pos}?content-type=text/plain`;
  const res = await fetchWithRetry(url, { headers: { "Accept": "text/plain" }, timeout: 8000, deadlineAt }, 1);
  if (!res.ok) return null;
  const base = (await res.text().catch(() => "")).trim().toUpperCase();
  return /^[ACGTN]$/.test(base) ? base : null;
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

async function performLift(coord: AssemblyTaggedCoordinate, deadlineAt?: number): Promise<LiftedCoordinate | null> {
  const v = validateCoordinate(coord);
  if (!v) return null;

  // A GRCh37→GRCh38 lift MAY legitimately land on the same numeric position; nothing here
  // requires the number to change — the round-trip and REF checks are what bind it.
  const forward = await mapRegion("GRCh37", CANONICAL_ASSEMBLY, v.chrom, v.pos, v.pos, deadlineAt);
  if (!forward || forward.chrom !== v.chrom) return null;

  const back = await mapRegion(CANONICAL_ASSEMBLY, "GRCh37", v.chrom, forward.start, forward.start, deadlineAt);
  if (!back || back.chrom !== v.chrom || back.start !== v.pos || back.end !== v.pos) return null;

  const refAtLifted = await fetchCanonicalReferenceBase(v.chrom, forward.start, deadlineAt);
  if (refAtLifted === null || refAtLifted !== v.ref) return null;

  return {
    chrom: v.chrom,
    pos: forward.start,
    ref: v.ref,
    alt: v.alt,
    assembly: CANONICAL_ASSEMBLY,
    originalAssembly: coord.assembly,
    original: { chrom: coord.chrom, pos: coord.pos },
    reverseVerified: true
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
  if (!coord) return null;
  const deadlineAt = options?.deadlineAt;

  // Already canonical: an identity lift through the SAME validation gate, so consumers get one
  // shape and no unvalidated string reaches a URL (review M2). The position is, trivially,
  // already on the canonical build — reverseVerified is vacuously true for a no-op lift, and
  // the REF check that carries real weight happens at the caller's VEP echo comparison.
  if (coord.assembly === CANONICAL_ASSEMBLY) {
    const v = validateCoordinate(coord);
    if (!v) return null;
    return {
      ...v,
      assembly: CANONICAL_ASSEMBLY,
      originalAssembly: coord.assembly,
      original: { chrom: coord.chrom, pos: coord.pos },
      reverseVerified: true
    };
  }

  // The lift is an auxiliary recovery on the same shared per-host breaker as the primary
  // annotation path. When the host is already ejected, skip it: the calls would fail instantly
  // anyway, and consuming the breaker's HALF-OPEN probe slot for an auxiliary feature delays
  // the recovery of real traffic (review M3).
  if (!isHostAvailable("https://rest.ensembl.org")) return null;

  const key = buildCoordinateLiftKey(coord.chrom, coord.pos, coord.ref, coord.alt, coord.assembly, CANONICAL_ASSEMBLY);
  return getCachedOrFetch<LiftedCoordinate | null>({
    key,
    source: "Ensembl Assembly Map",
    l1Cache: liftCache,
    ttlSeconds: LIFT_TTL_SECONDS,
    // getCachedOrFetch's default shouldCache already refuses null, so a transient outage
    // degrades this request without pinning the variant (F-4).
    fetcher: () => performLift(coord, deadlineAt).catch(() => null)
  });
}
