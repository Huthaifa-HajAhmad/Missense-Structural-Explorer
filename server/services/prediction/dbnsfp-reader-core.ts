/**
 * dbnsfp-reader-core.ts — the store reads that scale with a gene's size, in ONE implementation.
 *
 * `geneNumbering` (a GROUP BY over every row of a gene) and the landscape window read are the two
 * statements whose cost grows with the gene: measured on the 5.4a store, TTN's GROUP BY takes 5.3 s
 * with a cold page cache and its whole-gene window returns 265,658 rows. `node:sqlite` is
 * synchronous, so on the main thread either one stops every in-flight request for that long.
 *
 * They therefore run in a worker (`server/workers/dbnsfp-reader-worker.ts`) on a built store, and
 * inline on small stores (tests, the dev stub). Both call THESE functions, and so does the ingest
 * that precomputes `gene_numbering`, so the three cannot disagree about which transcript's residue
 * numbers a gene's rows are read in. Keep this module free of side effects and of imports beyond the
 * pure landscape helpers: the worker loads it without the rest of the server.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  normalizeAminoAcid,
  parseAminoAcidChange,
  toFiniteOrNull,
  type SnvCandidate,
  type TranscriptBasis,
} from "./landscape-aggregate.ts";

/**
 * The one transcript whose residue numbers a gene's rows may be read in: MANE Select, else Ensembl
 * canonical, else the gene's only transcript. Two candidates at one level → `null` (serve nothing).
 * `transcript: undefined` marks a store built before per-row bases existed, which keeps the line-level
 * rule because it holds nothing to decide by.
 */
export interface GeneNumbering {
  transcript: string | null | undefined;
  basis: TranscriptBasis;
}

export interface NumberingGroup {
  basis: string | null;
  transcript: string | null;
}

export const NUMBERING_GROUPS_SQL =
  "SELECT transcript_basis AS basis, transcript FROM variant_scores WHERE gene = ? GROUP BY 1, 2";

export function deriveGeneNumbering(groups: ReadonlyArray<NumberingGroup>): GeneNumbering {
  if (!groups.some(g => typeof g.basis === "string")) return { transcript: undefined, basis: "unknown" };
  const at = (basis: string) => new Set(groups.filter(g => g.basis === basis && g.transcript).map(g => g.transcript as string));
  const any = new Set(groups.filter(g => g.basis !== "first-listed" && g.transcript).map(g => g.transcript as string));
  const pick = (set: Set<string>) => (set.size === 1 ? [...set][0] : null);
  const mane = at("mane");
  const canonical = at("ensembl-canonical");
  return mane.size > 0
    ? { transcript: pick(mane), basis: "mane" }
    : canonical.size > 0
      ? { transcript: pick(canonical), basis: "ensembl-canonical" }
      // A lone transcript with no MANE or canonical flag: its numbering is unambiguous but unconfirmed.
      : { transcript: pick(any), basis: "unknown" };
}

/**
 * HOW a gene-sized read reaches the table.
 *
 * Through `idx_gene_pos`, each row is a seek from an index page to a table page in another part of the
 * file, so the kernel never sees a sequential stream and never reads ahead: SQLite issues one 4 KB
 * `pread` at a time. A gene's rows were ingested in genomic order, so they occupy one contiguous rowid
 * range (measured density 0.98–1.00 for the 10-gene panel), and a scan of that range reads table pages
 * in file order. Measured on the 5.4a store with a cold page cache, fresh process per read:
 *
 *                       index order   rowid range
 *   TTN numbering        4.9 s         0.24 s
 *   TTN whole gene       6.5 s         1.8 s   (1.7 s of it is building the row objects, warm or cold)
 *   APOB / DMD / BRCA1   0.65/0.5/0.3  0.05/0.05/0.03 s
 *
 * The range is used only when the gene's rows fill it densely (`RANGE_MIN_DENSITY`), so a gene whose
 * rows were interleaved with another's would not read the other gene too. `+gene` stops the planner
 * from choosing the gene index again. The same rows are returned either way; callers that depend on
 * order re-sort them into index order.
 */
const RANGE_MIN_DENSITY = 0.5;

export interface GeneRowidSpan {
  lo: number;
  hi: number;
  rows: number;
}

/** The gene's rowid range when its rows fill it densely, else null (read through the index). Index-only. */
export function denseRowidSpan(db: DatabaseSync, gene: string): GeneRowidSpan | null {
  try {
    const r = (db.prepare("SELECT MIN(rowid) AS lo, MAX(rowid) AS hi, COUNT(*) AS n FROM variant_scores WHERE gene = ?").get as any)(gene) as
      | { lo: number | null; hi: number | null; n: number }
      | undefined;
    if (!r || r.lo === null || r.hi === null || r.n === 0) return null;
    const span = r.hi - r.lo + 1;
    return r.n / span >= RANGE_MIN_DENSITY ? { lo: r.lo, hi: r.hi, rows: r.n } : null;
  } catch {
    return null;
  }
}

