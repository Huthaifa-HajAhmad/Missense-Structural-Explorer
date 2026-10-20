import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import * as self from './dbnsfp_local.ts';
import type { AssemblyTaggedCoordinate } from "../../../src/shared/assembly.ts";
import { aggregateLandscape, type AggregateOutput, type SnvCandidate, type TranscriptBasis } from "./landscape-aggregate.ts";
import {
  computeGeneNumbering,
  isUsableRow,
  readLandscapeRows,
  rowFollowsNumbering,
  type GeneNumbering,
} from "./dbnsfp-reader-core.ts";
import { closeDbnsfpReaderPool, getDbnsfpReaderPool } from "./dbnsfp-reader-pool.ts";

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'dbnsfp_v5.sqlite');

/**
 * A store at or below this size is the 0-byte placeholder (or a header-only stub), never a built store.
 * Checking size first also avoids opening a placeholder at all.
 */
const MIN_USABLE_BYTES = 4096;

/**
 * Path of the local store. `DBNSFP_SQLITE_PATH` overrides the default. It is read on every call, not
 * once at import, so a deploy or a test can point the server at another file without a restart.
 */
export function localDbnsfpPath(): string {
  const override = process.env.DBNSFP_SQLITE_PATH?.trim();
  return override ? path.resolve(override) : DEFAULT_DB_PATH;
}

/**
 * Populated by `tools/ingest_dbnsfp.ts`. Schema summary:
 *
 *   Lookup indexes (created by the ingest after all inputs load):
 *     idx_gene_pos                          — gene window scans (landscape) and gene + residue lookups
 *     idx_variant_scores_gene_pos_ref_alt   — gene + residue + allele lookups
 *     idx_chr_pos_genomic_ref_alt           — genomic (VCF-style) lookups
 *
 * CREATE TABLE variant_scores (
 *   id              INTEGER PRIMARY KEY,
 *   gene            TEXT    NOT NULL,
 *   chr             TEXT,            -- hg38 chromosome, e.g. '12'
 *   pos_genomic     INTEGER,         -- hg38 1-based position
 *   pos             INTEGER NOT NULL, -- amino-acid position
 *   ref             TEXT,            -- nucleotide reference allele
 *   alt             TEXT,            -- nucleotide alternate allele
 *   aa_change       TEXT,
 *   revel           REAL,
 *   alphamissense   REAL,
 *   gerp            REAL,
 *   phylop          REAL,
 *   bayesdel        REAL,
 *   metarnn         REAL,
 *   clinpred        REAL,
 *   dann            REAL,
 *   eigen           REAL,
 *   esm1b           REAL,
 *   popeve          REAL,
 *   cadd            REAL,
 *   gnomad_ac       INTEGER,
 *   gnomad_an       INTEGER,
 *   gnomad_hom      INTEGER,
 *   aou_ac          INTEGER,
 *   aou_an          INTEGER,
 *   aou_het         INTEGER,
 *   aou_hom         INTEGER
 * ) STRICT;
 *
 * CREATE INDEX idx_gene_pos                        ON variant_scores(gene, pos);
 * CREATE INDEX idx_variant_scores_gene_pos_ref_alt ON variant_scores(gene, pos, ref, alt);
 * CREATE INDEX idx_chr_pos_genomic_ref_alt         ON variant_scores(chr, pos_genomic, ref, alt);
 */

/**
 * The store's state, cached against its (path, size, mtime). The file is re-probed only when one of
 * those changes, so a freshly ingested or replaced store is picked up without a restart, and a
 * steady-state call costs one stat.
 */
interface StoreProbe {
  path: string;
  present: boolean;
  sizeBytes: number;
  usable: boolean;
  /** Why the store is not usable; absent when it is. */
  reason?: string;
  db: DatabaseSync | null;
  signature: string;
}

let probe: StoreProbe | null = null;

function explicitlyDisabled(): boolean {
  return (process.env.ENABLE_LOCAL_DBNSFP ?? '').trim().toLowerCase() === 'false';
}

function closeProbe(): Promise<void> {
  // The reader worker holds its own read-only connection to the same file; a replaced store must not
  // be read through it, and on Windows the file cannot be deleted until that connection is gone.
  numberingInflight.clear();
  const workerClosed = closeDbnsfpReaderPool();
  try {
    probe?.db?.close();
  } catch {
    // A connection that fails to close is already unusable; dropping the reference is enough.
  }
  probe = null;
  return workerClosed;
}

