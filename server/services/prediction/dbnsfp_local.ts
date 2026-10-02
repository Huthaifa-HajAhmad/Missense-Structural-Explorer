import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import * as self from './dbnsfp_local.ts';
import type { AssemblyTaggedCoordinate } from "../../../src/shared/assembly.ts";
import {
  normalizeAminoAcid,
  parseAminoAcidChange,
  toFiniteOrNull,
  type SnvCandidate,
  type TranscriptBasis
} from "./landscape-aggregate.ts";

const DB_PATH = path.join(process.cwd(), 'data', 'dbnsfp_v5.sqlite');

/**
 * Intended SQLite schema for the local dbNSFP database.
 * The database is populated by a future ingestion script that reads dbNSFP v5.
 *
 * Part4 #2 architectural fix: two indexes are required —
 *   idx_dbnsfp_gene_aa   — existing path: look up by gene + amino-acid position
 *   idx_dbnsfp_genomic   — NEW: look up by chromosome:position:ref:alt (VCF/GnomAD-style)
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
 * CREATE INDEX idx_dbnsfp_gene_aa  ON variant_scores(gene, pos);
 * CREATE INDEX idx_dbnsfp_genomic  ON variant_scores(chr, pos_genomic, ref, alt);
 */

let localDb: DatabaseSync | null = null;
let dbCheckFailed = false;
let hasGenomicColumnsChecked: boolean | null = null;

export function isLocalDbnsfpAvailable(): boolean {
  if (process.env.ENABLE_LOCAL_DBNSFP !== 'true') return false;
  if (!fs.existsSync(DB_PATH)) return false;
  try {
    const stat = fs.statSync(DB_PATH);
    return stat.size > 1024;
  } catch {
    return false;
  }
}

export function getDbInstance(): DatabaseSync | null {
  if (!isLocalDbnsfpAvailable() || dbCheckFailed) return null;
  if (!localDb) {
    try {
      const db = new DatabaseSync(DB_PATH, { open: true });
      const stmt = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='variant_scores'");
      const row = stmt.get() as { count: number } | undefined;
      if (!row || row.count === 0) {
        console.warn("[Local dbNSFP] Table variant_scores does not exist in SQLite DB. Disabling local mode.");
        dbCheckFailed = true;
        return null;
      }
      const countStmt = db.prepare("SELECT COUNT(*) as cnt FROM variant_scores LIMIT 1");
      const countRow = countStmt.get() as { cnt: number } | undefined;
      if (!countRow || countRow.cnt === 0) {
        console.warn("[Local dbNSFP] Local database is empty (0 records). Disabling local mode.");
        dbCheckFailed = true;
        return null;
      }
      localDb = db;
    } catch (err: any) {
      console.warn(`[Local dbNSFP] Failed to initialize SQLite database connection: ${err.message}`);
      dbCheckFailed = true;
      localDb = null;
    }
  }
  return localDb;
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

export interface LocalLandscapeRows {
  candidates: SnvCandidate[];
  maxPos: number;
  transcript: string | null;
  transcriptBasis: TranscriptBasis;
}

/**
 * Raw SNV rows for a gene window, shaped for `aggregateLandscape`. Each row already carries ONE
 * transcript's residue number and scores (the ingest picks the MANE / canonical transcript), so
 * every candidate has a single reading. Rows are keyed by genomic SNV where the build stores the
 * coordinate, so a duplicated row is counted once.
 */
export async function queryLocalDbnsfpLandscapeRows(
  gene: string,
  startPos?: number,
  endPos?: number
): Promise<LocalLandscapeRows | null> {
  await new Promise<void>(resolve => setImmediate(resolve));
  const db = self.getDbInstance();
  if (!db) return null;

  const g = gene.trim().toUpperCase();
  try {
    let sPos = startPos;
    let ePos = endPos;
    if (sPos === undefined || ePos === undefined) {
      const boundary = (db.prepare("SELECT MIN(pos) as min_pos, MAX(pos) as max_pos FROM variant_scores WHERE gene = ?").get as any)(g);
      if (!boundary || boundary.min_pos === null) return null;
      sPos = boundary.min_pos;
      ePos = boundary.max_pos;
    }
    const rows = (db.prepare("SELECT * FROM variant_scores WHERE gene = ? AND pos BETWEEN ? AND ?").all as any)(g, sPos, ePos) as any[];
    if (rows.length === 0) return null;

    const candidates: SnvCandidate[] = rows.map((row) => {
      const parsed = parseAminoAcidChange(row.aa_change);
      const nucleotideKey = row.chr && row.pos_genomic ? `chr${String(row.chr).replace(/^chr/i, "")}:${row.pos_genomic}` : null;
      const aaref = normalizeAminoAcid(row.aaref) ?? parsed.ref;
      const aaalt = normalizeAminoAcid(row.aaalt) ?? parsed.alt;
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
    });

    const policy = readBuildMeta("transcript_policy");
    const transcripts = new Set(rows.map((r) => r.transcript).filter(Boolean));
    return {
      candidates,
      maxPos: ePos as number,
      transcript: transcripts.size === 1 ? ([...transcripts][0] as string) : null,
      transcriptBasis: policy === "mane" || policy === "ensembl-canonical" ? policy : "unknown"
    };
  } catch (err: any) {
    console.warn(`[Local dbNSFP Error] landscape query failed:`, err.message);
  }
  return null;
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
 *   - The local database has not yet been built (ENABLE_LOCAL_DBNSFP != 'true')
 *   - The chr/pos_genomic columns are not yet populated (awaiting ingest)
 *   - The specific variant is absent from dbNSFP v5
 */
export async function queryLocalDbnsfpByGenomic(
  chr: string,
  posGenomic: number,
  ref: string,
  alt: string
): Promise<LocalDbnsfpRecord | null> {
  await new Promise<void>(resolve => setImmediate(resolve));
  const db = self.getDbInstance();
  if (!db) return null;

  // Normalise chromosome: strip "chr" prefix so both "chr12" and "12" work
  const normChr = chr.replace(/^chr/i, '');

  try {
    // Check that the genomic columns exist (they are absent in pre-migration DBs)
    if (hasGenomicColumnsChecked === null) {
      const cols = (db.prepare("PRAGMA table_info(variant_scores)").all as any)() as Array<{ name: string }>;
      hasGenomicColumnsChecked = cols.some(c => c.name === 'pos_genomic');
    }
    if (!hasGenomicColumnsChecked) {
      // Database exists but was built without genomic columns — can't serve this query.
      // Callers should fall back to the Ensembl VEP translation path.
      return null;
    }

    const stmt = db.prepare(`
      SELECT * FROM variant_scores
      WHERE chr = ? AND pos_genomic = ? AND ref = ? AND alt = ?
      LIMIT 1
    `);
    const row = (stmt.get as any)(
      normChr,
      posGenomic,
      ref.trim().toUpperCase(),
      alt.trim().toUpperCase()
    ) as LocalDbnsfpRecord | undefined;

    return row ?? null;
  } catch (err: any) {
    console.warn(`[Local dbNSFP Error] genomic lookup failed:`, err.message);
    return null;
  }
}
