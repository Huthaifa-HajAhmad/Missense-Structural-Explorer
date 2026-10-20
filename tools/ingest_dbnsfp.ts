import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import zlib from 'zlib';
import { Readable } from 'stream';
import { once } from 'events';
import { fileURLToPath } from 'url';

/**
 * dbNSFP v5 → SQLite ingestion, built for a disk-constrained VM.
 *
 * dbNSFP v5 is one ~40-50 GB zip of per-chromosome gzip members. Stream one chromosome at a time from
 * `unzip -p` into this tool so the extracted copy never lands on disk, and build the indexes once at
 * the end: an index that exists during the load slows every insert and bloats the WAL.
 *
 * Run `npx tsx tools/ingest_dbnsfp.ts --help` for the full usage and the VM command sequence.
 *
 * Self-contained on purpose: deploy/Dockerfile.oci copies this single file into the image.
 */

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'dbnsfp_v5.sqlite');
/** Rows per transaction. Bounds WAL growth and the work lost if the process dies mid-file. */
const BATCH_SIZE = 10000;
const PROGRESS_EVERY = 250000;
const TRANSCRIPT_BASES = ['mane', 'ensembl-canonical', 'first-listed', 'single'] as const;
type TranscriptBasis = typeof TRANSCRIPT_BASES[number];

/**
 * Columns written per row. Every one is exposed through `LocalDbnsfpRecord` in
 * server/services/prediction/dbnsfp_local.ts (which reads them with SELECT * and by name), so none
 * is dead weight.
 */
const INSERT_COLUMNS = [
  'gene', 'chr', 'pos_genomic', 'transcript', 'aaref', 'aaalt', 'pos', 'ref', 'alt', 'aa_change',
  'revel', 'alphamissense', 'gerp', 'phylop', 'bayesdel',
  'metarnn', 'clinpred', 'dann', 'eigen', 'esm1b', 'popeve', 'cadd',
  'gnomad_ac', 'gnomad_an', 'gnomad_hom',
  'aou_ac', 'aou_an', 'aou_het', 'aou_hom',
  // How this row's transcript was chosen (mane | ensembl-canonical | single | first-listed), so a reader can
  // refuse the residue numbers of a row whose gene lists no MANE Select or canonical transcript.
  'transcript_basis',
];
const INSERT_SQL = `INSERT INTO variant_scores (${INSERT_COLUMNS.join(', ')}) VALUES (${INSERT_COLUMNS.map(() => '?').join(', ')});`;

/**
 * Lookup indexes, one per access path in dbnsfp_local.ts:
 *   gene + pos (+ ref/alt)  — gene window scans and single-variant lookups by residue
 *   chr + pos_genomic + ref/alt — genomic (VCF-style) lookups
 */
const INDEXES: ReadonlyArray<{ name: string; columns: string }> = [
  { name: 'idx_gene_pos', columns: 'gene, pos' },
  { name: 'idx_variant_scores_gene_pos_ref_alt', columns: 'gene, pos, ref, alt' },
  { name: 'idx_chr_pos_genomic_ref_alt', columns: 'chr, pos_genomic, ref, alt' },
];

export interface IngestOptions {
  dbPath: string;
  sources: string[];
  version: string | null;
  deleteAfterIngest: boolean;
  skipIndexes: boolean;
  indexesOnly: boolean;
  force: boolean;
  help: boolean;
}

export function parseFloater(val: string): number | null {
  if (!val || val === '.' || val === 'NA' || val === '-') return null;
  const clean = val.split(/[;,]/)[0].trim();
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? null : Math.round(parsed * 10000) / 10000;
}

