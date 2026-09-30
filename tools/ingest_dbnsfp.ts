import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import readline from 'readline';
import path from 'path';

/**
 * dbNSFP Ingestion Utility (Space-Efficient)
 * 
 * Usage:
 *   npx tsx tools/ingest_dbnsfp.ts <path_to_dbnsfp_variant_files...>
 */

const DB_PATH = path.join(process.cwd(), 'data', 'dbnsfp_v5.sqlite');

function initDb() {
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);
  
  // Enable Write-Ahead Log for concurrent read/write and memory/disk optimization
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS variant_scores (
      gene TEXT NOT NULL,
      chr TEXT,
      pos_genomic INTEGER,
      transcript TEXT,
      aaref TEXT,
      aaalt TEXT,
      pos INTEGER NOT NULL,
      ref TEXT,
      alt TEXT,
      aa_change TEXT,
      revel REAL,
      alphamissense REAL,
      gerp REAL,
      phylop REAL,
      bayesdel REAL,
      metarnn REAL,
      clinpred REAL,
      dann REAL,
      eigen REAL,
      esm1b REAL,
      popeve REAL,
      cadd REAL,
      gnomad_ac INTEGER,
      gnomad_an INTEGER,
      gnomad_hom INTEGER,
      aou_ac INTEGER,
      aou_an INTEGER,
      aou_het INTEGER,
      aou_hom INTEGER
    );
  `);

  // A database built before these columns existed keeps its old table under IF NOT EXISTS, and every
  // insert below would then fail on an unknown column; add whatever is missing.
  const existing = new Set((db.prepare('PRAGMA table_info(variant_scores)').all() as Array<{ name: string }>).map(c => c.name));
  for (const [col, type] of [['chr', 'TEXT'], ['pos_genomic', 'INTEGER'], ['transcript', 'TEXT'], ['aaref', 'TEXT'], ['aaalt', 'TEXT']]) {
    if (!existing.has(col)) db.exec(`ALTER TABLE variant_scores ADD COLUMN ${col} ${type};`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS build_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gene_pos ON variant_scores (gene, pos);
    CREATE INDEX IF NOT EXISTS idx_pos_ref_alt ON variant_scores (pos, ref, alt);
    CREATE INDEX IF NOT EXISTS idx_variant_scores_gene_pos_ref_alt ON variant_scores (gene, pos, ref, alt);
  `);

  return db;
}

function parseFloater(val: string): number | null {
  if (!val || val === '.' || val === 'NA' || val === '-') return null;
  // Handle multiple values separated by semicolon or comma (take first one)
  const clean = val.split(/[;,]/)[0].trim();
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? null : parsed;
}

