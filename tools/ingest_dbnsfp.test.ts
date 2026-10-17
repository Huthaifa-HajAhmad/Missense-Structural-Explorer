import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { parseCliArgs, parseFloater, versionFromFilename } from './ingest_dbnsfp.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'tools', 'ingest_dbnsfp.ts');

/** The dbNSFP v5 columns the ingest reads, in a plausible order. */
const HEADER_COLS = [
  '#chr', 'pos(1-based)', 'ref', 'alt', 'aaref', 'aaalt', 'aapos', 'genename',
  'Ensembl_transcriptid', 'MANE', 'VEP_canonical', 'aachange',
  'REVEL_score', 'AlphaMissense_score', 'GERP++_RS', 'phyloP100way_vertebrate',
  'BayesDel_noAF_score', 'MetaRNN_score', 'ClinPred_score', 'DANN_score', 'Eigen-phred', 'ESM1b_score', 'CADD_phred',
  'gnomAD_exomes_AC', 'gnomAD_exomes_AN', 'gnomAD_genomes_AC', 'gnomAD_genomes_AN',
  'gnomAD_exomes_nhomalt', 'gnomAD_genomes_nhomalt', 'AoU_AC', 'AoU_AN',
];

const header = HEADER_COLS.join('\t') + '\n';
const line = (r: Record<string, string>) => HEADER_COLS.map(c => r[c] ?? '.').join('\t') + '\n';

// chr1 single-transcript row (fills the ensembl-canonical slot as "single").
const R1 ={ '#chr': '1', 'pos(1-based)': '100', ref: 'C', alt: 'A', aaref: 'Q', aaalt: 'H', aapos: '867', genename: 'TEST', Ensembl_transcriptid: 'ENST00000001', aachange: 'p.Gln867His', REVEL_score: '0.912345', AlphaMissense_score: '0.8', gnomAD_exomes_AC: '2', gnomAD_genomes_AC: '1', gnomAD_exomes_AN: '1000', gnomAD_genomes_AN: '500', AoU_AC: '3', AoU_AN: '100' };
// chr1 multi-transcript row: the MANE Select entry is the second one, so residue 867 and REVEL 0.2 must win.
const R2 ={ '#chr': '1', 'pos(1-based)': '101', ref: 'G', alt: 'T', aaref: 'Q', aaalt: 'H', aapos: '500;867', genename: 'TEST;TEST', Ensembl_transcriptid: 'ENST00000009;ENST00000002', MANE: '.;MANE_Select', VEP_canonical: '.;.', aachange: 'p.Ala500Thr;p.Gln867His', REVEL_score: '0.1;0.2', AlphaMissense_score: '0.3;0.4' };
// chr2 row, a different gene.
const R3 ={ '#chr': '2', 'pos(1-based)': '5', ref: 'A', alt: 'G', aaref: 'N', aaalt: 'S', aapos: '42', genename: 'OTHER', Ensembl_transcriptid: 'ENST00000003', aachange: 'p.Asn42Ser', CADD_phred: '25.55555' };

function fixtureText(withHeader: boolean, rows: Record<string, string>[]): string {
  return (withHeader ? header : '') + rows.map(line).join('');
}

function gz(buf: string | Buffer): Buffer {
  return zlib.gzipSync(buf);
}

function runCli(args: string[], input?: Buffer | string) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: repoRoot,
    input,
    encoding: 'utf8',
    env: { ...process.env, DBNSFP_VERSION: '' },
    timeout: 120000,
  });
}

