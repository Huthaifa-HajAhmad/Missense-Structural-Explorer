import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { chooseTranscriptIndex, unrecognisedManeValue } from './ingest_dbnsfp.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'tools', 'ingest_dbnsfp.ts');

/**
 * dbNSFP 5.4a, as the archive actually writes it (read from dbNSFP5.4a_variant.chr22.gz):
 *   MANE = "Select" (".;.;Select"), Ensembl_canonical = "YES", gnomAD4.1_joint_* (one combined
 *   exomes+genomes cohort), AllofUs_ALL_AC/AN.
 * The loader once recognised none of these: it stored the FIRST-listed transcript for every
 * multi-transcript row (a different residue number than MANE's in about 21% of them) and no
 * population counts at all, and nothing failed.
 */
const COLS = [
  '#chr', 'pos(1-based)', 'ref', 'alt', 'aaref', 'aaalt', 'aapos', 'genename', 'Ensembl_transcriptid',
  'Ensembl_canonical', 'MANE', 'aachange', 'REVEL_score', 'CADD_phred',
  'gnomAD4.1_joint_AC', 'gnomAD4.1_joint_AN', 'gnomAD4.1_joint_nhomalt', 'AllofUs_ALL_AC', 'AllofUs_ALL_AN',
];

const text = (rows: Record<string, string>[], cols: string[] = COLS) =>
  cols.join('\t') + '\n' + rows.map(r => cols.map(c => r[c] ?? '.').join('\t')).join('\n') + '\n';

