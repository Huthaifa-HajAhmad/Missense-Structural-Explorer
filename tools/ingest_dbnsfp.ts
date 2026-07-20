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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gene_pos ON variant_scores (gene, pos);
    CREATE INDEX IF NOT EXISTS idx_chr_pos_ref_alt ON variant_scores (pos, ref, alt);
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

async function ingestFile(db: DatabaseSync, filepath: string) {
  console.log(`[Ingest] Processing file: ${filepath}`);
  const fileStream = fs.createReadStream(filepath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isHeader = true;
  let headers: string[] = [];
  
  // Prepare insert statement
  const insertStmt = db.prepare(`
    INSERT INTO variant_scores (
      gene, pos, ref, alt, aa_change,
      revel, alphamissense, gerp, phylop, bayesdel,
      metarnn, clinpred, dann, eigen, esm1b, cadd,
      gnomad_ac, gnomad_an, gnomad_hom,
      aou_ac, aou_an, aou_het, aou_hom
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    );
  `);

  let count = 0;
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
    const gene = getVal(['geneName', 'genename', 'gene_name']);
    const posVal = parseIntInt(getVal(['aaPos', 'aapos', 'pos(1-based)', 'aa_pos']));
    
    if (!gene || posVal === null) continue;

    const ref = getVal(['ref']) || null;
    const alt = getVal(['alt']) || null;
    const aa_change = getVal(['aachange', 'aa_change', 'HGVSp', 'hgvsp']) || null;

    // Scores
    const revel = parseFloater(getVal(['REVEL_score', 'revel', 'REVEL']));
    const alphamissense = parseFloater(getVal(['AlphaMissense_score', 'alphamissense', 'AlphaMissense']));
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
      gene, posVal, ref, alt, aa_change,
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
  console.log(`[Ingest] Completed ingesting ${count} records from ${filepath}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Error: Please provide one or more dbNSFP chromosomes or variant TSV files to ingest.');
    process.exit(1);
  }

  const db = initDb();
  for (const file of args) {
    if (fs.existsSync(file)) {
      await ingestFile(db, file);
    } else {
      console.warn(`File not found: ${file}`);
    }
  }
  console.log('[Ingest] SQLite Ingestion complete.');
}

if (process.argv[1] === path.resolve(import.meta.dirname, 'ingest_dbnsfp.ts') || process.argv[1].endsWith('ingest_dbnsfp.ts')) {
  main().catch(console.error);
}