function withDb<T>(dbPath: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const meta = (db: DatabaseSync, key: string) =>
  (db.prepare('SELECT value FROM build_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-dbnsfp-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('ingest_dbnsfp helpers', () => {
  it('rounds stored scores to four decimal places and keeps the first value of a list', () => {
    expect(parseFloater('0.912345')).toBe(0.9123);
    expect(parseFloater('0.91235;0.1')).toBe(0.9124);
    expect(parseFloater('.')).toBeNull();
    expect(parseFloater('NA')).toBeNull();
  });

  it('reads the dbNSFP release from the file name', () => {
    expect(versionFromFilename('/data/dbNSFP5.3a_variant.chr1.gz')).toBe('5.3a');
    expect(versionFromFilename('dbNSFP5.1a_variant.chrX.bgz')).toBe('5.1a');
    expect(versionFromFilename('something.tsv')).toBeNull();
  });

  it('treats a .sqlite positional as the store and everything else as input', () => {
    const opts = parseCliArgs(['-', 'data/x.sqlite', '--version', '5.3a'], {});
    expect(opts.dbPath).toBe('data/x.sqlite');
    expect(opts.sources).toEqual(['-']);
    expect(opts.version).toBe('5.3a');
  });

  it('rejects a missing input and a malformed version before touching anything', () => {
    expect(() => parseCliArgs(['--db', 'x.sqlite'], {})).toThrow(/no inputs/);
    expect(() => parseCliArgs(['a.tsv', '--version', 'five'], {})).toThrow(/does not look like a dbNSFP release/);
    expect(() => parseCliArgs(['--indexes-only', 'a.tsv'], {})).toThrow(/takes no inputs/);
  });
});

describe('ingest_dbnsfp CLI', () => {
  it.each([false, true])('upgrades a legacy store without losing rows (indexes-only first: %s)', (indexesFirst) => {
    const first = path.join(tmp, 'dbNSFP5.3a_variant.chr1.tsv');
    const next = path.join(tmp, 'dbNSFP5.3a_variant.chr2.tsv');
    const db = path.join(tmp, 'legacy.sqlite');
    fs.writeFileSync(first, fixtureText(true, [R1]));
    fs.writeFileSync(next, fixtureText(true, [R3]));
    const created = runCli([first, '--db', db, '--skip-indexes']);
    expect(created.status, created.stderr).toBe(0);
    withDb(db, d => {
      for (const column of ['chr', 'pos_genomic', 'transcript', 'aaref', 'aaalt']) d.exec(`ALTER TABLE variant_scores DROP COLUMN ${column}`);
    });
    if (indexesFirst) {
      const indexed = runCli(['--db', db, '--indexes-only']);
      expect(indexed.status, indexed.stderr).toBe(0);
    }
    const loaded = runCli([next, '--db', db]);
    expect(loaded.status, loaded.stderr).toBe(0);
    withDb(db, d => {
      expect(d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get()).toEqual({ n: 2 });
      expect(d.prepare("SELECT revel, chr, transcript FROM variant_scores WHERE gene='TEST'").get()).toEqual({ revel: 0.9123, chr: null, transcript: null });
      expect(d.prepare("SELECT chr, pos_genomic FROM variant_scores WHERE gene='OTHER'").get()).toEqual({ chr: '2', pos_genomic: 5 });
      expect(meta(d, 'rows:1')).toBe('1');
      expect(meta(d, 'rows:2')).toBe('1');
    });
    // Reopening an upgraded store must not repeat ALTERs or damage index creation.
    const reopened = runCli(['--db', db, '--indexes-only']);
    expect(reopened.status, reopened.stderr).toBe(0);
  });
  it('ingests a plain file and a gzip file detected by magic bytes (not extension) by path, then builds indexes', () => {
    const plain = path.join(tmp, 'dbNSFP5.3a_variant.chr1.tsv');
    const gzipped = path.join(tmp, 'dbNSFP5.3a_variant.chr2.txt');
    fs.writeFileSync(plain, fixtureText(true, [R1, R2]));
    fs.writeFileSync(gzipped, gz(fixtureText(true, [R3])));
    const db = path.join(tmp, 'store.sqlite');

    const res = runCli([plain, gzipped, '--db', db]);
    expect(res.status, res.stderr).toBe(0);

    withDb(db, (d) => {
      expect((d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get() as { n: number }).n).toBe(3);
      const picked = d.prepare("SELECT transcript, pos, revel, aa_change FROM variant_scores WHERE gene = 'TEST' AND ref = 'G'").get() as Record<string, unknown>;
      expect(picked).toEqual({ transcript: 'ENST00000002', pos: 867, revel: 0.2, aa_change: 'p.Gln867His' });
      expect(d.prepare("SELECT revel FROM variant_scores WHERE gene = 'TEST' AND ref = 'C'").get()).toEqual({ revel: 0.9123 });

      expect(meta(d, 'dbnsfp_version')).toBe('5.3a');
      expect(meta(d, 'rows:1')).toBe('2');
      expect(meta(d, 'rows:2')).toBe('1');
      expect(meta(d, 'transcript_policy')).toBe('mane');
      expect(meta(d, 'ingested_at')).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const indexes = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'variant_scores'").all() as Array<{ name: string }>).map(r => r.name);
      expect(indexes).toEqual(expect.arrayContaining(['idx_gene_pos', 'idx_variant_scores_gene_pos_ref_alt', 'idx_chr_pos_genomic_ref_alt']));
    });
  });

  it('keeps a reported zero count as 0, and leaves an unreported one null', () => {
    // 0 homozygotes in a well-covered cohort is evidence (PM2/BS2), not missing data.
    const zero = { ...R3, gnomAD_exomes_AC: '0', gnomAD_exomes_AN: '1000', gnomAD_exomes_nhomalt: '0', gnomAD_genomes_nhomalt: '0', AoU_AC: '0', AoU_AN: '200' };
    const file = path.join(tmp, 'dbNSFP5.3a_variant.chr2.tsv');
    fs.writeFileSync(file, fixtureText(true, [zero, { ...R1 }]));
    const db = path.join(tmp, 'store.sqlite');
    const res = runCli([file, '--db', db]);
    expect(res.status, res.stderr).toBe(0);
    withDb(db, (d) => {
      expect(d.prepare("SELECT gnomad_ac, gnomad_an, gnomad_hom, aou_ac, aou_an FROM variant_scores WHERE gene = 'OTHER'").get())
        .toEqual({ gnomad_ac: 0, gnomad_an: 1000, gnomad_hom: 0, aou_ac: 0, aou_an: 200 });
      // R1 reports no homozygote field at all: unknown, not zero.
      expect(d.prepare("SELECT gnomad_hom, gnomad_ac FROM variant_scores WHERE gene = 'TEST'").get())
        .toEqual({ gnomad_hom: null, gnomad_ac: 3 });
    });
  });

  it('reads stdin gzip made of two concatenated members (bgzip-style) and loses no rows', () => {
    const part1 = fixtureText(true, [R1]);
    const part2 = fixtureText(false, [R2, R3]);
    const input = Buffer.concat([gz(part1), gz(part2)]);
    const db = path.join(tmp, 'stdin.sqlite');

    const res = runCli(['-', '--db', db, '--version', '5.3a'], input);
    expect(res.status, res.stderr).toBe(0);

    withDb(db, (d) => {
      // Part one holds R1; part two holds R2 and R3 with no header of its own.
      expect((d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get() as { n: number }).n).toBe(3);
      expect(meta(d, 'rows:1')).toBe('2');
      expect(meta(d, 'rows:2')).toBe('1');
      expect(meta(d, 'dbnsfp_version')).toBe('5.3a');
    });
  });

  it('reads plain text from stdin as well', () => {
    const db = path.join(tmp, 'plain-stdin.sqlite');
    const res = runCli(['-', '--db', db], fixtureText(true, [R1, R3]));
    expect(res.status, res.stderr).toBe(0);
    withDb(db, (d) => {
      expect((d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get() as { n: number }).n).toBe(2);
      // No version given and no file name to read it from: the store says so instead of guessing.
      expect(meta(d, 'dbnsfp_version')).toBeNull();
    });
  });

  it('deletes a file only after its commit with --delete-after-ingest, and never touches stdin', () => {
    const plain = path.join(tmp, 'dbNSFP5.3a_variant.chr1.tsv');
    fs.writeFileSync(plain, fixtureText(true, [R1, R2]));
    const db = path.join(tmp, 'del.sqlite');

    const res = runCli([plain, '--db', db, '--delete-after-ingest']);
    expect(res.status, res.stderr).toBe(0);
    expect(fs.existsSync(plain)).toBe(false);
    withDb(db, (d) => {
      expect((d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get() as { n: number }).n).toBe(2);
    });

    const stdinDb = path.join(tmp, 'del-stdin.sqlite');
    const r2 = runCli(['-', '--db', stdinDb, '--delete-after-ingest', '--version', '5.3a'], fixtureText(true, [R1]));
    expect(r2.status, r2.stderr).toBe(0);
  });

  it('defers indexes with --skip-indexes and builds them later with --indexes-only', () => {
    const plain = path.join(tmp, 'dbNSFP5.3a_variant.chr1.tsv');
    fs.writeFileSync(plain, fixtureText(true, [R1, R2]));
    const db = path.join(tmp, 'deferred.sqlite');

    expect(runCli([plain, '--db', db, '--skip-indexes']).status).toBe(0);
    const indexNames = () => withDb(db, (d) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'variant_scores'").all() as Array<{ name: string }>).map(r => r.name));
    expect(indexNames()).not.toContain('idx_gene_pos');

    const res = runCli(['--indexes-only', db]);
    expect(res.status, res.stderr).toBe(0);
    expect(indexNames()).toEqual(expect.arrayContaining(['idx_gene_pos', 'idx_chr_pos_genomic_ref_alt']));
  });

  it('refuses to load a chromosome that is already recorded, unless --force', () => {
    const plain = path.join(tmp, 'dbNSFP5.3a_variant.chr1.tsv');
    fs.writeFileSync(plain, fixtureText(true, [R1, R2]));
    const db = path.join(tmp, 'twice.sqlite');

    expect(runCli([plain, '--db', db]).status).toBe(0);
    const again = runCli([plain, '--db', db]);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toMatch(/already recorded in build_meta/);
    withDb(db, (d) => {
      expect((d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get() as { n: number }).n).toBe(2);
    });

    expect(runCli([plain, '--db', db, '--force']).status).toBe(0);
  });

  it('fails on a truncated gzip stream and commits none of its rows', () => {
    const full = gz(fixtureText(true, [R1, R2, R3]));
    const truncated = full.subarray(0, full.length - 12);
    const db = path.join(tmp, 'truncated.sqlite');

    const res = runCli(['-', '--db', db, '--version', '5.3a'], truncated);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/FAILED/);
    withDb(db, (d) => {
      expect((d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get() as { n: number }).n).toBe(0);
    });
  });

  it('refuses a version mismatch with an existing store', () => {
    const plain = path.join(tmp, 'dbNSFP5.3a_variant.chr1.tsv');
    fs.writeFileSync(plain, fixtureText(true, [R1, R2]));
    const db = path.join(tmp, 'mixed.sqlite');
    expect(runCli([plain, '--db', db]).status).toBe(0);

    const other = path.join(tmp, 'dbNSFP5.2a_variant.chr2.tsv');
    fs.writeFileSync(other, fixtureText(true, [R3]));
    const res = runCli([other, '--db', db]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/built from dbNSFP 5\.3a/);
  });

  it('documents the disk-constrained unzip pipeline in --help and exits 0', () => {
    const res = runCli(['--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('unzip -p');
    expect(res.stdout).toContain('--skip-indexes');
    expect(res.stdout).toContain('--indexes-only');
  });
});