/** The scan itself. A store without the `transcript_basis` column keeps the line-level rule. */
export function computeGeneNumbering(db: DatabaseSync, gene: string): GeneNumbering {
  try {
    const span = denseRowidSpan(db, gene);
    const groups = (span
      ? (db.prepare("SELECT transcript_basis AS basis, transcript FROM variant_scores WHERE rowid BETWEEN ? AND ? AND +gene = ? GROUP BY 1, 2").all as any)(span.lo, span.hi, gene)
      : (db.prepare(NUMBERING_GROUPS_SQL).all as any)(gene)) as NumberingGroup[];
    return deriveGeneNumbering(groups);
  } catch {
    return { transcript: undefined, basis: "unknown" };
  }
}

/**
 * Index order of `idx_variant_scores_gene_pos_ref_alt` (pos, ref, alt; ties by rowid; NULL first,
 * BINARY collation). A rowid-range read is put back into this order, because `aggregateLandscape` keeps
 * the first AlphaMissense value it meets for a substitution: a minus-strand gene's rows arrive in the
 * opposite order by rowid, and the aggregate must not depend on how the rows were fetched.
 */
function byIndexOrder(a: any, b: any): number {
  if (a.pos !== b.pos) return a.pos - b.pos;
  for (const k of ["ref", "alt"] as const) {
    const x = a[k] ?? null, y = b[k] ?? null;
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    return x < y ? -1 : 1;
  }
  return a._rid - b._rid;
}

/** Line-level rule: a `first-listed` row's numbering belongs to an arbitrary isoform and is never served. */
export function isUsableRow(row: { transcript_basis?: string | null } | null | undefined): boolean {
  return !!row && row.transcript_basis !== "first-listed";
}

/** Whether `row` may be read once its gene's numbering is known. */
export function rowFollowsNumbering(
  row: { transcript?: string | null; transcript_basis?: string | null } | null | undefined,
  numbering: GeneNumbering
): boolean {
  if (!isUsableRow(row)) return false;
  if (typeof row!.transcript_basis !== "string") return true;
  if (numbering.transcript === undefined) return true;
  return numbering.transcript !== null && row!.transcript === numbering.transcript;
}

/**
 * The numbering basis of the rows actually returned, for stores that predate per-gene bases: per row
 * when recorded (a lone transcript is no choice, so `single` agrees with either), else the build's
 * store-level label.
 */
export function windowBasisFromRows(
  rows: Array<{ transcript_basis?: string | null }>,
  storePolicy: () => string | null
): TranscriptBasis {
  const bases = new Set(rows.map(r => r.transcript_basis).filter((b): b is string => typeof b === "string"));
  if (bases.size === 0) {
    const policy = storePolicy();
    return policy === "mane" || policy === "ensembl-canonical" ? policy : "unknown";
  }
  bases.delete("single");
  if (bases.size === 0 || (bases.size === 1 && bases.has("mane"))) return "mane";
  if (bases.size === 1 && bases.has("ensembl-canonical")) return "ensembl-canonical";
  return "unknown";
}

/** One stored row as an `aggregateLandscape` candidate: one transcript's reading, keyed by genomic SNV. */
export function landscapeCandidateFromRow(row: any): SnvCandidate {
  const nucleotideKey = row.chr && row.pos_genomic ? `chr${String(row.chr).replace(/^chr/i, "")}:${row.pos_genomic}` : null;
  // The stored residues answer for 5.x stores; `aa_change` is parsed only when one is missing (it was
  // parsed for every row before: 1.3 s of TTN's 265,658-row read, for a value `??` then discarded).
  let parsed: { ref: string | null; alt: string | null } | null = null;
  const fromChange = () => (parsed ??= parseAminoAcidChange(row.aa_change));
  const aaref = normalizeAminoAcid(row.aaref) ?? fromChange().ref;
  const aaalt = normalizeAminoAcid(row.aaalt) ?? fromChange().alt;
  return {
    variantKey: nucleotideKey
      ? `${nucleotideKey}:${row.ref ?? "?"}>${row.alt ?? "?"}`
      : `${row.pos}:${row.ref ?? "?"}>${row.alt ?? "?"}:${aaref ?? "?"}${aaalt ?? "?"}`,
    nucleotideKey,
    aaref,
    aaalt,
    gerp: toFiniteOrNull(row.gerp),
    phylop: toFiniteOrNull(row.phylop),
    readings: [{
      transcript: row.transcript ?? null,
      pos: row.pos,
      revel: toFiniteOrNull(row.revel),
      am: toFiniteOrNull(row.alphamissense),
      isMane: false,
      isCanonical: false
    }]
  };
}

