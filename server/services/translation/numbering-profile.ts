import { LRUCache } from "lru-cache";
import { getCachedOrFetch, defaultCacheRegistry } from "../infra/cache.ts";
import { buildNumberingProfileKey } from "../infra/cache-keys.ts";
import {
  fetchManeIsoformId,
  fetchUniprotIsoforms,
  type UniprotIsoform,
} from "../external-api/uniprot.ts";
import {
  mapPositionAcrossSequences,
  normaliseSequence,
  renameSubstitution,
  parseSubstitution,
  sequencesAreComparable,
  toNumberingBases,
} from "./isoform-remap.ts";
import { isCanonicalIsoformId } from "./isoform-numbering.ts";

/** Small L1 in front of the persisted profiles (one entry per gene, tiny payloads). */
export const numberingProfileCache = new LRUCache<string, NumberingProfile>({ max: 200 });

// REGISTERED, not merely created: an unregistered LRU is invisible to `clearAllCaches` (so it leaks
// across tests and any operator-triggered flush) and to the memory/health reports.
defaultCacheRegistry.registerCache("numberingProfileCache", numberingProfileCache, { ttlDesc: "30d" });

/**
 * One position where a BARE notation cannot be resolved by residue number alone.
 *
 * Both readings carry the same wild-type letter — canonical at `position`, and the MANE protein at
 * `position`, which is canonical `canonicalPosition`. Nothing in the input distinguishes them, so
 * the caller must refuse and offer the choice rather than model whichever the index pointed at.
 */
export interface NumberingAmbiguity {
  /** The number as written (MANE numbering, i.e. what a lab report uses). */
  position: number;
  /** What that same substitution is at canonical numbering. */
  canonicalPosition: number;
  /** Isoform whose numbering produces this second reading. */
  basisIsoformId: string;
  maneProteinId?: string;
}

/**
 * A gene's numbering shape, computed ONCE and cached.
 *
 * The per-request check used to re-derive this from two provider lookups, which meant a cold request
 * (and every request during an outage) paid for reference data that only changes when UniProt
 * releases. This is the same class of fact as the coordinate map: static, cacheable, and the thing
 * that actually answers "can this residue number mean two things?".
 */
export interface NumberingProfile {
  canonicalAccession: string;
  canonicalLength: number;
  /** MANE protein (`NP_…`) when the entry names one. */
  maneProteinId?: string;
  maneIsoformId?: string;
  /**
   * False when the MANE protein IS the canonical sequence, in which case a typed number is
   * unambiguous by construction and no comparison is needed at all.
   */
  maneNumberingDiffers: boolean;
  /** True when the MANE protein could be identified AND is comparable to the canonical sequence. */
  maneIdentified: boolean;
  /**
   * Positions where canonical and MANE readings BOTH fit at different canonical positions.
   *
   * Read this together with {@link unverifiable}: a position in NEITHER list is unambiguous only
   * because the MANE basis either carries a different residue there or maps to the same position.
   */
  ambiguous: NumberingAmbiguity[];
  /**
   * Positions the MANE pair agrees on, but where ANOTHER isoform also carries the same residue at a
   * different canonical position.
   *
   * Not a refusal — the scope for a bare notation is canonical-vs-MANE — but not a clean bill either:
   * a report numbered on that isoform would mean a different residue. Kept separate from `ambiguous`
   * so the caller can accept the canonical reading and DISCLOSE this, instead of claiming a
   * verification that only covered the MANE pair.
   */
  contested: NumberingAmbiguity[];
  /**
   * Positions where the two proteins carry the SAME residue but the second reading could not be
   * located (it lies inside the region where the proteins differ).
   *
   * Without this list the position would fall out of `ambiguous` and be answered "verified canonical"
   * — i.e. an unchecked position reported as a checked one, which is how a bare notation came to be
   * modelled as the wrong residue. Callers must treat these as unverified, never as canonical.
   */
  unverifiable: number[];
  /**
   * How many coinciding positions were actually checked. Coverage, not a count of findings: absence
   * of evidence must never be readable as evidence of absence.
   */
  coincidencesChecked: number;
  /** UniProt release data changes; recomputed after this many days. */
  computedAt: string;
  /** Bumped when the build LOGIC changes, so a logic fix can never be served from an old row. */
  buildVersion: number;
}

/**
 * Version of the profile-building LOGIC.
 *
 * Distinct from `CACHE_SCHEMA_VERSION`, which only covers the payload SHAPE: the ambiguity set can be
 * wrong while the shape is identical (it was — the affix fix changes findings, not fields), and such a
 * row would otherwise be served for its full TTL.
 */
