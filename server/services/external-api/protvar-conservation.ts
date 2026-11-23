/**
 * Residue conservation from EBI ProtVar, on the canonical UniProt sequence.
 *
 *   GET https://www.ebi.ac.uk/ProtVar/api/score/{accession}/{position}?type=CONSERV
 *   → [{ type: "CONSERV", score: 0.945 }]   or   []   when ProtVar has no score
 *
 * WHAT THE NUMBER IS. ProtVar takes it from VarSite, which aligns each human protein with its
 * UniRef90 homologues and scores every column with ScoreCons (Stephenson et al., Nucleic Acids Res
 * 2024;52:W140; Valdar, Proteins 2002;48:227). The score runs from 0 (variable) to 1 (fully
 * conserved). It does not depend on the substituted residue, and it has no published clinical
 * cut-point, so it is shown as information and never counted in PP3/BP4.
 *
 * NUMBERING. The answer carries no reference residue, so it cannot be checked against the variant.
 * The accession is therefore sent as given: an isoform accession (`P04637-2`) is answered with
 * nothing, never with the canonical residue at the same number. `position` is read as canonical
 * UniProt numbering. The pipeline confirms that numbering when it can; when it cannot, the run
 * continues with a "numbering not verified" warning, after the wild-type residue was matched against
 * the canonical sequence. In that case this score may describe another residue.
 */
import { LRUCache } from "lru-cache";
import { defaultCacheRegistry } from "../infra/cache.ts";
import { fetchWithRetry } from "../infra/http-client.ts";

/** Precomputed per UniProt release, so a month is conservative. Null (no score) is cached too. */
const protvarConservationCache = new LRUCache<string, { score: number | null }>({
  max: 5_000,
  ttl: 30 * 24 * 60 * 60 * 1000,
});
defaultCacheRegistry.registerCache("protvarConservationCache", protvarConservationCache, { ttlDesc: "30d" });

/**
 * The ScoreCons conservation of one residue (0 to 1), or null when ProtVar has none.
 *
 * Throws when ProtVar cannot answer or answers with a value ScoreCons cannot produce: an outage or a
 * malformed reply is not a fact about the residue, so it must not be cached as "no score".
 */
export async function fetchProtVarConservation(
  accession: string,
  position: number,
  signal?: AbortSignal
): Promise<number | null> {
  const acc = accession.trim().toUpperCase();
  const key = `${acc}:${position}`;
  const cached = protvarConservationCache.get(key);
  if (cached) return cached.score;

  const response = await fetchWithRetry(
    `https://www.ebi.ac.uk/ProtVar/api/score/${encodeURIComponent(acc)}/${position}?type=CONSERV`,
    { headers: { Accept: "application/json" }, timeout: 10_000, ...(signal ? { signal } : {}) },
    2
  );
  if (!response.ok) throw new Error(`ProtVar answered HTTP ${response.status}`);

  const rows = (await response.json()) as Array<{ type?: string; score?: unknown }> | null;
  const row = (Array.isArray(rows) ? rows : []).find(r => r?.type === "CONSERV");
  if (!row) {
    protvarConservationCache.set(key, { score: null });
    return null;
  }
  const score = row.score;
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`ProtVar's conservation score ${String(score)} is outside 0 to 1`);
  }
  protvarConservationCache.set(key, { score });
  return score;
}
