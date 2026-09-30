/**
 * raspIndex.ts — the completeness contract for the precomputed RaSP lookup index.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * The index that shipped with this repository was truncated: 35,000 of the CSV's 8,770,220 rows,
 * i.e. the first 6 proteins in file order out of 1,345, cut on an exact 5,000-row batch boundary.
 *
 * The loader accepted it because it only asked "is this file bigger than 1 KB and does it contain
 * at least one row?" — a question a truncated file answers identically to a complete one. The
 * consequence was invisible: RaSP reported "no precomputed profile for this protein" for 1,339
 * proteins that the bundled data actually covers, which silently removed a consensus engine
 * (weight 1.5) from every one of those runs. Nothing failed. Nothing logged.
 *
 * So "complete" is now a *checked* property rather than an assumption, and it is defined here —
 * in shared code — because three parties have to agree on it:
 *
 *   • `scripts/build-rasp-sqlite.ts` records the counts into the index (`rasp_index_meta`),
 *   • `server/services/stability/energy-models.ts` refuses an index that fails the check,
 *   • `server/routes/capabilities.ts` reports the real coverage to the diagnostics screen.
 *
 * The check itself is a pure function so it can be unit-tested without a database.
 */

/**
 * Version of the index layout and its completeness contract.
 *
 * Bump when the layout changes. An index built by a different version is rejected rather than
 * silently reinterpreted — a schema drift is exactly the kind of change that would otherwise
 * produce plausible-looking wrong answers.
 */
export const RASP_INDEX_SCHEMA_VERSION = 3;

/**
 * Layouts this build can READ. v2 is the experimental-structure-only index (no `source` column); v3
 * adds a `source` per row so the proteome-wide AlphaFold predictions can sit beside it. Accepting v2
 * is what keeps an upgrade from switching RaSP off in a deployment that has not rebuilt its index.
 */
export const RASP_INDEX_READABLE_VERSIONS: readonly number[] = [2, 3];

/**
 * Where a RaSP row came from (Blaabjerg 2023; github.com/KULL-Centre/_2022_ML-ddG-Blaabjerg):
 *   experimental — `df_rasp_gnomad_clinvar.csv` (Zenodo 10.5281/zenodo.6835877), ~1,345 proteins with
 *                  experimental structures; the authors note some residue numbering was shifted to the
 *                  structure's.
 *   alphafold    — the per-protein PRISM files for the AlphaFold human proteome (UP000005640 v2,
 *                  23,391 proteins), numbered along the full-length model, i.e. UniProt numbering.
 */
export type RaspSource = "experimental" | "alphafold";

export const RASP_SOURCE_LABEL: Record<RaspSource, string> = {
  experimental: "Experimental-structure set",
  alphafold: "AlphaFold proteome (UP000005640 v2)",
};

/** Per-source protein counts an index records, when it records them (v3). */
export type RaspSourceCounts = Partial<Record<RaspSource, number>>;

/** What a deployment's index covers — carried to the client so "not covered" can say how much is. */
export interface RaspCoverage {
  proteins: number;
  sources: RaspSourceCounts;
}

/** What the index says about itself. */
export interface RaspIndexMeta {
  schemaVersion: number;
  rows: number;
  proteins: number;
  builtAt: string | null;
  /** Proteins per source (v3 only; a v2 index is experimental-only by definition). */
  sources?: RaspSourceCounts | null;
}

/** The verdict on one index, plus the numbers behind it. */
export interface RaspIndexVerdict {
  /** True only when the index is present, self-consistent and at the expected schema version. */
  usable: boolean;
  rows: number;
  proteins: number;
  meta: RaspIndexMeta | null;
  /** Plain-language reason an index is unusable. Present only when `usable` is false. */
  reason?: string;
  /**
   * True when `rows`/`proteins` were **counted** from the table, false when they were taken from the
   * index's own record.
   *
   * Counting 8.3 M rows is far too expensive for a request path, so the loader counts (once, at
   * load) and the diagnostics route reports the record. This flag exists so a surface can never
   * present a recorded number as a checked one.
   */
  verified?: boolean;
}

/**
 * Compares what an index claims with what it actually contains.
 *
 * @param actual counts read from the index itself
 * @param meta   the row from `rasp_index_meta`, or null when the table/row is absent
 */
export function verifyRaspIndex(
  actual: { rows: number; proteins: number },
  meta: RaspIndexMeta | null
): RaspIndexVerdict {
  const base = { rows: actual.rows, proteins: actual.proteins, meta };

  if (actual.rows === 0 || actual.proteins === 0) {
    return { ...base, usable: false, reason: "the index contains no rows" };
  }

  if (!meta) {
    return {
      ...base,
      usable: false,
      reason:
        "the index carries no completeness record, so a truncated index would be indistinguishable from a complete one"
    };
  }

  if (!RASP_INDEX_READABLE_VERSIONS.includes(meta.schemaVersion)) {
    return {
      ...base,
      usable: false,
      reason: `the index was built with schema v${meta.schemaVersion} but this build reads v${RASP_INDEX_READABLE_VERSIONS.join(" or v")}`
    };
  }

  if (meta.rows !== actual.rows || meta.proteins !== actual.proteins) {
    return {
      ...base,
      usable: false,
      reason:
        `the index disagrees with its own record (recorded ${meta.rows} rows / ${meta.proteins} proteins, ` +
        `found ${actual.rows} / ${actual.proteins}) — it is truncated or corrupted`
    };
  }

  return { ...base, usable: true, verified: true };
}