export const NUMBERING_PROFILE_BUILD_VERSION = 3;

/** UniProt releases move isoform sets; a month is the same horizon as the other UniProt caches. */
export const NUMBERING_PROFILE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Pure: given the entry's isoform sequences and its MANE cross-reference, derive the profile.
 *
 * Returns null when the canonical sequence is unavailable, so callers never cache a half-built
 * profile (an empty `ambiguous` list would otherwise read as "nothing is ambiguous" — the exact
 * wrong conclusion, and one that would be served for a month).
 */
export function buildNumberingProfile(params: {
  canonicalAccession: string;
  isoforms: UniprotIsoform[];
  maneProteinId?: string;
  maneIsoformId?: string;
}): NumberingProfile | null {
  const { canonicalAccession, isoforms, maneProteinId, maneIsoformId } = params;
  const bases = toNumberingBases(isoforms, canonicalAccession).map((basis) => ({
    ...basis,
    // Normalise BEFORE any comparison. A single case or whitespace artefact in a provider record made
    // every index differ, the coincidence list come out empty, and the whole gene's protection vanish
    // — silently, for a month, because that empty list was cached.
    sequence: normaliseSequence(basis.sequence),
  }));
  const canonical = bases.find((basis) => basis.kind === "canonical");
  if (!canonical || canonical.sequence.length === 0 || !/^[A-Z]+$/.test(canonical.sequence)) return null;

  let maneBasis = maneIsoformId
    ? isCanonicalIsoformId(maneIsoformId, canonicalAccession)
      ? canonical
      : bases.find((basis) => basis.id.trim().toUpperCase() === maneIsoformId.trim().toUpperCase())
    : undefined;

  // A basis that is not a numbering of this protein (a reversed or truncated record) cannot be
  // compared: treat it as unidentified so the caller falls back to the conservative comparison
  // instead of reading an empty ambiguity list as reassurance.
  if (maneBasis && !sequencesAreComparable(maneBasis.sequence, canonical.sequence)) {
    maneBasis = undefined;
  }

  const base: NumberingProfile = {
    canonicalAccession,
    canonicalLength: canonical.sequence.length,
    maneProteinId,
    maneIsoformId: maneBasis?.id ?? maneIsoformId,
    maneNumberingDiffers: false,
    maneIdentified: Boolean(maneBasis),
    ambiguous: [],
    contested: [],
    unverifiable: [],
    coincidencesChecked: 0,
    computedAt: new Date().toISOString(),
    buildVersion: NUMBERING_PROFILE_BUILD_VERSION,
  };

  if (!maneBasis) {
    // Without a comparable MANE basis the pair cannot be compared, and pretending otherwise is what
    // produced a silent wrong residue. `maneIdentified: false` makes the caller compare every
    // isoform — more refusals, never a guess.
    return { ...base, maneNumberingDiffers: true };
  }
  if (maneBasis.sequence === canonical.sequence) {
    return { ...base, coincidencesChecked: canonical.sequence.length };
  }

  const ambiguous: NumberingAmbiguity[] = [];
  const contested: NumberingAmbiguity[] = [];
  const unverifiable = new Set<number>();
  const ambiguousPositions = new Set<number>();
  let coincidencesChecked = 0;

  /**
   * Every isoform is scanned, not just MANE: a position the MANE pair agrees on can still be read
   * differently by another isoform, and calling that "verified" would claim a check that only covered
   * one pair. Those become `contested` (disclosed), never `ambiguous` (refused), because a bare
   * notation in practice comes from the canonical or MANE numbering.
   */
  for (const basis of bases) {
    if (basis.kind === "canonical") continue;
    const isManeBasis = maneBasis !== undefined && basis.id.toUpperCase() === maneBasis.id.toUpperCase();

    for (let position = 1; position <= basis.sequence.length; position++) {
      if (basis.sequence[position - 1] !== canonical.sequence[position - 1]) continue;
      const mapped = mapPositionAcrossSequences({
        basisSequence: basis.sequence,
        canonicalSequence: canonical.sequence,
        position,
      });
      if (mapped.status !== "mapped") {
        // The same residue, and this reading could not be located: NOT proof that only the canonical
        // reading fits. Recorded so the caller answers "unverified" instead of "verified".
        unverifiable.add(position);
        continue;
      }
      if (isManeBasis) coincidencesChecked++;
      if (mapped.mapping.canonicalPosition === position) continue;

      if (isManeBasis) {
        ambiguousPositions.add(position);
        ambiguous.push({
          position,
          canonicalPosition: mapped.mapping.canonicalPosition,
          basisIsoformId: basis.id,
          maneProteinId,
        });
      } else if (!contested.some((entry) => entry.position === position)) {
        contested.push({
          position,
          canonicalPosition: mapped.mapping.canonicalPosition,
          basisIsoformId: basis.id,
        });
      }
    }
  }

  return {
    ...base,
    maneNumberingDiffers: true,
    ambiguous,
    // A position already refused as ambiguous is not merely "contested": the refusal is the stronger,
    // more useful answer, and reporting both would offer a choice the reader cannot resolve.
    contested: contested.filter((entry) => !ambiguousPositions.has(entry.position)),
    unverifiable: [...unverifiable].sort((a, b) => a - b),
    coincidencesChecked,
  };
}

