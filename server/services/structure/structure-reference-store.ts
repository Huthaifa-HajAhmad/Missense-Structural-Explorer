/**
 * structure-reference-store.ts — the server's bounded, content-addressed map from an opaque
 * `structureRef` to the EXACT PDB text this server handed out for it.
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * `/pocket-detect` and `/nearest-residues` are asked about the structure the browser is displaying.
 * Before this store, the browser re-uploaded that structure's full text on every call, or — worse,
 * when a UniProt accession was at hand — sent only the accession and let the server re-resolve it.
 * Re-resolution is not reproducible: the 3-tier ladder can answer with an experimental entry today
 * and an AlphaFold model tomorrow (this is exactly why `structure-resolver.ts` memoises its tier
 * choice), so the pocket could be measured on a different molecule than the one on screen.
 *
 * The store closes both gaps with one primitive: a PDB route that just served text registers it and
 * returns `sref1_<sha256[0..32]>`. Later calls present that reference, the server looks the text back
 * up, and the computation runs on the same bytes that were displayed — with no upload.
 *
 * WHY CONTENT-ADDRESSED (AND PROVENANCE-BOUND)
 * --------------------------------------------
 * The reference commits to the digest of the bytes, so it can never be made to name a different
 * structure: the same text under the same provenance always yields the same reference, and a
 * reference for evicted or unknown text resolves to nothing (never to somebody else's structure).
 * That is what lets the routes reject a stale reference safely instead of falling back to the
 * accession ladder.
 *
 * It also commits to ONE provenance context (see `identityContextKey`), because the audit echo that
 * tells the caller which structure it computed on must not be rewritable by a later registration of
 * the same bytes under a different chain or source.
 *
 * BOUNDS
 * ------
 * An LRU with BOTH an entry count and a byte budget, registered in the central cache registry so
 * `clearAllCaches()` reaches it and the memory report sees it. Only metadata lives here; the text
 * is the same string the route already served, retained so the reference keeps working while the
 * reader is still on that structure. An evicted reference is a recoverable condition, not corruption:
 * the caller re-sends the text and the request succeeds (see `resolveStructureInput` in the routes).
 *
 * NOT A SECOND PDB CACHE
 * ----------------------
 * `pdbCache` (by PDB id / accession) is untouched: this store is keyed by the bytes actually
 * returned, which is the one property the accession-keyed caches cannot express.
 */

import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { defaultCacheRegistry } from "../infra/cache.ts";
import {
  STRUCTURE_REF_MAX_PDB_CHARS,
  STRUCTURE_REF_PREFIX,
  STRUCTURE_REF_HEX_LENGTH,
  isStructureRef,
} from "../../../src/shared/structureRefs.ts";

const MAX_ENTRIES = 200;
/** ~96 MB of PDB text: hundreds of rotating accesses, never an unbounded process-lifetime map. */
const MAX_TOTAL_CHARS = 96 * 1024 * 1024;
/**
 * Six hours, matching the structure-resolution memo. Long enough for a research session with the
 * viewer open; short enough that a reference cannot outlive the deployment that minted it by much.
 */
const TTL_MS = 6 * 60 * 60 * 1000;

/** Where the text came from, and what it is — never inferred later, always recorded at registration. */
export interface StructureReferenceIdentity {
  /** "server": bytes this server fetched/resolved and served. "client": bytes a caller uploaded. */
  origin: "server" | "client";
  uniprotId?: string;
  /** Provenance source of the resolved structure (`experimental` | `alphafold` | `homolog`). */
  source?: string;
  pdbId?: string;
  chainId?: string;
  afdbVersion?: string;
  /** `/pdb/entry` numbering declaration (`uniprot` | `author`), when the route set one. */
  numbering?: string;
  /** The mutation position the resolution was coverage-gated on, when one was supplied. */
  pos?: number;
}

export interface StructureReferenceRecord {
  ref: string;
  pdbText: string;
  /** SHA-256 of `pdbText`, hex. Re-checked whenever a caller sends text alongside a reference. */
  digest: string;
  /**
   * The provenance this reference was minted for, and the context key that binds it to `ref`.
   *
   * Stable by construction, NOT "the last registrant": see `identityContextKey`.
   */
  identity: StructureReferenceIdentity;
  contextKey: string;
  registeredAt: number;
}

/**
 * Exposed for tests (forced eviction) and for the memory report. Not for production callers: go
 * through the functions below, which enforce the size and content guards.
 */
export const structureReferenceCache = new LRUCache<string, StructureReferenceRecord>({
  max: MAX_ENTRIES,
  maxSize: MAX_TOTAL_CHARS,
  sizeCalculation: (record) => record.pdbText.length + 64,
  ttl: TTL_MS,
  updateAgeOnGet: true,
});
defaultCacheRegistry.registerCache("structureReference", structureReferenceCache, { ttlDesc: "6h" });

function digestOf(pdbText: string): string {
  return crypto.createHash("sha256").update(pdbText, "utf8").digest("hex");
}