export function parseIntInt(val: string): number | null {
  if (!val || val === '.' || val === 'NA' || val === '-') return null;
  const clean = val.split(/[;,]/)[0].trim();
  const parsed = parseInt(clean, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * How dbNSFP writes a MANE flag. v5.4a writes `Select` / `Plus_Clinical` in a `MANE` column; older
 * releases wrote `MANE_Select`. Only MANE SELECT is the transcript residue numbers are reported on:
 * a Plus-Clinical entry is a second, clinically-requested transcript and must not be mistaken for it
 * (the previous `/^MANE/` test accepted both).
 */
const MANE_SELECT = /^(?:MANE[_ ]?)?Select$/i;
const MANE_ANY = /^(?:MANE[_ ]?)?(?:Select|Plus[_ ]?Clinical)$/i;

/**
 * A value in the MANE column this loader does not understand, or null.
 *
 * The loader once missed 5.4a's `Select` entirely: it fell back to the FIRST-listed transcript for
 * every multi-transcript row, which stored a different residue number than MANE's in ~21% of them
 * (IL17RA 198 instead of 311), and nothing failed. A format the loader cannot read must stop the load.
 */
export function unrecognisedManeValue(mane: string): string | null {
  for (const raw of mane.split(';')) {
    const v = raw.trim();
    if (v && v !== '.' && v.toUpperCase() !== 'YES' && !MANE_ANY.test(v)) return v;
  }
  return null;
}

export function chooseTranscriptIndex(mane: string, vepCanonical: string, transcriptCount: number): { index: number; basis: TranscriptBasis } {
  // One transcript is no choice, whatever it is flagged as. Checked FIRST: chrM's genes each list a single
  // transcript carrying `Ensembl_canonical = YES`, which used to count as an "ensembl-canonical" pick and
  // turned a store of MANE-numbered chromosomes into policy `mixed` (read back as `unknown` by the landscape).
  if (transcriptCount <= 1) return { index: 0, basis: 'single' };
  const maneList = mane ? mane.split(';') : [];
  const canonList = vepCanonical ? vepCanonical.split(';') : [];
  if (maneList.length === transcriptCount) {
    const i = maneList.findIndex(v => MANE_SELECT.test(v.trim()) || v.trim().toUpperCase() === 'YES');
    if (i >= 0) return { index: i, basis: 'mane' };
  }
  if (canonList.length === transcriptCount) {
    const i = canonList.findIndex(v => v.trim().toUpperCase() === 'YES');
    if (i >= 0) return { index: i, basis: 'ensembl-canonical' };
  }
  return { index: 0, basis: transcriptCount <= 1 ? 'single' : 'first-listed' };
}

function pick(val: string, i: number, count: number): string {
  if (!val) return '';
  const parts = val.split(';');
  if (parts.length === count) return parts[i].trim();
  return parts[0].trim();
}

function derivePolicy(counts: Record<TranscriptBasis, number>): string {
  if (counts['mane'] > 0) return 'mane';
  if (counts['ensembl-canonical'] > 0) return 'ensembl-canonical';
  if (counts['first-listed'] > 0) return 'unknown';
  return 'single';
}

function zeroCounts(): Record<TranscriptBasis, number> {
  return { 'mane': 0, 'ensembl-canonical': 0, 'first-listed': 0, 'single': 0 };
}

export function versionFromFilename(file: string): string | null {
  const m = path.basename(file).match(/dbNSFP[_-]?(\d+(?:\.\d+)*[a-z]?)/i);
  return m ? m[1] : null;
}

const HELP = `dbNSFP v5 -> SQLite ingest (the store read by server/services/prediction/dbnsfp_local.ts)

Usage:
  npx tsx tools/ingest_dbnsfp.ts [options] <input...> [store.sqlite]
  npx tsx tools/ingest_dbnsfp.ts --indexes-only [store.sqlite]

Inputs
  dbNSFP variant text files: .tsv / .txt / .gz / .bgz. Gzip is detected from the file's first
  bytes, not its extension, and every member of a multi-member (bgzip) file is read.
  "-" reads from stdin. Inputs are processed in the order given.

Store
  The last argument ending in .sqlite or .db, or --db <path>, or $DBNSFP_SQLITE_PATH.
  Default: data/dbnsfp_v5.sqlite. Created if missing.

Options
  --db <path>            store to write (see above)
  --version <v>          dbNSFP release recorded in build_meta, e.g. 5.4a.
                         Default: $DBNSFP_VERSION, else parsed from a file name.
                         Stdin has no name, so pass --version for stdin runs.
  --delete-after-ingest  after each FILE's transaction commits, checkpoint the WAL and delete
                         that file. Never applies to stdin.
  --skip-indexes         load only; build indexes later with --indexes-only
  --indexes-only         build the indexes on an existing store. Takes no inputs.
  --force                allow a chromosome already recorded in build_meta to be ingested again,
                         or a different dbNSFP version. Both duplicate or mix rows; prefer a
                         fresh store.
  -h, --help             show this help

Disk-constrained VM (the zip is ~40-50 GB; stream it, never extract it to disk)
  # 1. one chromosome at a time, indexes deferred. Get member names with: unzip -l dbNSFP5.4a.zip
  unzip -p dbNSFP5.4a.zip dbNSFP5.4a_variant.chr1.gz  | npx tsx tools/ingest_dbnsfp.ts - data/dbnsfp_v5.sqlite --version 5.4a --skip-indexes
  unzip -p dbNSFP5.4a.zip dbNSFP5.4a_variant.chr2.gz  | npx tsx tools/ingest_dbnsfp.ts - data/dbnsfp_v5.sqlite --version 5.4a --skip-indexes
  ...                                                  (chr3 to chr22, chrX, chrY, chrM as listed by unzip -l)
  # 2. build the indexes once, after every chromosome is in
  npx tsx tools/ingest_dbnsfp.ts --indexes-only data/dbnsfp_v5.sqlite
`;

interface Source {
  label: string;
  filePath: string | null;
  input: Readable;
  closed: Promise<void>;
}

function isGzip(head: Buffer): boolean {
  return head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
}

function decodeIfGzip(raw: Readable, head: Buffer): Readable {
  if (!isGzip(head)) return raw;
  const gunzip = zlib.createGunzip();
  raw.on('error', (err) => gunzip.destroy(err));
  return raw.pipe(gunzip) as unknown as Readable;
}

function openFileSource(file: string): Source {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(2);
  let n = 0;
  try {
    n = fs.readSync(fd, head, 0, 2, 0);
  } finally {
    fs.closeSync(fd);
  }
  const raw = fs.createReadStream(file);
  const closed = once(raw, 'close').then(() => undefined);
  closed.catch(() => undefined);
  return { label: file, filePath: file, input: decodeIfGzip(raw, head.subarray(0, n)), closed };
}

async function openStdinSource(): Promise<Source> {
  const iter = process.stdin[Symbol.asyncIterator]();
  const toBuffer = (v: unknown) => (Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array));
  const pre: Buffer[] = [];
  let have = 0;
  while (have < 2) {
    const r = await iter.next();
    if (r.done) break;
    const chunk = toBuffer(r.value);
    pre.push(chunk);
    have += chunk.length;
  }
  const head = Buffer.concat(pre);
  async function* replay(): AsyncGenerator<Buffer> {
    if (head.length) yield head;
    for (;;) {
      const r = await iter.next();
      if (r.done) return;
      yield toBuffer(r.value);
    }
  }
  const raw = Readable.from(replay());
  return { label: '<stdin>', filePath: null, input: decodeIfGzip(raw, head), closed: Promise.resolve() };
}

function indexColumns(headers: string[]): Map<string, number> {
  const index = new Map<string, number>();
  headers.forEach((h, i) => { if (!index.has(h)) index.set(h, i); });
  return index;
}

function openStore(dbPath: string, create: boolean): DatabaseSync {
  if (create) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');

  if (create) {
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
        aou_hom INTEGER,
        transcript_basis TEXT
      );
      CREATE TABLE IF NOT EXISTS build_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS gene_numbering (
        gene TEXT PRIMARY KEY,
        transcript TEXT,
        basis TEXT NOT NULL
      );
    `);
  }
  // CREATE IF NOT EXISTS does not upgrade stores built before genomic/transcript identity was
  // retained. Add nullable columns atomically; preserve all rows and existing score columns.
  // Run for indexes-only as well, because its genomic index needs these columns too.
  const columns = new Set((db.prepare('PRAGMA table_info(variant_scores)').all() as Array<{ name: string }>).map(c => c.name));
  const legacyColumns = { chr: 'TEXT', pos_genomic: 'INTEGER', transcript: 'TEXT', aaref: 'TEXT', aaalt: 'TEXT', transcript_basis: 'TEXT' };
  const missing = Object.entries(legacyColumns).filter(([name]) => !columns.has(name));
  if (missing.length) {
    let transactionStarted = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      transactionStarted = true;
      for (const [name, type] of missing) db.exec(`ALTER TABLE variant_scores ADD COLUMN ${name} ${type}`);
      db.exec('COMMIT');
    } catch (error) {
      if (transactionStarted) db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}

function assertChromosomeNotRecorded(db: DatabaseSync, chr: string, force: boolean, label: string): void {
  const existing = (db.prepare('SELECT value FROM build_meta WHERE key = ?;').get(`rows:${chr}`) as any)?.value;
  if (!existing) return;
  if (force) {
    console.warn(`[Ingest] WARNING: chromosome ${chr} already recorded in build_meta (${existing}); continuing because --force`);
    return;
  }
  throw new Error(
    `Chromosome ${chr} already recorded in build_meta (${existing} rows). ` +
    `Loading it again would duplicate rows. Pass --force to override, or start with a fresh store.`
  );
}

function assertVersionCompatible(db: DatabaseSync, version: string | null, force: boolean): void {
  if (!version) return;
  const existing = (db.prepare("SELECT value FROM build_meta WHERE key = 'dbnsfp_version';").get() as any)?.value;
  if (!existing) {
    db.prepare("INSERT INTO build_meta (key, value) VALUES ('dbnsfp_version', ?);").run(version);
    return;
  }
  if (existing === version) return;
  if (force) {
    console.warn(`[Ingest] WARNING: store was built from dbNSFP ${existing}, but this input is ${version}; continuing because --force`);
    return;
  }
  throw new Error(
    `Store was built from dbNSFP ${existing}, but this input is ${version}. ` +
    `Mixing versions in one store produces inconsistent scores. Pass --force to override.`
  );
}

function recordSource(db: DatabaseSync, opts: {
  rowsByChr: Map<string, number>;
  policy: Record<TranscriptBasis, number>;
  label: string;
  version: string | null;
}): void {
  const now = new Date().toISOString();
  for (const [chr, count] of opts.rowsByChr) {
    const existing = (db.prepare('SELECT value FROM build_meta WHERE key = ?;').get(`rows:${chr}`) as any)?.value;
    const total = (existing ? parseInt(existing, 10) : 0) + count;
    db.prepare('INSERT OR REPLACE INTO build_meta (key, value) VALUES (?, ?);').run(
      `rows:${chr}`,
      String(total)
    );
  }
  // The policy label is one word; how many rows each basis actually decided is the number that says how far
  // to trust it (a `mane` store still holds rows whose gene lists no MANE Select, stored on the first-listed
  // transcript). Cumulative across files, like `rows:<chr>`.
  const priorPicks = (db.prepare("SELECT value FROM build_meta WHERE key = 'transcript_pick_counts';").get() as any)?.value;
  const picks = zeroCounts();
  try {
    Object.assign(picks, priorPicks ? JSON.parse(priorPicks) : {});
  } catch {
    /* an unreadable earlier value is replaced, not extended */
  }
  for (const basis of Object.keys(opts.policy) as TranscriptBasis[]) picks[basis] += opts.policy[basis];
  db.prepare("INSERT OR REPLACE INTO build_meta (key, value) VALUES ('transcript_pick_counts', ?);").run(JSON.stringify(picks));

  const policyName = derivePolicy(opts.policy);
  const existingPolicy = (db.prepare("SELECT value FROM build_meta WHERE key = 'transcript_policy';").get() as any)?.value;
  if (!existingPolicy || existingPolicy === 'single') {
    db.prepare("INSERT OR REPLACE INTO build_meta (key, value) VALUES ('transcript_policy', ?);").run(policyName);
  } else if (policyName !== 'single' && existingPolicy !== policyName) {
    db.prepare("INSERT OR REPLACE INTO build_meta (key, value) VALUES ('transcript_policy', 'mixed');").run();
  }
  db.prepare("INSERT OR REPLACE INTO build_meta (key, value) VALUES ('ingested_at', ?);").run(now);
}

export async function ingestStream(src: Source, db: DatabaseSync, run: { force: boolean; version: string | null }): Promise<number> {
  const started = Date.now();
  const rl = readline.createInterface({ input: src.input, crlfDelay: Infinity });

  let streamError: Error | null = null;
  src.input.on('error', (err) => {
    streamError = err;
    rl.close();
  });

  const insertStmt = db.prepare(INSERT_SQL);
  let headers: string[] | null = null;
  let populationSource: 'joint' | 'exomes+genomes' | 'none' = 'none';
  let colIndex = new Map<string, number>();
  let rows = 0;
  const rowsByChr = new Map<string, number>();
  const policy = zeroCounts();
  const checkedChr = new Set<string>();
  let inTx = false;

  db.exec('BEGIN TRANSACTION;');
  inTx = true;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const parts = line.split('\t');

      if (headers === null) {
        headers = parts.map(h => h.trim());
        colIndex = indexColumns(headers);
        console.log(`[Ingest] Mapped headers: found ${headers.length} columns.`);
        populationSource = colIndex.has('gnomAD4.1_joint_AC') ? 'joint'
          : colIndex.has('gnomAD_exomes_AC') || colIndex.has('gnomad_exomes_ac') ? 'exomes+genomes'
          : 'none';
        // Said at the top of every file, because a gap here is silent downstream (NULL reads as "not reported").
        console.log(`[Ingest] Population counts: ${populationSource === 'joint' ? 'gnomAD v4.1 joint (exomes+genomes)' : populationSource === 'exomes+genomes' ? 'gnomAD exomes + genomes, summed' : 'NO gnomAD count columns recognised — gnomad_* will be NULL'}; ` +
          `All of Us AC/AN: ${['AllofUs_ALL_AC', 'AoU_AC', 'aou_ac'].some(c => colIndex.has(c)) ? 'found' : 'not found'}.`);
        continue;
      }

      const getVal = (colNames: string[]): string => {
        for (const colName of colNames) {
          const idx = colIndex.get(colName);
          if (idx !== undefined) return parts[idx] ?? '';
        }
        return '';
      };

      const txList = getVal(['Ensembl_transcriptid', 'ensembl_transcriptid']);
      const txCount = txList ? txList.split(';').length : 1;
      const maneValue = getVal(['MANE', 'MANE_Select', 'mane']);
      // Stop at the FIRST row we cannot read: batches commit as they go, so a late failure would leave
      // most of a chromosome stored under the wrong transcript.
      const unreadable = unrecognisedManeValue(maneValue);
      if (unreadable !== null) {
        throw new Error(
          `${src.label}: MANE column holds "${unreadable}", which this loader does not recognise ` +
            `(expected Select / Plus_Clinical / MANE_Select). Refusing to fall back to the first-listed transcript.`
        );
      }
      // `Ensembl_canonical` in dbNSFP >= 5, `VEP_canonical` before.
      const choice = chooseTranscriptIndex(maneValue, getVal(['Ensembl_canonical', 'VEP_canonical', 'vep_canonical']), txCount);
      const at = (cols: string[]) => pick(getVal(cols), choice.index, txCount);

      const gene = at(['genename', 'geneName', 'gene_name']);
      const posVal = parseIntInt(at(['aapos', 'aaPos', 'aa_pos']));

      if (!gene || posVal === null || posVal <= 0) continue;
      const transcript = txList ? pick(txList, choice.index, txCount) || null : null;
      const chr = getVal(['#chr', 'chr']) || null;
      const chrKey = chr ?? 'unknown';
      if (!checkedChr.has(chrKey)) {
        checkedChr.add(chrKey);
        assertChromosomeNotRecorded(db, chrKey, run.force, src.label);
      }
      const posGenomic = parseIntInt(getVal(['pos(1-based)', 'hg38_pos(1-based)']));
      const aaref = at(['aaref']) || null;
      const aaalt = at(['aaalt']) || null;

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
      const popeve = parseFloater(getVal(['popEVE_score', 'popeve', 'POPEVE']));
      const cadd = parseFloater(getVal(['CADD_phred', 'cadd_phred', 'cadd']));

      const sumReported = (cols: [string[], string[]]): number | null => {
        const [a, b] = cols.map(c => parseIntInt(getVal(c)));
        return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
      };
      // dbNSFP >= 5 ships ONE combined exomes+genomes cohort (gnomAD v4.1 "joint"): use it as is — summing
      // it with anything would double count. Older releases carry exomes and genomes apart.
      const gnomad_ac = populationSource === 'joint'
        ? parseIntInt(getVal(['gnomAD4.1_joint_AC']))
        : sumReported([['gnomAD_exomes_AC', 'gnomad_exomes_ac'], ['gnomAD_genomes_AC', 'gnomad_genomes_ac']]);
      const gnomad_an = populationSource === 'joint'
        ? parseIntInt(getVal(['gnomAD4.1_joint_AN']))
        : sumReported([['gnomAD_exomes_AN', 'gnomad_exomes_an'], ['gnomAD_genomes_AN', 'gnomad_genomes_an']]);
      const gnomad_hom = populationSource === 'joint'
        ? parseIntInt(getVal(['gnomAD4.1_joint_nhomalt']))
        : sumReported([['gnomAD_exomes_nhomalt', 'gnomad_exomes_hom'], ['gnomAD_genomes_nhomalt', 'gnomad_genomes_hom']]);

      // (5.4a: `AllofUs_ALL_AC/AN`; it ships no AoU het/hom columns, so those stay NULL = not reported.)
      const aou_ac = parseIntInt(getVal(['AllofUs_ALL_AC', 'AoU_AC', 'aou_ac']));
      const aou_an = parseIntInt(getVal(['AllofUs_ALL_AN', 'AoU_AN', 'aou_an']));
      const aou_het = parseIntInt(getVal(['AoU_het', 'AoU_het_count', 'aou_het']));
      const aou_hom = parseIntInt(getVal(['AoU_hom', 'AoU_hom_count', 'aou_hom']));

      insertStmt.run(
        gene, chr, posGenomic, transcript, aaref, aaalt, posVal, ref, alt, aa_change,
        revel, alphamissense, gerp, phylop, bayesdel,
        metarnn, clinpred, dann, eigen, esm1b, popeve, cadd,
        gnomad_ac, gnomad_an, gnomad_hom,
        aou_ac, aou_an, aou_het, aou_hom,
        choice.basis
      );
      // Counted for STORED rows only, so `transcript_pick_counts` sums to the table (rows skipped above for
      // having no residue on the chosen transcript are not picks).
      policy[choice.basis] += 1;

      rows++;
      rowsByChr.set(chrKey, (rowsByChr.get(chrKey) ?? 0) + 1);
      if (rows % BATCH_SIZE === 0) {
        db.exec('COMMIT;');
        db.exec('BEGIN TRANSACTION;');
      }
      if (rows % PROGRESS_EVERY === 0) {
        const secs = (Date.now() - started) / 1000;
        console.log(`[Ingest]   ${src.label}: ${fmt(rows)} rows, ${fmt(Math.round(rows / Math.max(secs, 0.001)))} rows/s`);
      }
    }

    if (streamError) {
      throw new Error(`Ingest stream FAILED: ${(streamError as Error).message}`);
    }
    if (headers === null) throw new Error(`${src.label}: no header line found. Is this a dbNSFP variant file?`);

    recordSource(db, { rowsByChr, policy, label: src.label, version: run.version });
    db.exec('COMMIT;');
    inTx = false;
  } catch (err) {
    if (inTx) db.exec('ROLLBACK;');
    throw err;
  } finally {
    rl.close();
  }

  if (inTx) db.exec('COMMIT;');
  return rows;
}

export function buildGeneNumbering(db: DatabaseSync): void {
  const start = Date.now();
  console.log(`[Ingest] Building gene_numbering lookup table...`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gene_numbering (
      gene TEXT PRIMARY KEY,
      transcript TEXT,
      basis TEXT NOT NULL
    );
  `);
  const rows = db.prepare(
    "SELECT gene, transcript_basis AS basis, transcript FROM variant_scores GROUP BY 1, 2, 3"
  ).all() as Array<{ gene: string; basis: string | null; transcript: string | null }>;
  const byGene = new Map<string, Array<{ basis: string | null; transcript: string | null }>>();
  for (const r of rows) {
    if (!r.gene) continue;
    const g = r.gene.trim().toUpperCase();
    let list = byGene.get(g);
    if (!list) {
      list = [];
      byGene.set(g, list);
    }
    list.push({ basis: r.basis, transcript: r.transcript });
  }
  const ins = db.prepare("INSERT OR REPLACE INTO gene_numbering (gene, transcript, basis) VALUES (?, ?, ?);");
  db.exec("BEGIN TRANSACTION;");
  try {
    db.exec("DELETE FROM gene_numbering;");
    for (const [g, groups] of byGene) {
      // MUST equal `deriveGeneNumbering` in server/services/prediction/dbnsfp-reader-core.ts. It is
      // repeated rather than imported because tools/rebuild_dbnsfp.sh runs this file alone inside the
      // runner image, where server/ sources are not present; dbnsfp_local.test.ts fails if the two
      // disagree on any fixture gene. Genes without per-row bases are left out: the reader treats a
      // missing row as "scan", which keeps the line-level rule for them.
      if (!groups.some(x => typeof x.basis === "string")) continue;
      const at = (basis: string) => new Set(groups.filter(x => x.basis === basis && x.transcript).map(x => x.transcript as string));
      const any = new Set(groups.filter(x => x.basis !== "first-listed" && x.transcript).map(x => x.transcript as string));
      const pick = (set: Set<string>) => (set.size === 1 ? [...set][0] : null);
      const mane = at("mane");
      const canonical = at("ensembl-canonical");
      const res = mane.size > 0
        ? { transcript: pick(mane), basis: "mane" }
        : canonical.size > 0
          ? { transcript: pick(canonical), basis: "ensembl-canonical" }
          : { transcript: pick(any), basis: "unknown" };
      ins.run(g, res.transcript, res.basis);
    }
    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
  console.log(`[Ingest]   gene_numbering built (${fmt(byGene.size)} genes) in ${((Date.now() - start) / 1000).toFixed(1)} s`);
}

export function buildIndexes(db: DatabaseSync): void {
  for (const idx of INDEXES) {
    const start = Date.now();
    console.log(`[Ingest] Building index ${idx.name} on (${idx.columns})...`);
    db.exec(`CREATE INDEX IF NOT EXISTS ${idx.name} ON variant_scores (${idx.columns});`);
    console.log(`[Ingest]   done in ${((Date.now() - start) / 1000).toFixed(1)} s`);
  }
  buildGeneNumbering(db);
  const now = new Date().toISOString();
  db.prepare("INSERT OR REPLACE INTO build_meta (key, value) VALUES ('indexes_built_at', ?);").run(now);
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function parseCliArgs(argv: string[], env: Record<string, string | undefined> = process.env): IngestOptions {
  let dbPath: string | null = null;
  const sources: string[] = [];
  let version: string | null = env.DBNSFP_VERSION?.trim() || null;
  let deleteAfterIngest = false;
  let skipIndexes = false;
  let indexesOnly = false;
  let force = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      help = true;
    } else if (a === '--db') {
      dbPath = argv[++i];
    } else if (a === '--version') {
      version = argv[++i];
    } else if (a === '--delete-after-ingest') {
      deleteAfterIngest = true;
    } else if (a === '--skip-indexes') {
      skipIndexes = true;
    } else if (a === '--indexes-only') {
      indexesOnly = true;
    } else if (a === '--force') {
      force = true;
    } else if (a.startsWith('-') && a !== '-') {
      throw new Error(`Unknown option: ${a}. Run with --help for usage.`);
    } else {
      sources.push(a);
    }
  }

  if (!dbPath && sources.length > 0) {
    const last = sources[sources.length - 1];
    if (last !== '-' && /\.(sqlite|db)$/i.test(last)) {
      dbPath = sources.pop()!;
    }
  }

  if (indexesOnly && sources.length > 0) {
    throw new Error(`--indexes-only takes no inputs, only the store. Got: ${sources.join(', ')}`);
  }
  if (!indexesOnly && !help && sources.length === 0) {
    throw new Error('no inputs specified. Run with --help for usage.');
  }
  if (version && !/^\d+(\.\d+)*[a-z]?$/i.test(version)) {
    throw new Error(`--version '${version}' does not look like a dbNSFP release`);
  }

  dbPath = dbPath ?? env.DBNSFP_SQLITE_PATH?.trim() ?? DEFAULT_DB_PATH;

  return { dbPath, sources, version, deleteAfterIngest, skipIndexes, indexesOnly, force, help };
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }

  if (opts.indexesOnly) {
    if (!fs.existsSync(opts.dbPath)) {
      throw new Error(`Store does not exist: ${opts.dbPath}`);
    }
    const db = openStore(opts.dbPath, false);
    try {
      buildIndexes(db);
    } finally {
      db.close();
    }
    console.log(`[Ingest] Indexes built successfully on ${opts.dbPath}`);
    return;
  }

  const db = openStore(opts.dbPath, true);
  try {
    const version = opts.version ?? (opts.sources.length === 1 && opts.sources[0] !== '-' ? versionFromFilename(opts.sources[0]) : null);
    assertVersionCompatible(db, version, opts.force);

    let total = 0;
    for (const srcPath of opts.sources) {
      const src = srcPath === '-' ? await openStdinSource() : openFileSource(srcPath);
      const v = opts.version ?? (srcPath !== '-' ? versionFromFilename(srcPath) : null);
      assertVersionCompatible(db, v, opts.force);
      console.log(`[Ingest] Ingesting ${src.label}...`);
      const count = await ingestStream(src, db, { force: opts.force, version: v });
      total += count;
      console.log(`[Ingest] Committed ${fmt(count)} rows from ${src.label}`);

      if (opts.deleteAfterIngest && src.filePath) {
        await src.closed;
        try {
          db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        } catch {}
        try {
          fs.unlinkSync(src.filePath);
          console.log(`[Ingest] Deleted ${src.filePath} (--delete-after-ingest)`);
        } catch (err: any) {
          console.warn(`[Ingest] Could not delete ${src.filePath}: ${err?.message ?? err}`);
        }
      }
    }

    if (!opts.skipIndexes) {
      buildIndexes(db);
    }
    console.log(`[Ingest] Total ingested: ${fmt(total)} rows into ${opts.dbPath}`);
  } finally {
    db.close();
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((err) => {
    const msg = err?.message || String(err);
    const prefix = /FAILED/i.test(msg) ? '' : 'FAILED: ';
    console.error(`[Ingest Error] ${prefix}${msg}`);
    process.exit(1);
  });
}
