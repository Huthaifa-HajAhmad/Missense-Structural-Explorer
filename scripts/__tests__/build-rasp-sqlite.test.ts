import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import {
  buildRaspSqliteDatabase,
  RASP_INDEX_SCHEMA_VERSION,
} from "../build-rasp-sqlite.ts";
import { verifyRaspIndex, type RaspIndexMeta } from "../../src/shared/raspIndex.ts";

/**
 * The RaSP index shipped with this repository was truncated — 35,000 of 8,770,220 rows, the first
 * six proteins in file order — and the loader could not tell. These tests pin the two properties
 * that make that impossible: the build records its own completeness, and a failed build cannot
 * damage the index already in place.
 */

const CSV_HEADER =
  "uniprot_id,pdb_chain,pdb,chain_id,variant,RaSP;score_ml,clinvar;Clinvar_signifiance,gnomad;AF";

let workDir: string;
let csvPath: string;
let dbPath: string;

function writeCsv(lines: string[]) {
  fs.writeFileSync(csvPath, [CSV_HEADER, ...lines].join("\n") + "\n");
}

function readCounts(target: string) {
  const db = new DatabaseSync(target, { open: true });
  try {
    const rows = (db.prepare("SELECT COUNT(*) AS c FROM rasp_variants").get() as any).c as number;
    const proteins = (db.prepare("SELECT COUNT(DISTINCT uniprot_id) AS c FROM rasp_variants").get() as any).c as number;
    const meta = db
      .prepare("SELECT schema_version, rows, proteins, built_at FROM rasp_index_meta LIMIT 1")
      .get() as any;
    return { rows, proteins, meta };
  } finally {
    db.close();
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "rasp-build-test-"));
  csvPath = path.join(workDir, "df_rasp_gnomad_clinvar.csv");
  dbPath = path.join(workDir, "df_rasp_gnomad_clinvar.sqlite");
});

afterEach(() => {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch (_) {}
});

describe("buildRaspSqliteDatabase", () => {
  it("records the counts it actually produced", async () => {
    writeCsv([
      "P00439,A,1pdb,A,R408H,1.45,Pathogenic,0.0001",
      "P00439,A,1pdb,A,D12E,-0.32,Benign,0.05",
      "P01112,B,2pdb,B,G12V,2.54,Pathogenic,0.00001",
    ]);

    const result = await buildRaspSqliteDatabase(csvPath, dbPath);

    expect(result.rows).toBe(3);
    expect(result.proteins).toBe(2);
    expect(result.skipped).toBe(0);

    const { rows, proteins, meta } = readCounts(dbPath);
    expect(rows).toBe(3);
    expect(proteins).toBe(2);

    // The index carries its own completeness record, and the shared rule agrees it is usable.
    expect(meta).toBeTruthy();
    expect(meta.schema_version).toBe(RASP_INDEX_SCHEMA_VERSION);
    const verdict = verifyRaspIndex(
      { rows, proteins },
      {
        schemaVersion: meta.schema_version,
        rows: meta.rows,
        proteins: meta.proteins,
        builtAt: meta.built_at,
      } as RaspIndexMeta
    );
    expect(verdict.usable).toBe(true);
  });

  it("skips wild-type reference rows, which have no substitution to score", async () => {
    writeCsv([
      "A4D126,A,1cvh,A,S41A,0.83,,",
      "A4D126,A,1cvh,A,S41=,0.39,,", // wild-type reference row
      "A4D126,A,1cvh,A,S41C,1.43,,",
    ]);

    const result = await buildRaspSqliteDatabase(csvPath, dbPath);

    expect(result.rows).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it("reports the row count it verified, not the count it attempted", async () => {
    // A truncated read would show up here: the build counts what landed and refuses on mismatch.
    const lines: string[] = [];
    for (let i = 0; i < 250; i++) {
      lines.push(`P00439,A,1pdb,A,R${i + 1}H,${(i % 30) / 10},,`);
    }
    writeCsv(lines);

    const result = await buildRaspSqliteDatabase(csvPath, dbPath);
    const { rows, proteins } = readCounts(dbPath);

    expect(rows).toBe(250);
    expect(result.rows).toBe(rows);
    expect(proteins).toBe(1);
  });

  it("leaves an existing index untouched when the build fails", async () => {
    // A sentinel standing in for a known-good index.
    const SENTINEL = "this-is-the-previous-index";
    fs.writeFileSync(dbPath, SENTINEL);

    await expect(
      buildRaspSqliteDatabase(path.join(workDir, "does-not-exist.csv"), dbPath)
    ).rejects.toThrow(/CSV not found/);

    // The old index survives, and no half-built file is left where a later run might trust it.
    expect(fs.readFileSync(dbPath, "utf-8")).toBe(SENTINEL);
    expect(fs.existsSync(`${dbPath}.building`)).toBe(false);
  });

  it("does not create the target until the build has succeeded", async () => {
    writeCsv(["P00439,A,1pdb,A,R408H,1.45,,",]);

    expect(fs.existsSync(dbPath)).toBe(false);
    await buildRaspSqliteDatabase(csvPath, dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    // The staging file is renamed into place, never left behind.
    expect(fs.existsSync(`${dbPath}.building`)).toBe(false);
  });

  it("refuses to install an index with no rows", async () => {
    writeCsv([]);
    await expect(buildRaspSqliteDatabase(csvPath, dbPath)).rejects.toThrow(/no proteins/);
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