/**
 * The provenance context a reference is bound to, as a deterministic string.
 *
 * WHY THE PROVENANCE IS PART OF THE IDENTITY, NOT A MUTABLE FIELD
 * --------------------------------------------------------------
 * The first version keyed the store by the text alone and let each registration overwrite the
 * record's `identity`. Two callers serving the SAME bytes under different provenance (a chain-B
 * SIFTS mapping versus the full entry, or an experimental entry versus the AlphaFold model that
 * happens to be byte-identical after renumbering) therefore shared one record, and the second
 * registration silently rewrote what the first reference claimed to be. The text stayed exact — the
 * digest still named the bytes — but the AUDIT ECHO could attribute structure A's chain/source to a
 * request that was about structure B. An echo that can be wrong about provenance is worse than no
 * echo: it looks like verification.
 *
 * Binding the context into the reference fixes it without weakening content addressing: the
 * reference now commits to the exact bytes AND to one provenance, so identical bytes under the same
 * provenance always yield the same reference (re-serving a structure keeps a single entry), while a
 * different provenance yields a different reference whose record can never be overwritten by
 * another context. Both references resolve to the same text; only their echoes differ, and each is
 * true.
 *
 * Field order is fixed and every field is explicit, so the key cannot drift with property order.
 */
export function identityContextKey(identity: StructureReferenceIdentity): string {
  return JSON.stringify([
    identity.origin,
    identity.uniprotId ?? null,
    identity.source ?? null,
    identity.pdbId ?? null,
    identity.chainId ?? null,
    identity.afdbVersion ?? null,
    identity.numbering ?? null,
    identity.pos ?? null,
  ]);
}

/**
 * Derives a reference from the text digest and the provenance context.
 *
 * The digest is hashed first (expensive, once per structure) and the context is folded in second
 * (cheap), so the reference still commits to the exact bytes while naming exactly one provenance.
 */
export function structureRefForTextDigest(textDigest: string, identity: StructureReferenceIdentity): string {
  const bound = crypto
    .createHash("sha256")
    .update(`sref-v1\u0000${textDigest}\u0000${identityContextKey(identity)}`, "utf8")
    .digest("hex");
  return `${STRUCTURE_REF_PREFIX}${bound.slice(0, STRUCTURE_REF_HEX_LENGTH)}`;
}

/** True when the text can be named by a reference at all (non-empty, inside the route size ceiling). */
export function isReferenceablePdbText(pdbText: unknown): pdbText is string {
  return typeof pdbText === "string" && pdbText.length > 0 && pdbText.length <= STRUCTURE_REF_MAX_PDB_CHARS;
}

/**
 * Registers PDB text and returns the reference that names it AND its provenance context.
 *
 * Returns `null` when the text cannot be referenced (empty, or past the 5 MB ceiling both routes
 * enforce). A `null` is not an error: the caller simply omits the header and the legacy text path
 * keeps working.
 *
 * Re-registering the same bytes under the SAME provenance returns the same reference and refreshes
 * its recency. Registering them under a DIFFERENT provenance mints a second reference rather than
 * rewriting the first one's identity — the record a caller already holds must keep describing what
 * it described (see `identityContextKey`).
 */
export function registerStructureReference(
  pdbText: unknown,
  identity: StructureReferenceIdentity
): string | null {
  if (!isReferenceablePdbText(pdbText)) return null;

  const digest = digestOf(pdbText);
  const contextKey = identityContextKey(identity);
  const ref = structureRefForTextDigest(digest, identity);
  const existing = structureReferenceCache.get(ref);
  if (existing) {
    // Same bytes, same context: `get` already refreshed the LRU recency, and the identity is
    // identical by construction, so there is nothing to rewrite.
    return ref;
  }

  structureReferenceCache.set(ref, {
    ref,
    pdbText,
    digest,
    identity,
    contextKey,
    registeredAt: Date.now(),
  });
  return ref;
}

/** The record a reference names, or `null` for unknown / evicted / malformed references. */
export function resolveStructureReference(ref: unknown): StructureReferenceRecord | null {
  if (!isStructureRef(ref)) return null;
  return structureReferenceCache.get(ref) ?? null;
}

/**
 * Does this text hash to the digest the reference names?
 *
 * Used when a request carries BOTH a reference and text: the two must describe the same bytes. The
 * length check rejects the common case without hashing; the digest decides the rest, so a stale
 * reference can never cause the server to compute on structure A while the caller displayed B.
 */
export function structureReferenceMatchesText(
  record: Pick<StructureReferenceRecord, "digest" | "pdbText">,
  pdbText: string
): boolean {
  if (record.pdbText.length !== pdbText.length) return false;
  return record.digest === digestOf(pdbText);
}

export function clearStructureReferences(): void {
  structureReferenceCache.clear();
}

export function getStructureReferenceStoreSize(): number {
  return structureReferenceCache.size;
}
