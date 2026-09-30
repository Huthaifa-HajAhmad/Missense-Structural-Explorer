import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import {
  buildRaspSqliteDatabase,
  RASP_INDEX_SCHEMA_VERSION,
} from "../../server/services/stability/build-rasp-sqlite.ts";
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
  /**
   * Restore spies structurally rather than at the end of each test body.
   *
   * `vi.spyOn(fs, "renameSync")` was restored on the last line of the test, so an assertion failing
   * before it leaked a call-through spy into every later test in the file — `vite.config.ts` sets no
   * `restoreMocks` and `src/test/setup.ts` never restores either. No corruption today, but the
   * restore should not depend on a test reaching its own final line.
   */
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("leaves the existing target intact when the build fails AFTER writing every row", async () => {
    // The sentinel test above fails at the missing-CSV precondition, before staging is even opened,
    // so it cannot tell an atomic build from a direct-write one. This forces the failure at the
    // LAST step — the swap — by making the target un-replaceable: a non-empty directory occupies
    // the path, so `renameSync` throws with a fully written, verified index in staging.
    const occupant = path.join(dbPath, "occupant.txt");
    fs.mkdirSync(dbPath, { recursive: true });
    fs.writeFileSync(occupant, "the previous index lives here");

    writeCsv([
      "P00439,A,1pdb,A,R408H,1.45,,",
      "P01112,B,2pdb,B,G12V,2.54,,",
    ]);

    /**
     * Pin the failure to the SWAP, not merely to "something threw".
     *
     * `rejects.toThrow()` alone does not prove this test protects atomicity, and a mutation check
     * proved it: reinstating the removed `if (fs.existsSync(dbPath)) fs.rmSync(dbPath);` makes a
     * non-recursive unlink throw ERR_FS_EISDIR *before* the swap, and all three assertions still
     * passed — the occupant was never at risk, and `.building` was absent because it was never
     * staged. The test looked like it guarded the window and did not.
     *
     * Spying on `renameSync` is platform-independent (the raw OS error differs between Windows and
     * POSIX) and fails for exactly one reason: the build never reached the swap, which is what an
     * unlink before it means.
     */
    const renameSpy = vi.spyOn(fs, "renameSync");

    await expect(buildRaspSqliteDatabase(csvPath, dbPath)).rejects.toThrow();

    expect(
      renameSpy,
      "the build must fail AT the swap; if the rename was never attempted, an unlink ran before it"
    ).toHaveBeenCalled();

    // The occupant is byte-identical and no half-built file is left behind.
    expect(fs.readFileSync(occupant, "utf-8")).toBe("the previous index lives here");
    expect(fs.existsSync(`${dbPath}.building`)).toBe(false);

    renameSpy.mockRestore();
  });

  it("replaces an existing index in place rather than unlinking it first", async () => {
    // The swap used to be `rmSync(target)` then `renameSync`, which opened a window with NO index at
    // all — worse than the truncated index this work set out to fix, because a kill inside it left
    // nothing to fall back on. `rename` replaces atomically, so the unlink was pure hazard.
    writeCsv(["P00439,A,1pdb,A,R408H,1.45,,"]);
    const first = await buildRaspSqliteDatabase(csvPath, dbPath);
    expect(first.rows).toBe(1);

    // Rebuild over the index that is already there — the case the unlink existed for. A spy is the
    // only way to catch its return: with a FILE at the target the unlink succeeds quietly, so the
    // build outcome is identical either way and the assertions below cannot tell them apart.
    const rmSpy = vi.spyOn(fs, "rmSync");
    writeCsv(["P00439,A,1pdb,A,R408H,1.45,,", "P01112,B,2pdb,B,G12V,2.54,,"]);
    const second = await buildRaspSqliteDatabase(csvPath, dbPath);

    expect(
      rmSpy.mock.calls.some((call: unknown[]) => String(call[0]) === dbPath),
      "the target index must never be unlinked before the swap; rename replaces it atomically"
    ).toBe(false);

    expect(second.rows).toBe(2);
    // The replacement really took effect: the new content is being served.
    expect(readCounts(dbPath).rows).toBe(2);
    expect(fs.existsSync(`${dbPath}.building`)).toBe(false);

    rmSpy.mockRestore();
  });

  it("closes its handle even when the build throws", async () => {
    // An open handle both leaks and, on Windows, blocks the staging cleanup — an open SQLite file
    // commonly refuses deletion. If the handle leaked, removing the staging directory fails.
    const occupant = path.join(dbPath, "occupant.txt");
    fs.mkdirSync(dbPath, { recursive: true });
    fs.writeFileSync(occupant, "occupied");
    writeCsv(["P00439,A,1pdb,A,R408H,1.45,,"]);

    await expect(buildRaspSqliteDatabase(csvPath, dbPath)).rejects.toThrow();

    // No staging file and no lock: the path can be removed straight away.
    expect(fs.existsSync(`${dbPath}.building`)).toBe(false);
    expect(() => fs.rmSync(dbPath, { recursive: true, force: true })).not.toThrow();
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

/**
 * Proteome-wide PRISM ingestion.
 *
 * The fixture follows the file the authors' `rasp_to_prism` writes through PrismData.PrismParser:
 * `# `-prefixed metadata (sequence included), a blank `#` line, then a whitespace table
 * `variant score_ml_fermi score_ml`. Positions in these files follow the full-length AlphaFold model,
 * i.e. UniProt numbering — except in `AF-<acc>-F2…` fragments, which are skipped rather than offset.
 */
function prism(seq: string, rows: string[], uniprot = "Unknown") {
  return [
    "# --------------------",
    "# version: 1",
    "# protein:",
    "#     name: Unknown",
    "#     organism: Unknown",
    `#     uniprot: ${uniprot}`,
    `#     sequence: ${seq}`,
    "#     pdb: AF",
    "#     chain: A",
    "# columns:",
    "#     score_ml_fermi: Normalized RaSP model ddG predictions (range [0;1])",
    "#     score_ml: Cavity model ddG predictions",
    "# --------------------",
    "#",
    "#",
    "variant score_ml_fermi score_ml",
    ...rows,
  ].join("\n") + "\n";
}

describe("parsePrismRaspFile", () => {
  it("reads score_ml (kcal/mol), not the [0,1] fermi transform, and the accession from the AF name", async () => {
    const { parsePrismRaspFile } = await import("../../server/services/stability/build-rasp-sqlite.ts");
    const parsed = parsePrismRaspFile(
      prism("MRAG", ["M1A 0.12 0.33", "R2W 0.81 2.40", "A3= 0.05 0.00"]),
      "/x/prism_rasp_AF-P00439-F1-model_v2.txt"
    );
    expect(parsed.uniprotId).toBe("P00439");
    expect(parsed.fragment).toBe(1);
    expect(parsed.rows).toEqual([
      { wt: "M", pos: 1, mut: "A", score: 0.33 },
      { wt: "R", pos: 2, mut: "W", score: 2.4 },
    ]);
    expect(parsed.skipped).toBe(1); // the synonymous row
  });

  it("drops a row whose wild type disagrees with the file's own sequence", async () => {
    const { parsePrismRaspFile } = await import("../../server/services/stability/build-rasp-sqlite.ts");
    const parsed = parsePrismRaspFile(prism("MRAG", ["G2A 0.5 1.0", "R2A 0.5 1.1"]), "AF-P01112-F1.txt");
    expect(parsed.rows.map(r => r.score)).toEqual([1.1]);
    expect(parsed.skipped).toBe(1);
  });

  it("falls back to the metadata accession and reports the fragment number", async () => {
    const { parsePrismRaspFile } = await import("../../server/services/stability/build-rasp-sqlite.ts");
    expect(parsePrismRaspFile(prism("MA", ["M1A 0.1 0.2"], "Q13564"), "pred.txt").uniprotId).toBe("Q13564");
    expect(parsePrismRaspFile(prism("MA", ["M1A 0.1 0.2"]), "AF-Q8WZ42-F7-model_v2.txt").fragment).toBe(7);
    expect(parsePrismRaspFile(prism("MA", ["M1A 0.1 0.2"]), "pred.txt").uniprotId).toBeNull();
  });
});

describe("buildRaspSqliteDatabase with a proteome directory", () => {
  it("ingests PRISM files beside the CSV, tags each row's source, and records per-source counts", async () => {
    writeCsv(["P00439,A,1pdb,A,R2W,1.45,Pathogenic,0.0001"]);
    const proteome = path.join(workDir, "proteome", "P0", "04", "39");
    fs.mkdirSync(proteome, { recursive: true });
    fs.writeFileSync(path.join(proteome, "prism_rasp_AF-P00439-F1-model_v2.txt"), prism("MRAG", ["R2W 0.81 2.40"]));
    fs.writeFileSync(path.join(proteome, "prism_rasp_AF-Q13564-F1-model_v2.txt"), prism("MDG", ["D2G 0.2 0.6"]));
    fs.writeFileSync(path.join(proteome, "prism_rasp_AF-Q8WZ42-F2-model_v2.txt"), prism("MA", ["M1A 0.1 0.2"]));
    fs.writeFileSync(path.join(proteome, "README.md"), "not a prism file\n");

    const result = await buildRaspSqliteDatabase(csvPath, dbPath, { proteomeDir: path.join(workDir, "proteome") });

    expect(result.rows).toBe(3);
    expect(result.proteins).toBe(2);
    expect(result.sources).toEqual({ experimental: 1, alphafold: 2 });
    expect(result.proteomeSkips).toEqual({ "AlphaFold fragment beyond F1": 1, "not a PRISM file": 1 });

    const db = new DatabaseSync(dbPath, { open: true });
    try {
      const meta = db.prepare("SELECT schema_version, sources FROM rasp_index_meta").get() as any;
      expect(meta.schema_version).toBe(3);
      expect(JSON.parse(meta.sources)).toEqual({ experimental: 1, alphafold: 2 });
      const bySource = db
        .prepare("SELECT source, rasp_score FROM rasp_variants WHERE uniprot_id = 'P00439' ORDER BY source")
        .all() as any[];
      expect(bySource).toEqual([
        { source: "alphafold", rasp_score: 2.4 },
        { source: "experimental", rasp_score: 1.45 },
      ]);
    } finally {
      db.close();
    }
  });

  it("builds from the proteome alone when no CSV is present", async () => {
    const proteome = path.join(workDir, "proteome");
    fs.mkdirSync(proteome, { recursive: true });
    fs.writeFileSync(path.join(proteome, "AF-Q13564-F1.txt"), prism("MDG", ["D2G 0.2 0.6"]));
    const result = await buildRaspSqliteDatabase(csvPath, dbPath, { proteomeDir: proteome });
    expect(result.sources).toEqual({ alphafold: 1 });
  });
});