export interface LandscapeRowsResult {
  candidates: SnvCandidate[];
  maxPos: number;
  transcript: string | null;
  transcriptBasis: TranscriptBasis;
  /** The gene's numbering the rows were filtered on, so a caller that did not know it can cache it. */
  numbering: GeneNumbering;
}

/**
 * The columns a landscape candidate reads, instead of `SELECT *`: on TTN's 265,658-row window the
 * full row is ~30 columns per object. A store built before `aaref`/`aaalt`/`transcript` existed does
 * not have them, so the read falls back to `SELECT *`.
 */
const LANDSCAPE_COLUMNS =
  "chr, pos_genomic, pos, ref, alt, aaref, aaalt, aa_change, transcript, transcript_basis, revel, alphamissense, gerp, phylop";

/**
 * Rows for a gene window, filtered to the gene's numbering transcript and shaped for
 * `aggregateLandscape`. `storePolicy` reads `build_meta.transcript_policy` for old stores.
 *
 * `numbering` is normally resolved by the caller (precomputed table, process cache). Pass `null` when it
 * is not known yet: a whole-gene window then derives it from the rows it has just read — the same row
 * set the GROUP BY scans (`pos` is NOT NULL, so MIN..MAX covers every row of the gene) — instead of
 * scanning the gene a second time; a partial window runs {@link computeGeneNumbering}.
 */
export function readLandscapeRows(
  db: DatabaseSync,
  gene: string,
  startPos: number | undefined,
  endPos: number | undefined,
  numberingIn: GeneNumbering | null,
  storePolicy: () => string | null,
  /** "auto" (default) uses the rowid range for whole-gene reads when it is dense; "index" forces the index (tests). */
  strategy: "auto" | "index" = "auto"
): LandscapeRowsResult | null {
  const wholeGene = startPos === undefined || endPos === undefined;
  let sPos = startPos;
  let ePos = endPos;
  let raw: any[] | null = null;
  const span = wholeGene && strategy !== "index" ? denseRowidSpan(db, gene) : null;
  if (span) {
    try {
      raw = (db.prepare(`SELECT rowid AS _rid, ${LANDSCAPE_COLUMNS} FROM variant_scores WHERE rowid BETWEEN ? AND ? AND +gene = ?`).all as any)(span.lo, span.hi, gene);
    } catch {
      raw = (db.prepare("SELECT rowid AS _rid, * FROM variant_scores WHERE rowid BETWEEN ? AND ? AND +gene = ?").all as any)(span.lo, span.hi, gene);
    }
    // `_rid` stays on the intermediate rows: candidates are built from named fields, and deleting a
    // property from 265k objects pushes each into V8's slow dictionary representation.
    raw!.sort(byIndexOrder);
    if (raw!.length === 0) return null;
    sPos = raw![0].pos;
    ePos = raw![raw!.length - 1].pos;
  }
  if (sPos === undefined || ePos === undefined) {
    const boundary = (db.prepare("SELECT MIN(pos) as min_pos, MAX(pos) as max_pos FROM variant_scores WHERE gene = ?").get as any)(gene);
    if (!boundary || boundary.min_pos === null) return null;
    sPos = boundary.min_pos;
    ePos = boundary.max_pos;
  }
  if (!raw) {
    try {
      raw = (db.prepare(`SELECT ${LANDSCAPE_COLUMNS} FROM variant_scores WHERE gene = ? AND pos BETWEEN ? AND ?`).all as any)(gene, sPos, ePos);
    } catch {
      raw = (db.prepare("SELECT * FROM variant_scores WHERE gene = ? AND pos BETWEEN ? AND ?").all as any)(gene, sPos, ePos);
    }
  }
  const fetched = raw!;
  let numbering = numberingIn;
  if (!numbering) {
    if (wholeGene) {
      const pairs = new Map<string, NumberingGroup>();
      for (const r of fetched) {
        const basis = typeof r.transcript_basis === "string" ? r.transcript_basis : null;
        const transcript = r.transcript ?? null;
        pairs.set(`${basis}|${transcript}`, { basis, transcript });
      }
      // A store without the transcript_basis column returns rows without it: the scan's own catch path.
      numbering = fetched.length > 0 && !("transcript_basis" in fetched[0])
        ? { transcript: undefined, basis: "unknown" }
        : deriveGeneNumbering([...pairs.values()]);
    } else {
      numbering = computeGeneNumbering(db, gene);
    }
  }
  const rows = fetched.filter(r => rowFollowsNumbering(r, numbering!));
  if (rows.length === 0) return null;
  const transcripts = new Set(rows.map(r => r.transcript).filter(Boolean));
  return {
    candidates: rows.map(landscapeCandidateFromRow),
    maxPos: ePos as number,
    transcript: transcripts.size === 1 ? ([...transcripts][0] as string) : null,
    transcriptBasis: numbering.transcript === undefined ? windowBasisFromRows(rows, storePolicy) : numbering.basis,
    numbering
  };
}
