/**
 * alphafoldAvailability.ts — when AlphaFold DB *cannot* have a full-length model, in one place.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * AlphaFold DB models single chains up to 2,700 aa. A longer protein therefore has no full-length
 * predicted model — PKD1 (P98161, 4,302 aa) is one, and asking
 * `GET /api/v1/alphafold-pdb/P98161` for it can only ever answer 404. Three surfaces used to
 * disagree about that absence:
 *
 *   • the pipeline asked for the model first on every visit, logged the 404 as a failed fetch and
 *     reported it to the operator as a degraded network call;
 *   • the structure rail, on the experimental entry that the resolver had actually produced, told
 *     the reader to "switch to a UniProt-numbered model (e.g. AlphaFold)" — a model that does not
 *     exist for this protein;
 *   • the de novo folding notice promised "AlphaFold2 coordinates are the full-length option" for
 *     the same protein.
 *
 * The length rule is public and purely arithmetic, so it is stated once here and read by the server
 * (to explain its 404), the inspector (to stop promising coordinates that cannot exist), and the
 * dev console (to stop recording a provable absence as a degradation).
 *
 * The ceiling is deliberately a *full-length* statement: AlphaFold DB publishes overlapping
 * fragments for some very long proteins, but no single model of the whole chain, which is what this
 * app's viewer and its UniProt numbering assume. Do not restate the number elsewhere.
 */

/**
 * Longest single-chain sequence AlphaFold DB models.
 *
 * From the database's own FAQ: "The minimum length is 16 amino acids, while the maximum is 2,700
 * for proteomes / Swiss-Prot and 1,280 for the rest of UniProt." 2,700 is the bound this app can
 * depend on for a reviewed human entry.
 */
export const ALPHAFOLD_DB_MAX_MODELLED_AA = 2700;

/**
 * Whether a protein of this length can have a full-length AlphaFold DB model.
 *
 * `unknown` is a real state: a protein whose length has not been read yet must not be described
 * either way. `within-limit` means only that the ceiling does not exclude it — the database may
 * still not hold an entry for it.
 */
export type AlphaFoldDbCoverage = "within-limit" | "beyond-limit" | "unknown";

export function alphafoldDbCoverage(residues: number | null | undefined): AlphaFoldDbCoverage {
  if (typeof residues !== "number" || !Number.isFinite(residues) || residues <= 0) return "unknown";
  return residues <= ALPHAFOLD_DB_MAX_MODELLED_AA ? "within-limit" : "beyond-limit";
}

/**
 * Header naming a 404 whose cause is the protein itself, not a failed lookup.
 *
 * The proxy route is asked for models it provably cannot serve; without this marker every client
 * (and every operator reading the dev console) sees the same `warn`/`degraded` entry as a real
 * upstream outage. The header is additive: a reader that ignores it keeps the previous behaviour.
 */
export const ALPHAFOLD_ABSENCE_HEADER = "X-Alphafold-Absence";

/** Why the proxy has no model. Only `beyond-length-limit` is provable from the protein alone. */
export const ALPHAFOLD_ABSENCE_REASONS = ["beyond-length-limit"] as const;
export type AlphaFoldAbsenceReason = (typeof ALPHAFOLD_ABSENCE_REASONS)[number];

export function isAlphaFoldAbsenceReason(value: string | null | undefined): value is AlphaFoldAbsenceReason {
  return typeof value === "string" && (ALPHAFOLD_ABSENCE_REASONS as readonly string[]).includes(value);
}