// IL17RA-shaped: the first-listed transcript numbers the residue 198, MANE Select numbers it 311.
const IL17RA = {
  '#chr': '22', 'pos(1-based)': '17100000', ref: 'C', alt: 'T', aaref: 'R', aaalt: 'W',
  aapos: '198;198;311', genename: 'IL17RA;IL17RA;IL17RA',
  Ensembl_transcriptid: 'ENST00000962147;ENST00000111111;ENST00000319363',
  Ensembl_canonical: '.;.;YES', MANE: '.;.;Select',
  aachange: 'p.Arg198Trp;p.Arg198Trp;p.Arg311Trp', REVEL_score: '0.1;0.2;0.9', CADD_phred: '25.1',
  'gnomAD4.1_joint_AC': '0', 'gnomAD4.1_joint_AN': '1500000', 'gnomAD4.1_joint_nhomalt': '0',
  AllofUs_ALL_AC: '3', AllofUs_ALL_AN: '400000',
};

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: repoRoot,
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-dbnsfp-54a-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('dbNSFP 5.4a column formats', () => {
  it('recognises "Select" as MANE Select and never treats Plus_Clinical as it', () => {
    expect(chooseTranscriptIndex('.;.;Select', '.;.;YES', 3)).toEqual({ index: 2, basis: 'mane' });
    expect(chooseTranscriptIndex('.;MANE_Select', '.;.', 2)).toEqual({ index: 1, basis: 'mane' });
    // Plus-Clinical is a second, clinically requested transcript: not the numbering basis.
    expect(chooseTranscriptIndex('Plus_Clinical;.;.', '.;.;YES', 3)).toEqual({ index: 2, basis: 'ensembl-canonical' });
    expect(chooseTranscriptIndex('.;.;.', '.;.;YES', 3)).toEqual({ index: 2, basis: 'ensembl-canonical' });
    expect(chooseTranscriptIndex('.;.', '.;.', 2)).toEqual({ index: 0, basis: 'first-listed' });
  });

  it('flags a MANE value it cannot read, and accepts every value it can', () => {
    expect(unrecognisedManeValue('.;.;Select')).toBeNull();
    expect(unrecognisedManeValue('Plus_Clinical;MANE_Select;.')).toBeNull();
    expect(unrecognisedManeValue('.;YES')).toBeNull();
    expect(unrecognisedManeValue('.;Primary')).toBe('Primary');
  });

  it('stores the MANE Select transcript residue, and the joint population counts including zeros', () => {
    const file = path.join(tmp, 'dbNSFP5.4a_variant.chr22.tsv');
    fs.writeFileSync(file, text([IL17RA]));
    const db = path.join(tmp, 'store.sqlite');
    const res = runCli([file, '--db', db]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('gnomAD v4.1 joint');
    withDb(db, (d) => {
      expect(
        d.prepare(
          'SELECT transcript, pos, aa_change, revel, gnomad_ac, gnomad_an, gnomad_hom, aou_ac, aou_an, aou_het, aou_hom FROM variant_scores'
        ).get()
      ).toEqual({
        transcript: 'ENST00000319363', pos: 311, aa_change: 'p.Arg311Trp', revel: 0.9,
        gnomad_ac: 0, gnomad_an: 1500000, gnomad_hom: 0, aou_ac: 3, aou_an: 400000, aou_het: null, aou_hom: null,
      });
      expect(meta(d, 'transcript_policy')).toBe('mane');
    });
  });

  it('refuses a MANE value it does not understand, before storing anything', () => {
    const file = path.join(tmp, 'dbNSFP5.4a_variant.chr22.tsv');
    fs.writeFileSync(file, text([{ ...IL17RA, MANE: '.;.;Primary' }]));
    const db = path.join(tmp, 'store.sqlite');
    const res = runCli([file, '--db', db]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('does not recognise');
    expect(res.stderr).toContain('Primary');
    withDb(db, (d) => {
      expect((d.prepare('SELECT COUNT(*) AS n FROM variant_scores').get() as { n: number }).n).toBe(0);
    });
  });

  it('says so when no gnomAD count columns are recognised, instead of silently storing NULLs', () => {
    const noPopulation = ['#chr', 'pos(1-based)', 'ref', 'alt', 'aaref', 'aaalt', 'aapos', 'genename', 'Ensembl_transcriptid', 'aachange'];
    const file = path.join(tmp, 'dbNSFP5.4a_variant.chr22.tsv');
    fs.writeFileSync(
      file,
      text([{ '#chr': '22', 'pos(1-based)': '5', ref: 'C', alt: 'T', aaref: 'R', aaalt: 'W', aapos: '10', genename: 'GENE1', Ensembl_transcriptid: 'ENST1', aachange: 'p.Arg10Trp' }], noPopulation)
    );
    const res = runCli([file, '--db', path.join(tmp, 'store.sqlite')]);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('NO gnomAD count columns recognised');
  });

  it('counts a lone transcript as single even when flagged canonical, so a chrM-like file does not turn the policy to mixed', () => {
    expect(chooseTranscriptIndex('.', 'YES', 1)).toEqual({ index: 0, basis: 'single' });
    expect(chooseTranscriptIndex('Select', 'YES', 1)).toEqual({ index: 0, basis: 'single' });

    const db = path.join(tmp, 'store.sqlite');
    const autosome = path.join(tmp, 'dbNSFP5.4a_variant.chr22.tsv');
    fs.writeFileSync(autosome, text([IL17RA]));
    const mito = path.join(tmp, 'dbNSFP5.4a_variant.chrM.tsv');
    fs.writeFileSync(
      mito,
      text([
        {
          '#chr': 'M', 'pos(1-based)': '3308', ref: 'T', alt: 'C', aaref: 'M', aaalt: 'T', aapos: '1',
          genename: 'MT-ND1', Ensembl_transcriptid: 'ENST00000361390', Ensembl_canonical: 'YES', MANE: '.',
          aachange: 'p.Met1Thr',
        },
      ])
    );
    expect(runCli([autosome, '--db', db]).status).toBe(0);
    expect(runCli([mito, '--db', db]).status).toBe(0);
    withDb(db, (d) => {
      expect(meta(d, 'transcript_policy')).toBe('mane');
      expect(d.prepare("SELECT count(*) AS n FROM variant_scores WHERE gene = 'MT-ND1'").get()).toEqual({ n: 1 });
      // How many rows each basis decided is kept, cumulatively, beside the one-word label.
      expect(JSON.parse(meta(d, 'transcript_pick_counts') as string)).toEqual({
        mane: 1, 'ensembl-canonical': 0, 'first-listed': 0, single: 1,
      });
    });
  });
});
