#!/usr/bin/env tsx
/**
 * build-rasp-sqlite.ts
 *
 * Builds the RaSP lookup index (`data/df_rasp_gnomad_clinvar.sqlite`) from the precomputed
 * Zenodo CSV.
 *
 * Usage:
 *   node scripts/build-rasp-sqlite.ts        # plain Node runs this file via type stripping
 *   npx tsx scripts/build-rasp-sqlite.ts
 *   npm run migrate:rasp
 *
 * Requires Node >=22.5.0 (`node:sqlite`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS SCRIPT IS DEFENSIVE (read before changing it)
 * ─────────────────────────────────────────────────────────────────────────────
 * The index shipped in this repository was TRUNCATED: it held 35,000 of 8,770,220 rows — the first
 * six proteins in CSV order, cut on an exact 5,000-row batch boundary. Because the loader only
 * checked "file is bigger than 1 KB and has at least one row", it served that prefix happily and
 * reported "no precomputed profile" for 1,339 of the 1,345 proteins the CSV actually covers. Every
 * RaSP lookup for those proteins was a silent false negative, and nothing in the system noticed.
 *
 * Two properties therefore have to hold, and this script is written around them:
 *
 *   1. **The target is never written in place.** The build goes to `<dbPath>.building` and is
 *      swapped in only after it has been counted and verified, so an interrupted or failing run
 *      leaves the previous index intact instead of leaving a plausible-looking prefix.
 *   2. **The index carries its own completeness record.** `rasp_index_meta` records the row and
 *      protein counts, so the loader can tell a complete index from a truncated one
 *      (`inspectRaspIndex` in `server/services/stability/energy-models.ts`).
 *
 * CSV schema:
 *   uniprot_id, pdb_chain, pdb, chain_id, variant, RaSP;score_ml,
 *   clinvar;Clinvar_signifiance, gnomad;AF
 *
 * `variant` is single-letter notation, e.g. "S41A" -> wt=S, pos=41, mut=A. Rows whose variant is
 * the wild-type reference (`S41=`) are correctly skipped: there is no substitution to score.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import readline from "readline";
import { RASP_INDEX_SCHEMA_VERSION, verifyRaspIndex } from "../../../src/shared/raspIndex.ts";

const DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_CSV_PATH = path.join(DATA_DIR, "df_rasp_gnomad_clinvar.csv");
const DEFAULT_DB_PATH  = path.join(DATA_DIR, "df_rasp_gnomad_clinvar.sqlite");

export { RASP_INDEX_SCHEMA_VERSION };

/** Minimum plausible size for a usable index; smaller files are placeholders. */
const MIN_INDEX_BYTES = 1024;

export function parseVariant(v: string): { wt: string; pos: number; mut: string } | null {
  const m = v.match(/^([A-Za-z])(\d+)([A-Za-z])$/);
  if (!m) return null;
  return { wt: m[1].toUpperCase(), pos: parseInt(m[2], 10), mut: m[3].toUpperCase() };
}

export interface RaspBuildResult {
  rows: number;
  proteins: number;
  skipped: number;
  sizeBytes: number;
  dbPath: string;
  seconds: number;
}

