/**
 * structureRefRegistry.ts — the browser-side association between the exact PDB text this session
 * received from the server and the opaque `structureRef` that names those bytes server-side.
 *
 * WHY IT IS NEEDED
 * ----------------
 * The pipeline hands the pocket and nearest-residue helpers nothing but `pdbText` (the orchestrator
 * passes only the string), so the reference returned alongside the coordinates would otherwise be
 * dropped on the floor and every later call would upload the whole structure again — or, for the
 * nearest-residue path, fall back to re-resolving the UniProt accession into a possibly different
 * template than the one on screen.
 *
 * `fetchPdbCoordinates` registers what it received (text + reference) here; the pocket/nearest
 * request builders look the reference up by the text they were given. No new upload, no new API
 * call, and no change to the orchestrator's signature.
 *
 * WHY A BOUNDED MAP AND NOT ANOTHER LRU CACHE
 * -------------------------------------------
 * The key IS the PDB text. Exact equality on lookup is the entire point (a hash-derived key would
 * have to be verified against the text anyway, so it would only add a second place to get wrong),
 * and a plain insertion-ordered `Map` gives exact keys plus LRU eviction in three lines. The bounds
 * are explicit and small: a handful of structures, never a process-lifetime map, and the same 5 MB
 * per-structure ceiling the server enforces. Nothing else in the client should add a second such
 * map — `resolveStructureRefForPdb` is the single read path.
 *
 * TRUST
 * -----
 * Only the API layer's trusted fetch results (a `structureRef` that arrived in a response header
 * from this server) may be registered. A reference from anywhere else is not a handle this client
 * can vouch for, and the server would reject it anyway.
 */

import { isStructureRef, STRUCTURE_REF_MAX_PDB_CHARS } from "../shared/structureRefs";

/** A reader looks at one structure, occasionally two; six leaves room for a session's flips. */
const MAX_ENTRIES = 6;
/** ~12 MB: two or three full-length models, well under a browser tab's budget. */
const MAX_TOTAL_CHARS = 12 * 1024 * 1024;

const refByPdbText = new Map<string, string>();
let totalChars = 0;

function evictOverflow(): void {
  while (refByPdbText.size > MAX_ENTRIES || totalChars > MAX_TOTAL_CHARS) {
    const oldest = refByPdbText.keys().next();
    if (oldest.done) return;
    const text = oldest.value;
    refByPdbText.delete(text);
    totalChars -= text.length;
  }
}

/**
 * Associates text with the reference the server issued for it.
 *
 * Returns whether the association was stored. It is deliberately not an error when it is not: the
 * text may be too large to be worth retaining, or there may be no reference at all (the legacy
 * string-returning fetchers), and in both cases the caller simply keeps uploading the text.
 */
export function registerStructureRefForPdb(pdbText: unknown, structureRef: unknown): boolean {
  if (typeof pdbText !== "string" || !isStructureRef(structureRef)) return false;
  if (pdbText.length === 0 || pdbText.length > STRUCTURE_REF_MAX_PDB_CHARS) return false;
  if (!pdbText.includes("ATOM") && !pdbText.includes("HETATM")) return false;

  const ref: string = structureRef;
  const existing = refByPdbText.get(pdbText);
  if (existing !== undefined) {
    // Same bytes, same reference: refresh recency rather than storing twice.
    refByPdbText.delete(pdbText);
    totalChars -= pdbText.length;
  }
  refByPdbText.set(pdbText, ref);
  totalChars += pdbText.length;
  evictOverflow();
  return true;
}

/** The reference for this exact text, or `null` when this session never received one for it. */
export function resolveStructureRefForPdb(pdbText: unknown): string | null {
  if (typeof pdbText !== "string" || pdbText.length === 0) return null;
  const ref = refByPdbText.get(pdbText);
  if (ref === undefined) return null;
  if (!isStructureRef(ref)) return null;
  return ref;
}

/** Test/telemetry helper: the current number of retained associations. */
export function getStructureRefRegistrySize(): number {
  return refByPdbText.size;
}

/** Test helper: drop every association (used to model a fresh page session). */
export function clearStructureRefRegistry(): void {
  refByPdbText.clear();
  totalChars = 0;
}
