/**
 * computeProvenance.ts — where a computed result came from, and who else may be given it.
 *
 * Every FoldX and P2Rank result the server stores carries one of these (doc/COMPUTE_ROUTING_PLAN.md
 * WP-E). The shared cache serves a result to a second person only when `mayServe` says so:
 *
 *   - computed on the server        → anyone (the server's results were always shared)
 *   - computed on a person's agent  → its owner always; anyone else only if the result passed the
 *                                     server's validation AND the owner shares results (`share_results`,
 *                                     on by default). An opted-out person's results stay theirs.
 *   - no provenance                 → a result stored before this existed; only the server computed
 *                                     those, so it is treated as the server's.
 *
 * Pure and dependency-free so the client can read the same fields when it shows where a result ran.
 */

export interface ComputeProvenance {
  computedOn: "server" | "agent";
  /** Host class of the machine that ran it (`hostClassOf`), when known. */
  hostClass: string | null;
  /** The tool's version, when the host reported one. */
  toolVersion: string | null;
  /** The person whose job produced it; null for the server's own unowned or background work. */
  ownerId: string | null;
  /** Agent results only: the owner allows others to be served this result. */
  shared?: boolean;
  /** Agent results only: the server's result validation passed (WP-F `validateAgentResult`). */
  validated?: boolean;
}

/** Read the provenance stamped on a stored result, if any. */
export function provenanceOf(result: unknown): ComputeProvenance | null {
  const p = (result as { computeProvenance?: unknown } | null)?.computeProvenance;
  return p && typeof p === "object" && ((p as ComputeProvenance).computedOn === "server" || (p as ComputeProvenance).computedOn === "agent")
    ? (p as ComputeProvenance)
    : null;
}

/** May this result be given to anyone at all, beyond its owner? */
export function mayServeToOthers(p: ComputeProvenance | null): boolean {
  if (!p || p.computedOn === "server") return true;
  return p.validated === true && p.shared === true;
}

/** May `requesterId` (null = no account) be served this stored result? */
export function mayServe(result: unknown, requesterId: string | null | undefined): boolean {
  const p = provenanceOf(result);
  if (mayServeToOthers(p)) return true;
  return Boolean(p?.ownerId && requesterId && p.ownerId === requesterId);
}
