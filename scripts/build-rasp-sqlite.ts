#!/usr/bin/env tsx
/**
 * build-rasp-sqlite.ts
 *
 * One-time migration: reads data/df_rasp_gnomad_clinvar.csv and imports it
 * into data/df_rasp_gnomad_clinvar.sqlite with proper indexes.
 *
 * Usage:
 *   npx tsx scripts/build-rasp-sqlite.ts
 *
 * Requires Node >=22.5.0 (node:sqlite built-in).
 *
 * CSV schema:
 *   uniprot_id, pdb_chain, pdb, chain_id, variant, RaSP;score_ml,
 *   clinvar;Clinvar_signifiance, gnomad;AF
 *
 * variant is single-letter notation e.g. "S41A" -> wt=S, pos=41, mut=A
 */

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import readline from "readline";

const DATA_DIR = path.join(process.cwd(), "data");
const CSV_PATH = path.join(DATA_DIR, "df_rasp_gnomad_clinvar.csv");
const DB_PATH  = path.join(DATA_DIR, "df_rasp_gnomad_clinvar.sqlite");

function parseVariant(v: string): { wt: string; pos: number; mut: string } | null {
  const m = v.match(/^([A-Za-z])(\d+)([A-Za-z])$/);
  if (!m) return null;
  return { wt: m[1].toUpperCase(), pos: parseInt(m[2], 10), mut: m[3].toUpperCase() };
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`[migrate] CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log("[migrate] Removed existing SQLite database.");
  }

  const db = new DatabaseSync(DB_PATH, { open: true });

  // #1 architectural fix: proper indexed table replacing the flat-CSV + byte-offset sidecar
  db.exec(`
    CREATE TABLE rasp_variants (
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

  const stream = fs.createReadStream(CSV_PATH);
  // crlfDelay: Infinity correctly handles both LF and CRLF line endings (#7 fix)
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
      if (rowCount % 100000 === 0) {
        process.stdout.write(`\r[migrate] Imported ${rowCount.toLocaleString()} rows...`);
      }
    }
  }

  if (pending.length > 0) flush();

  console.log(`\n[migrate] Done. ${rowCount.toLocaleString()} rows imported, ${skipCount} skipped.`);
  const stat = fs.statSync(DB_PATH);
  console.log(`[migrate] SQLite size: ${(stat.size / 1024 / 1024).toFixed(1)} MB -> ${DB_PATH}`);
  db.close();
}

main().catch(err => { console.error("[migrate] Fatal:", err); process.exit(1); });