function buildProbe(dbPath: string, stat: fs.Stats | null, signature: string): StoreProbe {
  const base = { path: dbPath, present: stat !== null, sizeBytes: stat?.size ?? 0, signature };
  if (explicitlyDisabled()) {
    return { ...base, usable: false, db: null, reason: 'disabled by ENABLE_LOCAL_DBNSFP=false' };
  }
  if (!stat) return { ...base, usable: false, db: null, reason: 'database file not found' };
  if (stat.size <= MIN_USABLE_BYTES) {
    return { ...base, usable: false, db: null, reason: `database file is ${stat.size} bytes (placeholder; a built store exceeds ${MIN_USABLE_BYTES})` };
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { open: true });
  } catch (err: any) {
    return { ...base, usable: false, db: null, reason: `cannot open database: ${err.message}` };
  }
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='variant_scores'").get();
    if (!hasTable) {
      db.close();
      return { ...base, usable: false, db: null, reason: 'variant_scores table is missing' };
    }
    // LIMIT 1 stops at the first row, so this stays cheap on a 100M-row table.
    const hasRow = db.prepare('SELECT 1 FROM variant_scores LIMIT 1').get();
    if (!hasRow) {
      db.close();
      return { ...base, usable: false, db: null, reason: 'variant_scores is empty (run tools/ingest_dbnsfp.ts)' };
    }
    return { ...base, usable: true, db, reason: undefined };
  } catch (err: any) {
    try { db.close(); } catch { /* already unusable */ }
    return { ...base, usable: false, db: null, reason: `store is not readable: ${err.message}` };
  }
}

function currentProbe(): StoreProbe {
  const dbPath = localDbnsfpPath();
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(dbPath);
  } catch {
    stat = null;
  }
  // The env flag is part of the key: flipping ENABLE_LOCAL_DBNSFP must take effect without touching the file.
  const signature = `${stat ? `${stat.size}:${stat.mtimeMs}` : 'absent'}|off=${explicitlyDisabled()}`;
  if (probe && probe.path === dbPath && probe.signature === signature) return probe;
  closeProbe();
  probe = buildProbe(dbPath, stat, signature);
  return probe;
}

/**
 * Release the cached connections (this thread's and the reader worker's). Needed before the store file
 * can be deleted or replaced on Windows, and harmless otherwise: the next call re-probes. The returned
 * promise settles when the worker's connection is closed too; await it before deleting the file.
 */
export function closeLocalDbnsfpStore(): Promise<void> {
  return closeProbe();
}

/**
 * Whether the local store serves queries. Unset or `true` auto-detects: the store must exist, be
 * larger than the placeholder, and hold at least one variant row. `ENABLE_LOCAL_DBNSFP=false` turns it off.
 */
export function isLocalDbnsfpAvailable(): boolean {
  return currentProbe().usable;
}

export function getDbInstance(): DatabaseSync | null {
  const p = currentProbe();
  return p.usable ? p.db : null;
}

/** Whether the store has the `pos_genomic` column. Cached per connection, so a replaced store is re-read. */
const genomicColumnsByDb = new WeakMap<DatabaseSync, boolean>();

/**
 * Whether a stored row's residue numbers may be used (`isUsableRow`, `rowFollowsNumbering` in
 * dbnsfp-reader-core.ts): a `first-listed` row is never served, and on stores that record bases a row is
 * read only when its TRANSCRIPT is the gene's numbering transcript (MANE Select, else Ensembl canonical,
 * else the gene's only transcript).
 *
 * `transcript_basis` is a per-LINE label, and dbNSFP writes a separate line for each transcript that
 * translates an SNV differently. A line listing only an alternative isoform is therefore stored as
 * `single` although its numbering is not MANE's: measured on the 5.4a store, 60% of a random sample of
 * `single` rows (36 of 60) sit on a non-MANE transcript of a gene that has one, and 520 of BRAF's 567
 * such rows name a different wild-type residue than MANE at the same number (ENST00000469930
 * p.Ser170Arg where MANE residue 170 is Pro).
 *
 * WHERE the numbering comes from, cheapest first:
 *   1. this process's cache;
 *   2. the store's precomputed `gene_numbering` table (written by tools/ingest_dbnsfp.ts; one indexed row);
 *   3. the gene-wide GROUP BY — in the reader worker on a built store, inline on a small one. Measured
 *      on the 5.4a store with a cold page cache: TTN 5.3 s, APOB/DMD 0.6 s, BRCA1 0.3 s. Inline, that is
 *      the whole HTTP event loop stopped (it ran inside translate-variant and stalled every request).
 * The synchronous readers below only ever consult 1–2; the async entry points resolve 3 first.
 */
