/**
 * structureRefs.ts — ONE definition of what a structure reference is, shared by the server that
 * mints them and the client that hands them back.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pocket and nearest-residue routes only need to READ a structure that the browser is already
 * displaying, but the browser used to upload the whole PDB text for every call (half a megabyte per
 * request), and — when a UniProt accession was known — the nearest-residue path dropped the text
 * entirely and let the server RE-RESOLVE the accession through its 3-tier ladder. The ladder is not
 * guaranteed to return what the reader is looking at: a Tier-1 experimental entry or a Tier-3
 * homolog can win on a later call while the viewer shows the AlphaFold model (or the reverse), so
 * the pocket and the contact map could be computed on a different molecule than the one on screen.
 *
 * A structure reference removes both problems at once. It is an OPAQUE handle bound to exact bytes
 * AND to one provenance context:
 *
 *   sref1_<32 hex chars>  = STRUCTURE_REF_PREFIX + sha256( "sref-v1\0" + sha256(PDB text)
 *                                                         + "\0" + provenanceContext )[0..32]
 *
 * The text digest is what makes a reference unable to name different bytes than the ones the server
 * returned; the provenance context is what makes its audit echo un-rewritable, so the same bytes
 * served as, say, chain B of an experimental entry can never be re-labelled as an AlphaFold model by
 * a later registration (see `identityContextKey` in the server's store). Same bytes plus same
 * provenance still yield the same reference, so re-serving a structure keeps one entry.
 *
 * A reference that no longer resolves is DETECTABLE (the server answers 409, and the caller falls
 * back to its own text) rather than silently swapping in another structure. The handle is opaque
 * enough that a client cannot construct one for text it received from somewhere else.
 *
 * The pattern lives here (rather than in either side's implementation) so the client's "is this a
 * reference?" check, the server's registry key, and the tests can never disagree about the shape.
 */

export const STRUCTURE_REF_PREFIX = "sref1_";

/** 128 bits of the SHA-256 digest: long enough that a collision is not a practical concern. */
export const STRUCTURE_REF_HEX_LENGTH = 32;

export const STRUCTURE_REF_PATTERN = /^sref1_[0-9a-f]{32}$/;

/**
 * The response header carrying a reference for the text a PDB route just served.
 *
 * A header, not a wrapper object, because these routes answer `text/plain` and every existing
 * reader (viewer included) keeps reading the body unchanged.
 */
export const STRUCTURE_REF_HEADER = "X-Template-StructureRef";

/** Maximum PDB text a reference may name — the same 5 MB ceiling both routes already enforce. */
export const STRUCTURE_REF_MAX_PDB_CHARS = 5 * 1024 * 1024;

export function isStructureRef(value: unknown): value is string {
  return typeof value === "string" && STRUCTURE_REF_PATTERN.test(value);
}

/**
 * Where a pocket/nearest computation's coordinates came from.
 *
 * `structureRef` — the exact bytes this server returned for that reference (preferred).
 * `pdbText`     — the caller's own bytes: a local upload, or the documented fallback for a
 *                 reference the server can no longer resolve.
 * `uniprot-resolver` — the legacy accession path, which may pick a DIFFERENT template than the one
 *                 on screen. Kept for old callers, never used when exact bytes are available.
 */
export const STRUCTURE_RESOLUTION_SOURCES = ["structureRef", "pdbText", "uniprot-resolver"] as const;
export type StructureResolutionSource = (typeof STRUCTURE_RESOLUTION_SOURCES)[number];

/**
 * The audit echo both routes return: which bytes were used, and (when known) what they are.
 *
 * `structureRef`, `source`, `pdbId` and `chainId` are provenance, not opinion: they name the record
 * the coordinates were taken from. `refTextMismatch` records the one case where the caller's bytes
 * won over a resolvable reference — they disagreed, and the caller's are what it displayed.
 */
export interface StructureResolutionEcho {
  resolvedFrom: StructureResolutionSource;
  structureRef?: string;
  source?: string;
  pdbId?: string;
  chainId?: string;
  refTextMismatch?: boolean;
}