function parseIntInt(val: string): number | null {
  if (!val || val === '.' || val === 'NA' || val === '-') return null;
  const clean = val.split(/[;,]/)[0].trim();
  const parsed = parseInt(clean, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Index of the transcript whose residue number and per-transcript scores a row is stored under.
 *
 * dbNSFP lists every transcript an SNV touches, in its own order, with `aapos`, `REVEL_score`,
 * `AlphaMissense_score` and `Ensembl_transcriptid` aligned by position in those `;` lists. Taking
 * the first entry (the old behaviour) stored an arbitrary isoform's residue number, so the
 * landscape pooled different residues under one number. Preference: MANE Select, then the VEP
 * canonical flag, then the first entry.
 */
export function chooseTranscriptIndex(mane: string, vepCanonical: string, transcriptCount: number): { index: number; basis: 'mane' | 'ensembl-canonical' | 'first-listed' | 'single' } {
  const maneList = mane ? mane.split(';') : [];
  const canonList = vepCanonical ? vepCanonical.split(';') : [];
  if (maneList.length === transcriptCount) {
    const i = maneList.findIndex(v => /^MANE/i.test(v.trim()) || v.trim().toUpperCase() === 'YES');
    if (i >= 0) return { index: i, basis: 'mane' };
  }
  if (canonList.length === transcriptCount) {
    const i = canonList.findIndex(v => v.trim().toUpperCase() === 'YES');
    if (i >= 0) return { index: i, basis: 'ensembl-canonical' };
  }
  // One transcript leaves nothing to choose; it must not count as an arbitrary pick.
  return { index: 0, basis: transcriptCount <= 1 ? 'single' : 'first-listed' };
}

/** The `i`-th entry of a `;` list, or the single value when the field is not per-transcript. */
function pick(val: string, i: number, count: number): string {
  if (!val) return '';
  const parts = val.split(';');
  if (parts.length === count) return parts[i].trim();
  return parts[0].trim();
}

async function ingestFile(db: DatabaseSync, filepath: string) {
  console.log(`[Ingest] Processing file: ${filepath}`);
  const fileStream = fs.createReadStream(filepath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isHeader = true;
  let headers: string[] = [];
  
  // Prepare insert statement
  const insertStmt = db.prepare(`
    INSERT INTO variant_scores (
      gene, chr, pos_genomic, transcript, aaref, aaalt, pos, ref, alt, aa_change,
      revel, alphamissense, gerp, phylop, bayesdel,
      metarnn, clinpred, dann, eigen, esm1b, cadd,
      gnomad_ac, gnomad_an, gnomad_hom,
      aou_ac, aou_an, aou_het, aou_hom
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    );
  `);

  let count = 0;
  const policyCounts = { 'mane': 0, 'ensembl-canonical': 0, 'first-listed': 0, 'single': 0 };
  db.exec('BEGIN TRANSACTION;');

  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.split('\t');

    if (isHeader) {
      headers = parts.map(h => h.trim());
      isHeader = false;
      console.log(`[Ingest] Mapped headers: found ${headers.length} columns.`);
      continue;
    }

    const getVal = (colNames: string[]): string => {
      for (const colName of colNames) {
        const idx = headers.indexOf(colName);
        if (idx !== -1) return parts[idx];
      }
      return '';
    };

    // Extract gene name and position (required)
    const txList = getVal(['Ensembl_transcriptid', 'ensembl_transcriptid']);
    const txCount = txList ? txList.split(';').length : 1;
    const choice = chooseTranscriptIndex(getVal(['MANE', 'MANE_Select', 'mane']), getVal(['VEP_canonical', 'vep_canonical']), txCount);
    policyCounts[choice.basis] += 1;
    const at = (cols: string[]) => pick(getVal(cols), choice.index, txCount);

    const gene = at(['genename', 'geneName', 'gene_name']);
    // Residue number only. `pos(1-based)` is the GENOMIC coordinate and must never stand in for it.
    const posVal = parseIntInt(at(['aapos', 'aaPos', 'aa_pos']));

    if (!gene || posVal === null || posVal <= 0) continue;
    const transcript = txList ? pick(txList, choice.index, txCount) || null : null;
    const chr = getVal(['#chr', 'chr']) || null;
    const posGenomic = parseIntInt(getVal(['pos(1-based)', 'hg38_pos(1-based)']));
    const aaref = getVal(['aaref']) || null;
    const aaalt = getVal(['aaalt']) || null;

    const ref = getVal(['ref']) || null;
    const alt = getVal(['alt']) || null;
    const aa_change = at(['aachange', 'aa_change', 'HGVSp', 'hgvsp', 'HGVSp_VEP']) || null;

    // Scores
    const revel = parseFloater(at(['REVEL_score', 'revel', 'REVEL']));
    const alphamissense = parseFloater(at(['AlphaMissense_score', 'alphamissense', 'AlphaMissense']));
    const gerp = parseFloater(getVal(['GERP++_RS', 'gerp++', 'GERP_RS']));
    const phylop = parseFloater(getVal(['phyloP100way_vertebrate', 'phylop100way']));
    const bayesdel = parseFloater(getVal(['BayesDel_noAF_score', 'bayesdel_noaf']));
    const metarnn = parseFloater(getVal(['MetaRNN_score', 'metarnn']));
    const clinpred = parseFloater(getVal(['ClinPred_score', 'clinpred']));
    const dann = parseFloater(getVal(['DANN_score', 'dann']));
    const eigen = parseFloater(getVal(['Eigen-phred', 'Eigen_phred', 'eigen']));
    const esm1b = parseFloater(getVal(['ESM1b_score', 'esm1b']));
    const cadd = parseFloater(getVal(['CADD_phred', 'cadd_phred', 'cadd']));

    // gnomAD Counts
    // Summing exomes and genomes counts
    const exAC = parseIntInt(getVal(['gnomAD_exomes_AC', 'gnomad_exomes_ac'])) || 0;
    const genAC = parseIntInt(getVal(['gnomAD_genomes_AC', 'gnomad_genomes_ac'])) || 0;
    const gnomad_ac = (exAC + genAC) || null;

    const exAN = parseIntInt(getVal(['gnomAD_exomes_AN', 'gnomad_exomes_an'])) || 0;
    const genAN = parseIntInt(getVal(['gnomAD_genomes_AN', 'gnomad_genomes_an'])) || 0;
    const gnomad_an = (exAN + genAN) || null;

    const exHom = parseIntInt(getVal(['gnomAD_exomes_nhomalt', 'gnomad_exomes_hom'])) || 0;
    const genHom = parseIntInt(getVal(['gnomAD_genomes_nhomalt', 'gnomad_genomes_hom'])) || 0;
    const gnomad_hom = (exHom + genHom) || null;

    // All of Us Counts
    const aou_ac = parseIntInt(getVal(['AoU_AC', 'aou_ac'])) || null;
    const aou_an = parseIntInt(getVal(['AoU_AN', 'aou_an'])) || null;
    const aou_het = parseIntInt(getVal(['AoU_het', 'AoU_het_count', 'aou_het'])) || null;
    const aou_hom = parseIntInt(getVal(['AoU_hom', 'AoU_hom_count', 'aou_hom'])) || null;

    insertStmt.run(
      gene, chr, posGenomic, transcript, aaref, aaalt, posVal, ref, alt, aa_change,
      revel, alphamissense, gerp, phylop, bayesdel,
      metarnn, clinpred, dann, eigen, esm1b, cadd,
      gnomad_ac, gnomad_an, gnomad_hom,
      aou_ac, aou_an, aou_het, aou_hom
    );

    count++;
    if (count % 5000 === 0) {
      db.exec('COMMIT;');
      db.exec('BEGIN TRANSACTION;');
    }
  }

  db.exec('COMMIT;');
  console.log(`[Ingest] Completed ingesting ${count} records from ${filepath} (transcript: ${JSON.stringify(policyCounts)})`);
  return policyCounts;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Error: Please provide one or more dbNSFP chromosomes or variant TSV files to ingest.');
    process.exit(1);
  }

  const db = initDb();
  const totals = { 'mane': 0, 'ensembl-canonical': 0, 'first-listed': 0, 'single': 0 };
  for (const file of args) {
    if (fs.existsSync(file)) {
      const counts = await ingestFile(db, file);
      for (const k of Object.keys(totals) as Array<keyof typeof totals>) totals[k] += counts[k];
    } else {
      console.warn(`File not found: ${file}`);
    }
  }
  // Provenance the landscape reports: the version (from DBNSFP_VERSION, e.g. "5.1a") and the
  // transcript policy that held for the rows (mixed → "unknown").
  const setMeta = db.prepare('INSERT OR REPLACE INTO build_meta (key, value) VALUES (?, ?)');
  if (process.env.DBNSFP_VERSION) setMeta.run('dbnsfp_version', process.env.DBNSFP_VERSION);
  // Named only when every multi-transcript row was placed by that flag; a mix of MANE and canonical
  // rows is reported as the weaker of the two, and any arbitrary pick makes it unknown.
  const policy = totals['first-listed'] > 0 ? 'unknown'
    : totals['ensembl-canonical'] > 0 ? 'ensembl-canonical'
    : totals['mane'] > 0 ? 'mane' : 'unknown';
  setMeta.run('transcript_policy', policy);
  console.log('[Ingest] SQLite Ingestion complete.');
}

if (process.argv[1] === path.resolve(import.meta.dirname, 'ingest_dbnsfp.ts') || process.argv[1].endsWith('ingest_dbnsfp.ts')) {
  main().catch(console.error);
}