const numberingByDb = new WeakMap<DatabaseSync, Map<string, GeneNumbering>>();
const numberingTableByDb = new WeakMap<DatabaseSync, boolean>();
const numberingInflight = new Map<string, Promise<GeneNumbering>>();

/** Stores at or above this size read gene-sized results in the worker. Tests lower it to exercise the worker path. */
function workerMinBytes(): number {
  const raw = Number(process.env.DBNSFP_WORKER_MIN_BYTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : 64 * 1024 * 1024;
}

function readsInWorker(db: DatabaseSync): boolean {
  return Boolean(probe?.usable && probe.db === db && probe.sizeBytes >= workerMinBytes());
}

/**
 * Windows up to this many residues are read inline: ±100 residues of TTN is ~1,300 rows (≈ 12 ms cold),
 * less than the worker hop costs. Whole-gene windows and wider ones go to the worker.
 */
function smallWindow(startPos: number | undefined, endPos: number | undefined): boolean {
  const raw = Number(process.env.DBNSFP_WORKER_WINDOW_RESIDUES);
  const limit = Number.isFinite(raw) && raw >= 0 ? raw : 1000;
  return startPos !== undefined && endPos !== undefined && endPos - startPos + 1 <= limit;
}

function numberingCache(db: DatabaseSync): Map<string, GeneNumbering> {
  let byGene = numberingByDb.get(db);
  if (!byGene) {
    byGene = new Map();
    numberingByDb.set(db, byGene);
  }
  return byGene;
}

/** The precomputed row, or null when the store has no `gene_numbering` table or no row for the gene. */
function numberingFromTable(db: DatabaseSync, key: string): GeneNumbering | null {
  let present = numberingTableByDb.get(db);
  if (present === undefined) {
    try {
      present = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gene_numbering'").get());
    } catch {
      present = false;
    }
    numberingTableByDb.set(db, present);
  }
  if (!present) return null;
  try {
    const row = db.prepare("SELECT transcript, basis FROM gene_numbering WHERE gene = ?").get(key) as
      | { transcript: string | null; basis: string }
      | undefined;
    // An absent gene is not "no numbering": the ingest skips genes whose rows carry no basis, which the
    // scan reads as the line-level rule. Let the scan decide.
    return row ? { transcript: row.transcript ?? null, basis: row.basis as TranscriptBasis } : null;
  } catch {
    return null;
  }
}

function cachedNumbering(db: DatabaseSync, key: string): GeneNumbering | null {
  const byGene = numberingCache(db);
  const hit = byGene.get(key);
  if (hit) return hit;
  const fromTable = numberingFromTable(db, key);
  if (fromTable) byGene.set(key, fromTable);
  return fromTable;
}

/** Synchronous: used by row filters once {@link resolveGeneNumbering} has run (so normally a cache hit). */
function geneNumbering(db: DatabaseSync, gene: string): GeneNumbering {
  const key = gene.trim().toUpperCase();
  const hit = cachedNumbering(db, key);
  if (hit) return hit;
  const result = computeGeneNumbering(db, key);
  numberingCache(db).set(key, result);
  return result;
}

let warnedWorkerFailure = false;

/**
 * Resolves a gene's numbering WITHOUT blocking the event loop on a built store: the scan runs in the
 * reader worker, and concurrent requests for one gene share one scan. If the worker cannot run, the
 * scan runs inline — slower for the loop, identical in result.
 */
async function resolveGeneNumbering(db: DatabaseSync, gene: string): Promise<GeneNumbering> {
  const key = gene.trim().toUpperCase();
  const hit = cachedNumbering(db, key);
  if (hit) return hit;
  if (!readsInWorker(db) || !probe) return geneNumbering(db, key);
  const flightKey = `${probe.signature}|${key}`;
  const inflight = numberingInflight.get(flightKey);
  if (inflight) return inflight;
  const { path: dbPath, signature } = probe;
  const job = (async () => {
    try {
      const result = (await getDbnsfpReaderPool().run({ dbPath, signature, gene: key }, { name: "workerGeneNumbering" })) as GeneNumbering;
      numberingCache(db).set(key, result);
      return result;
    } catch (err: any) {
      if (!warnedWorkerFailure) {
        warnedWorkerFailure = true;
        console.warn(`[Local dbNSFP] reader worker failed (${err?.message ?? err}); reading inline on the event loop.`);
      }
      return geneNumbering(db, key);
    } finally {
      numberingInflight.delete(flightKey);
    }
  })();
  numberingInflight.set(flightKey, job);
  return job;
}

/** Resolves the numbering of every gene named by `rows` before a synchronous filter reads them. */
async function resolveRowGenes(db: DatabaseSync, rows: Array<{ gene?: string | null; transcript_basis?: string | null }>): Promise<void> {
  const genes = new Set(rows.filter(r => typeof r?.transcript_basis === "string" && r.gene).map(r => String(r.gene).trim().toUpperCase()));
  for (const g of genes) await resolveGeneNumbering(db, g);
}

/** Whether `row` may be read: line-level rule, then (on stores that record bases) the gene's numbering transcript. */
function isNumberedRow(db: DatabaseSync, row: { gene?: string | null; transcript?: string | null; transcript_basis?: string | null } | null | undefined): boolean {
  if (!isUsableRow(row)) return false;
  if (typeof row!.transcript_basis !== "string" || !row!.gene) return true;
  return rowFollowsNumbering(row, geneNumbering(db, row!.gene));
}

export interface LocalDbnsfpRecord {
  gene: string;
  /** hg38 chromosome, e.g. "12" (null until dbNSFP ingest populates it) */
  chr: string | null;
  /** hg38 1-based genomic position (null until dbNSFP ingest populates it) */
  pos_genomic: number | null;
  pos: number;
  ref: string | null;
  alt: string | null;
  aa_change: string | null;
  revel: number | null;
  alphamissense: number | null;
  gerp: number | null;
  phylop: number | null;
  bayesdel: number | null;
  metarnn: number | null;
  clinpred: number | null;
  dann: number | null;
  eigen: number | null;
  esm1b: number | null;
  popeve: number | null;
  cadd: number | null;
  gnomad_ac: number | null;
  gnomad_an: number | null;
  gnomad_hom: number | null;
  aou_ac: number | null;
  aou_an: number | null;
  aou_het: number | null;
  aou_hom: number | null;
}

function matchAminoAcidChange(variantStr: string, dbAaChange: string | null): boolean {
  if (!dbAaChange) return false;
  const norm1 = variantStr.replace(/^p\./i, '').toUpperCase();
  const norm2 = dbAaChange.replace(/^p\./i, '').toUpperCase();
  if (norm1 === norm2) return true;

  const parse = (s: string) => {
    const m = s.match(/([A-Z]{1,3})[=:/]?(\d+)[=:/]?([A-Z]{1,3})/i);
    if (!m) return null;
    return {
      ref: m[1],
      pos: parseInt(m[2], 10),
      alt: m[3]
    };
  };

  const p1 = parse(norm1);
  const p2 = parse(norm2);
  if (!p1 || !p2) return false;

  if (p1.pos !== p2.pos) return false;

  const toSingle = (aa: string) => {
    if (aa.length === 1) return aa;
    const map: Record<string, string> = {
      ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
      GLU: 'E', GLN: 'Q', GLY: 'G', HIS: 'H', ILE: 'I',
      LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
      SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V'
    };
    return map[aa] || aa;
  };

  return toSingle(p1.ref) === toSingle(p2.ref) && toSingle(p1.alt) === toSingle(p2.alt);
}

/**
 * Fetch scores and population counts for a single variant
 */
export async function queryLocalDbnsfpVariant(
  gene: string,
  pos: number,
  ref?: string | null,
  alt?: string | null,
  aaChange?: string | null,
  coordinate?: AssemblyTaggedCoordinate | null
): Promise<LocalDbnsfpRecord | null> {
  await new Promise<void>(resolve => setImmediate(resolve));
  const db = self.getDbInstance();
  if (!db) return null;

  try {
    let stmt;
    let rows: any[] = [];
    if (ref && alt) {
      stmt = db.prepare(`
        SELECT * FROM variant_scores
        WHERE gene = ? AND pos = ? AND ref = ? AND alt = ?
      `);
      rows = (stmt.all as any)(gene.trim().toUpperCase(), pos, ref.trim().toUpperCase(), alt.trim().toUpperCase());
    } else {
      stmt = db.prepare(`
        SELECT * FROM variant_scores
        WHERE gene = ? AND pos = ?
      `);
      rows = (stmt.all as any)(gene.trim().toUpperCase(), pos);
    }
    await resolveRowGenes(db, rows);
    rows = rows.filter(r => isNumberedRow(db, r));
    // A requested substitution that is absent must not inherit the first row's allele.
    if (aaChange) rows = rows.filter(r => matchAminoAcidChange(aaChange, r.aa_change));
    if (coordinate) {
      if (coordinate.assembly !== "GRCh38") return null;
      const chrom = coordinate.chrom.replace(/^chr/i, "").toUpperCase();
      rows = rows.filter(r => String(r.chr ?? "").replace(/^chr/i, "").toUpperCase() === chrom &&
        r.pos_genomic === coordinate.pos && String(r.ref ?? "").toUpperCase() === coordinate.ref.toUpperCase() &&
        String(r.alt ?? "").toUpperCase() === coordinate.alt.toUpperCase());
    }
    // Duplicate transcript rows at one known allele are harmless; distinct alleles (including
    // same-position/different ALT) and multiple rows lacking allele provenance are not unique.
    const identities = new Set(rows.map(r => r.chr && r.pos_genomic && r.ref && r.alt
      ? `${String(r.chr).replace(/^chr/i, "").toUpperCase()}:${r.pos_genomic}:${String(r.ref).toUpperCase()}>${String(r.alt).toUpperCase()}`
      : null));
    if (rows.length === 1 || (rows.length > 1 && identities.size === 1 && !identities.has(null))) {
      return rows[0] as LocalDbnsfpRecord;
    }
  } catch (err: any) {
    console.warn(`[Local dbNSFP Error] single variant lookup failed:`, err.message);
  }
  return null;
}

/**
 * The local build's provenance, written by `tools/ingest_dbnsfp.ts` into a `build_meta` table
 * (`dbnsfp_version`, `transcript_policy`). Builds made before that table existed report null.
 */
function readBuildMeta(key: string): string | null {
  const db = self.getDbInstance();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT value FROM build_meta WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function readLocalDbnsfpVersion(): string | null {
  const v = readBuildMeta("dbnsfp_version");
  return v ? `dbNSFP ${v} (local)` : null;
}

/** The dbNSFP release the store was built from, e.g. "5.3a", for callers labelling provenance. Null when unknown. */
export function getLocalDbnsfpVersion(): string | null {
  return readBuildMeta("dbnsfp_version");
}

export interface LocalDbnsfpInspection {
  path: string;
  present: boolean;
  sizeBytes: number;
  /** False only when ENABLE_LOCAL_DBNSFP=false. */
  enabled: boolean;
  /** True when queries are served from the store. */
  usable: boolean;
  /** Why the store is not usable. Absent when it is. */
  reason?: string;
  version?: string | null;
  /** Sum of the per-chromosome counts the ingest recorded. Null when none were recorded. */
  rowCount?: number | null;
}

/**
 * Diagnostics for the local store, for health and admin views. Reads only the file's stat, the
 * probe cache and the `build_meta` table. It never counts `variant_scores`, which can hold 100M rows.
 */
/**
 * {@link inspectLocalDbnsfpFile} for UNAUTHENTICATED endpoints (`/diagnostics`, `/capabilities`): the
 * file name only, so the host's directory layout is not published. Operators set the path themselves
 * (`DBNSFP_SQLITE_PATH`), so the name is all a reader needs to tell which store answered.
 */
export function inspectLocalDbnsfpFileForPublic(): LocalDbnsfpInspection {
  const inspection = inspectLocalDbnsfpFile();
  return { ...inspection, path: path.basename(inspection.path) };
}

export function inspectLocalDbnsfpFile(): LocalDbnsfpInspection {
  const p = currentProbe();
  const enabled = !explicitlyDisabled();
  const base = { path: p.path, present: p.present, sizeBytes: p.sizeBytes, enabled, usable: p.usable };
  if (!p.usable) {
    return { ...base, reason: p.reason, version: null, rowCount: null };
  }
  // Per-chromosome counts are written by the ingest; summing them avoids a COUNT(*) scan.
  let rowCount: number | null = null;
  const db = self.getDbInstance();
  if (db) {
    try {
      const rows = db.prepare("SELECT value FROM build_meta WHERE key LIKE 'rows:%'").all() as Array<{ value: string }>;
      if (rows.length > 0) rowCount = rows.reduce((sum, r) => sum + Number(r.value), 0);
    } catch {
      rowCount = null;
    }
  }
  return { ...base, version: getLocalDbnsfpVersion(), rowCount };
}

export interface LocalLandscapeRows {
  candidates: SnvCandidate[];
  maxPos: number;
  transcript: string | null;
  transcriptBasis: TranscriptBasis;
  /** The gene's numbering the rows were filtered on. */
  numbering: GeneNumbering;
  /**
   * Present when the caller passed `aggregate`: `aggregateLandscape` over the same candidates with the
   * same options, computed beside the read (in the worker on a built store). `candidates` is then empty.
   */
  aggregated?: AggregateOutput;
}

/**
 * Raw SNV rows for a gene window, shaped for `aggregateLandscape`. Each row already carries ONE
 * transcript's residue number and scores (the ingest picks the MANE / canonical transcript), so
 * every candidate has a single reading. Rows are keyed by genomic SNV where the build stores the
 * coordinate, so a duplicated row is counted once.
 *
 * A whole-gene window is gene-sized: TTN's is 265,658 rows (≈ 4.4 s to read cold, then ≈ 2.2 s of
 * filtering and aggregation in JavaScript, measured inside /analyze-variant/landscape-overview). On a
 * built store the read AND, with `aggregate`, the aggregation therefore run in the reader worker, and
 * only the per-residue result crosses back. The inline path runs the same functions.
 */
export async function queryLocalDbnsfpLandscapeRows(
  gene: string,
  startPos?: number,
  endPos?: number,
  options?: { aggregate?: { start: number; end?: number; sequence: string | null } }
): Promise<LocalLandscapeRows | null> {
  await new Promise<void>(resolve => setImmediate(resolve));
  const db = self.getDbInstance();
  if (!db) return null;

  const g = gene.trim().toUpperCase();
  try {
    const wholeGene = startPos === undefined || endPos === undefined;
    if (readsInWorker(db) && probe && !smallWindow(startPos, endPos)) {
      // A whole-gene window derives the numbering from the rows it reads, so it does not wait for (or
      // repeat) a separate gene scan; a partial window resolves it first.
      const known = cachedNumbering(db, g) ?? (wholeGene ? null : await resolveGeneNumbering(db, g));
      try {
        const res = (await getDbnsfpReaderPool().run(
          { dbPath: probe.path, signature: probe.signature, gene: g, startPos, endPos, numbering: known, aggregate: options?.aggregate },
          { name: "workerLandscape" }
        )) as LocalLandscapeRows | null;
        if (res?.numbering && !known) numberingCache(db).set(g, res.numbering);
        return res;
      } catch (err: any) {
        if (!warnedWorkerFailure) {
          warnedWorkerFailure = true;
          console.warn(`[Local dbNSFP] reader worker failed (${err?.message ?? err}); reading inline on the event loop.`);
        }
      }
    }
    const res = readLandscapeRows(db, g, startPos, endPos, await resolveGeneNumbering(db, g), () => readBuildMeta("transcript_policy"));
    if (!res || !options?.aggregate) return res;
    const aggregated = aggregateLandscape(res.candidates, {
      start: options.aggregate.start,
      end: options.aggregate.end ?? res.maxPos,
      sequence: options.aggregate.sequence,
      choice: { transcript: res.transcript, basis: res.transcriptBasis },
    });
    return { ...res, candidates: [], aggregated };
  } catch (err: any) {
    console.warn(`[Local dbNSFP Error] landscape query failed:`, err.message);
  }
  return null;
}

/**
 * A coordinate's local reading together with the numbering basis of its gene ({@link geneNumbering}),
 * so a caller can accept only MANE-numbered answers. Null when the store has no single reading.
 */
export async function queryLocalDbnsfpCoordinateReading(
  chr: string,
  posGenomic: number,
  ref: string,
  alt: string,
  gene?: string | null
): Promise<{ record: LocalDbnsfpRecord; basis: TranscriptBasis } | null> {
  const record = await queryLocalDbnsfpByGenomic(chr, posGenomic, ref, alt, gene);
  const db = self.getDbInstance();
  if (!record || !db) return null;
  return { record, basis: geneNumbering(db, record.gene).basis };
}

/**
 * Look up a variant by genomic coordinates (Part4 #2 architectural fix).
 *
 * This is the new lookup path that uses the idx_dbnsfp_genomic index on
 * (chr, pos_genomic, ref, alt), enabling VCF-style and gnomAD-style queries
 * without a round-trip to the Ensembl VEP API.
 *
 * @param chr         - hg38 chromosome, e.g. "12" or "chr12" (prefix normalised internally)
 * @param posGenomic  - hg38 1-based position
 * @param ref         - reference allele (uppercase)
 * @param alt         - alternate allele (uppercase)
 * @returns The best-matching record, or null when unavailable / not found.
 *
 * NOTE: Returns null (not an error) when:
 *   - The local database is not usable (disabled, missing, a placeholder, or empty; see inspectLocalDbnsfpFile)
 *   - The chr/pos_genomic columns are not yet populated (awaiting ingest)
 *   - The specific variant is absent from dbNSFP v5
 */
export async function queryLocalDbnsfpByGenomic(
  chr: string,
  posGenomic: number,
  ref: string,
  alt: string,
  gene?: string | null
): Promise<LocalDbnsfpRecord | null> {
  await new Promise<void>(resolve => setImmediate(resolve));
  const db = self.getDbInstance();
  if (!db) return null;

  // Normalise chromosome: strip "chr" prefix so both "chr12" and "12" work
  const normChr = chr.replace(/^chr/i, '');

  try {
    // Check that the genomic columns exist (they are absent in pre-migration DBs)
    let hasGenomicColumns = genomicColumnsByDb.get(db);
    if (hasGenomicColumns === undefined) {
      const cols = (db.prepare("PRAGMA table_info(variant_scores)").all as any)() as Array<{ name: string }>;
      hasGenomicColumns = cols.some(c => c.name === 'pos_genomic');
      genomicColumnsByDb.set(db, hasGenomicColumns);
    }
    if (!hasGenomicColumns) {
      // Database exists but was built without genomic columns — can't serve this query.
      // Callers should fall back to the Ensembl VEP translation path.
      return null;
    }

    // Every row at the locus: one SNV can be stored once per transcript that translates it differently
    // (and once per overlapping gene), so the first row is not necessarily the correctly numbered one.
    const stmt = db.prepare(`
      SELECT * FROM variant_scores
      WHERE chr = ? AND pos_genomic = ? AND ref = ? AND alt = ?
    `);
    const wantGene = gene?.trim().toUpperCase() || null;
    const locus = ((stmt.all as any)(
      normChr,
      posGenomic,
      ref.trim().toUpperCase(),
      alt.trim().toUpperCase()
    ) as Array<LocalDbnsfpRecord & { transcript?: string | null; transcript_basis?: string | null }>)
      .filter(r => !wantGene || String(r.gene ?? "").toUpperCase() === wantGene);
    await resolveRowGenes(db, locus);
    const rows = locus.filter(r => isNumberedRow(db, r));

    // Two genes (or two readings) still standing is an ambiguity the caller cannot see from one record.
    const readings = new Set(rows.map(r => `${String(r.gene).toUpperCase()}|${r.pos}|${r.aa_change}`));
    return readings.size === 1 ? rows[0] : null;
  } catch (err: any) {
    console.warn(`[Local dbNSFP Error] genomic lookup failed:`, err.message);
    return null;
  }
}