export async function buildRaspSqliteDatabase(
  csvPath: string = DEFAULT_CSV_PATH,
  dbPath: string = DEFAULT_DB_PATH
): Promise<RaspBuildResult> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`[RaSP SQLite] CSV not found: ${csvPath}`);
  }

  const targetDir = path.dirname(dbPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Build beside the target, never on it: the previous index must survive a failed run.
  const tempPath = `${dbPath}.building`;
  if (fs.existsSync(tempPath)) {
    try { fs.rmSync(tempPath); } catch (_) {}
  }

  const startedAt = Date.now();
  const csvStat = fs.statSync(csvPath);

  /**
   * Tracked outside the `try` so the `finally` can close it while `db` keeps its strong type inside.
   *
   * Every throw between `new DatabaseSync` and the success path used to leak this handle — and on
   * Windows an open SQLite file commonly refuses deletion, so the staging cleanup would fail too.
   */
  let openDb: DatabaseSync | null = null;

  try {
    const db = new DatabaseSync(tempPath, { open: true });
    openDb = db;

    db.exec(`
      DROP TABLE IF EXISTS rasp_variants;
      CREATE TABLE IF NOT EXISTS rasp_variants (
        uniprot_id           TEXT    NOT NULL,
        pos                  INTEGER NOT NULL,
        wt                   TEXT    NOT NULL,
        mut                  TEXT    NOT NULL,
        pdb                  TEXT,
        pdb_chain            TEXT,
        chain_id             TEXT,
        rasp_score           REAL,
        clinvar_significance TEXT,
        gnomad_af            REAL
      ) STRICT;

      -- Exact-variant lookup (primary path)
      CREATE INDEX idx_rasp_exact   ON rasp_variants(uniprot_id, pos, wt, mut);
      -- All variants for a protein (landscape / range queries)
      CREATE INDEX idx_rasp_protein ON rasp_variants(uniprot_id, pos);
    `);

    const insert = db.prepare(`
      INSERT INTO rasp_variants
        (uniprot_id, pos, wt, mut, pdb, pdb_chain, chain_id,
         rasp_score, clinvar_significance, gnomad_af)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const BATCH = 5000;
    let pending: Array<() => void> = [];
    let rowCount = 0;
    let skipCount = 0;
    let headerSkipped = false;

    const flush = () => {
      db.exec("BEGIN");
      for (const fn of pending) fn();
      db.exec("COMMIT");
      pending = [];
    };

    const stream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!headerSkipped) { headerSkipped = true; continue; }

      const parts = line.split(",");
      if (parts.length < 6) { skipCount++; continue; }

      const [uniprotId, pdbChain, pdb, chainId, variant] = parts;
      const parsed = parseVariant(variant?.trim() ?? "");
      if (!parsed) { skipCount++; continue; }

      const { wt, pos, mut } = parsed;
      const raspScore  = parts[5] ? parseFloat(parts[5]) : null;
      const clinvarSig = parts[6]?.trim() || null;
      const gnomadAf   = parts[7] ? parseFloat(parts[7]) : null;

      pending.push(() => {
        (insert.run as any)(
          uniprotId.trim(), pos, wt, mut,
          pdb?.trim() || null, pdbChain?.trim() || null, chainId?.trim() || null,
          raspScore !== null && !isNaN(raspScore) ? raspScore : null,
          clinvarSig,
          gnomadAf !== null && !isNaN(gnomadAf) ? gnomadAf : null
        );
      });

      rowCount++;
      if (pending.length >= BATCH) {
        flush();
        if (rowCount % 500000 === 0) {
          process.stdout.write(`\r[RaSP SQLite] Imported ${rowCount.toLocaleString()} rows...`);
        }
      }
    }

    if (pending.length > 0) flush();

    // ── Count what actually landed, then record it in the index itself ──
    const actualRows = (db.prepare("SELECT COUNT(*) AS c FROM rasp_variants").get() as any).c as number;
    const actualProteins = (db.prepare("SELECT COUNT(DISTINCT uniprot_id) AS c FROM rasp_variants").get() as any).c as number;

    if (actualRows !== rowCount) {
      throw new Error(
        `[RaSP SQLite] Row count mismatch: imported ${rowCount} but found ${actualRows} in the index.`
      );
    }
    if (actualProteins === 0) {
      throw new Error("[RaSP SQLite] Index contains no proteins; refusing to install it.");
    }

    db.exec(`
      DROP TABLE IF EXISTS rasp_index_meta;
      CREATE TABLE IF NOT EXISTS rasp_index_meta (
        schema_version INTEGER NOT NULL,
        rows           INTEGER NOT NULL,
        proteins       INTEGER NOT NULL,
        source_file    TEXT,
        source_bytes   INTEGER,
        built_at       TEXT    NOT NULL
      ) STRICT;
    `);
    db.prepare(`
      INSERT INTO rasp_index_meta
        (schema_version, rows, proteins, source_file, source_bytes, built_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      RASP_INDEX_SCHEMA_VERSION,
      actualRows,
      actualProteins,
      path.basename(csvPath),
      csvStat.size,
      new Date().toISOString()
    );

    // Read the record back and check it with the SAME rule the loader applies. A same-process
    // comparison would pass even if the write had silently not landed.
    const metaRow = db.prepare(
      "SELECT schema_version, rows, proteins, built_at FROM rasp_index_meta LIMIT 1"
    ).get() as any;
    const verdict = verifyRaspIndex(
      { rows: actualRows, proteins: actualProteins },
      metaRow
        ? {
            schemaVersion: metaRow.schema_version,
            rows: metaRow.rows,
            proteins: metaRow.proteins,
            builtAt: metaRow.built_at
          }
        : null
    );
    if (!verdict.usable) {
      throw new Error(`[RaSP SQLite] Built index failed its own completeness check: ${verdict.reason}`);
    }

    db.close();
    openDb = null;

    // ── Swap in, only now ──
    //
    // Rename straight over the target. The previous version unlinked the target first, which opened
    // a window with NO index at all: a kill (or a failed rename — EBUSY on Windows, ENOSPC) inside
    // it left nothing behind, and that is worse than the truncated index this work set out to fix.
    // `rename` replaces atomically on POSIX and maps to MoveFileExW(REPLACE_EXISTING) on Windows, so
    // the unlink was both unnecessary and the source of the hazard.
    const builtStat = fs.statSync(tempPath);
    if (builtStat.size < MIN_INDEX_BYTES) {
      throw new Error(`[RaSP SQLite] Built index is implausibly small (${builtStat.size} bytes).`);
    }
    fs.renameSync(tempPath, dbPath);

    const seconds = (Date.now() - startedAt) / 1000;
    console.log(`\n[RaSP SQLite] Done. ${actualRows.toLocaleString()} rows across ${actualProteins.toLocaleString()} proteins, ${skipCount.toLocaleString()} skipped.`);
    console.log(`[RaSP SQLite] ${(builtStat.size / 1024 / 1024).toFixed(1)} MB in ${seconds.toFixed(1)}s -> ${dbPath}`);

    return { rows: actualRows, proteins: actualProteins, skipped: skipCount, sizeBytes: builtStat.size, dbPath, seconds };
  } catch (err) {
    // Never leave a half-built file lying around where a later run (or a human) might trust it.
    try {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
    } catch (_) {}
    throw err;
  } finally {
    // Every throw between `new DatabaseSync` and the success path used to leak the handle — and on
    // Windows an open SQLite file commonly refuses deletion, so the cleanup above would fail too.
    if (openDb) {
      try {
        openDb.close();
      } catch (_) {}
    }
  }
}

/**
 * NO auto-run block here, deliberately.
 *
 * This file is imported by the SERVER — `energy-models.ts` rebuilds the index when it finds one that is
 * missing, truncated or stale — so importing it must not have side effects. The CLI entry point is
 * `scripts/build-rasp-sqlite.ts`, a thin wrapper that imports and invokes `buildRaspSqliteDatabase`.
 *
 * Both files used to carry the guard below, and it matched on the FILE NAME:
 *
 *     if (process.argv[1]?.endsWith("build-rasp-sqlite.ts")) { … }
 *
 * So with a wrapper of that name, invoking the CLI would have fired the wrapper AND this module —
 * two concurrent builds of the same 726 MB index, into the same `<dbPath>.building`, with the atomic
 * swap in step 1 of the docstring above racing itself. That is why the guard lives in the wrapper and
 * not here.
 */