function isUsableProfile(profile: NumberingProfile | null | undefined, key: string): profile is NumberingProfile {
  return Boolean(
    profile &&
      profile.canonicalAccession === key &&
      profile.buildVersion === NUMBERING_PROFILE_BUILD_VERSION &&
      typeof profile.canonicalLength === "number" &&
      profile.canonicalLength > 0 &&
      typeof profile.maneNumberingDiffers === "boolean" &&
      typeof profile.maneIdentified === "boolean" &&
      typeof profile.coincidencesChecked === "number" &&
      // An ABSENT coverage list is the one payload that must never be served: it reads as "nothing is
      // ambiguous" and "nothing was unchecked" at once.
      Array.isArray(profile.ambiguous) &&
      Array.isArray(profile.contested) &&
      Array.isArray(profile.unverifiable) &&
      [profile.ambiguous, profile.contested].every((list) =>
        list.every(
          (entry) =>
            entry &&
            Number.isInteger(entry.position) &&
            Number.isInteger(entry.canonicalPosition) &&
            typeof entry.basisIsoformId === "string"
        )
      ) &&
      profile.unverifiable.every((position) => Number.isInteger(position)) &&
      /**
       * Age is checked HERE as well as by the cache TTL. `computedAt` was written and never read, which
       * left a mis-set TTL (or a future caller bypassing the cache) free to serve a stale profile — the
       * unsafe direction, since a newly ambiguous position would be reported as verified.
       */
      Number.isFinite(Date.parse(profile.computedAt)) &&
      Date.now() - Date.parse(profile.computedAt) <= NUMBERING_PROFILE_TTL_SECONDS * 1000
  );
}

/**
 * The cached profile for an accession. Throws on provider failure and returns null only for an entry
 * with no canonical sequence — callers treat both as "cannot verify", never as "nothing ambiguous".
 */
export async function getNumberingProfile(
  canonicalAccession: string,
  options?: { bypassSqlite?: boolean; signal?: AbortSignal; cappedByCaller?: boolean }
): Promise<NumberingProfile | null> {
  const key = canonicalAccession.trim().toUpperCase();
  return getCachedOrFetch<NumberingProfile | null>({
    key: buildNumberingProfileKey(key),
    source: "numbering profile (UniProt isoforms + MANE)",
    // L1 as well as L2: without it every request with a bare notation pays an async SQLite/worker
    // read, and the cache stays invisible to the memory/health reports.
    l1Cache: numberingProfileCache,
    ttlSeconds: NUMBERING_PROFILE_TTL_SECONDS,
    bypassSqlite: options?.bypassSqlite,
    shouldCache: (profile) => isUsableProfile(profile, key),
    // Never serve a half-built, legacy or wrong-build payload: an absent or empty `ambiguous` list
    // asserts "nothing is ambiguous", and an old BUILD's list can be wrong while its shape is fine.
    isUsable: (profile) => isUsableProfile(profile, key),
    fetcher: async () => {
      const isoforms = await fetchUniprotIsoforms(key, options);
      const mane = await fetchManeIsoformId(key, options);
      return buildNumberingProfile({
        canonicalAccession: key,
        isoforms,
        maneProteinId: mane?.proteinId,
        maneIsoformId: mane?.isoformId,
      });
    },
  });
}

/** Canonical-equivalent notation for a substitution moved to another residue number. */
export function notationAtCanonicalPosition(notation: string, canonicalPosition: number): string {
  const parsed = parseSubstitution(notation);
  if (!parsed) return notation;
  return renameSubstitution(notation, parsed, canonicalPosition);
}
