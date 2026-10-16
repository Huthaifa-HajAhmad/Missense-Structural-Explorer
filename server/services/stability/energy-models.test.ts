import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  lookupPrecomputedRaspScore,
  closeRaspResources,
  initializeRaspDatabase,
  runRaspLocal,
  enrichBiophysicalResult,
  RASP_STORE_UNAVAILABLE_REASON,
} from "./energy-models.ts";
import { buildRaspSqliteDatabase } from "./build-rasp-sqlite.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE CLIENT ACTUALLY RECEIVES FROM THE FOLDX LEG
 * ─────────────────────────────────────────────────────────────────────────────
 * `enrichBiophysicalResult` rebuilds `energetics` from a whitelist, and BOTH client paths go through
 * it (the poll route on completion, the generation route on a cache hit). A field the runner produces
 * and this builder omits does not exist as far as every surface is concerned — which is exactly what
 * happened to the repair disclosure and to the ensemble spread: they were written, shipped to the
 * server, and silently dropped, so the row that explains the ΔΔG's footing could never appear.
 *
 * These assertions are about the WIRE, not about the runner: they are the half that makes the
 * runner's `foldxRepairSkipped`/`foldxRepairCached`/`foldxSd` mean anything to a reader.
 */
describe("enrichBiophysicalResult — FoldX disclosure survives the response builder", () => {
  const baseFoldx = {
    pdb: "MUTANT_PDB",
    ddG: 1.2,
    status: "success" as const,
    foldedResidueIndex: 489,
  };

  it("carries the ensemble mean, spread and seed", () => {
    const out = enrichBiophysicalResult(
      { ...baseFoldx, energetics: { foldxMean: 1.2, foldxSd: 0.31, seed: 12345 } },
      null,
      null,
      489
    );
    expect(out.energetics.foldxMean).toBe(1.2);
    expect(out.energetics.foldxSd, "the spread the UI prints as ± must reach the UI").toBe(0.31);
    expect(out.energetics.seed).toBe(12345);
  });

  it("carries a skipped repair and the reason it was skipped", () => {
    const out = enrichBiophysicalResult(
      {
        ...baseFoldx,
        energetics: { foldxMean: 1.2, foldxRepairFailed: false, foldxRepairSkipped: true, foldxRepairSkippedReason: "large-structure" },
      },
      null,
      null,
      489
    );
    expect(out.energetics.foldxRepairSkipped).toBe(true);
    expect(out.energetics.foldxRepairSkippedReason).toBe("large-structure");
    // A skipped repair is NOT an exclusion: the consensus counts these values, and saying otherwise
    // on the row would misstate the arithmetic.
    expect(out.energetics.foldxRepairFailed).toBe(false);
  });

  it("carries reuse of a cached repair", () => {
    const out = enrichBiophysicalResult(
      { ...baseFoldx, energetics: { foldxMean: 1.2, foldxRepairCached: true } },
      null,
      null,
      489
    );
    expect(out.energetics.foldxRepairCached).toBe(true);
    // A reused repair is a repair: it must not be reported as skipped or failed.
    expect(out.energetics.foldxRepairSkipped).toBe(false);
    expect(out.energetics.foldxRepairFailed).toBe(false);
  });

  it("omits the reason and the reuse flag when they do not apply", () => {
    const out = enrichBiophysicalResult(
      { ...baseFoldx, energetics: { foldxMean: 1.2 } },
      null,
      null,
      489
    );
    expect(out.energetics.foldxRepairSkipped).toBe(false);
    expect(out.energetics.foldxRepairSkippedReason).toBeUndefined();
    expect(out.energetics.foldxRepairCached).toBeUndefined();
  });
});

describe("RaSP SQLite Database & Lookups Unit Tests", () => {
  // These resolve to the OS temp directory under test (setup.ts sets RASP_CSV_PATH /
  // RASP_SQLITE_PATH). They previously pointed at the repository, so this suite overwrote the
  // real 414 MB data/df_rasp_gnomad_clinvar.csv with the fixture below and restored it only in
  // afterAll — an interrupt or OOM destroyed it permanently.
  const dataDir = path.dirname(process.env.RASP_CSV_PATH ?? path.join(process.cwd(), "data", "x"));
  const tempCsvPath = process.env.RASP_CSV_PATH ?? path.join(dataDir, "df_rasp_gnomad_clinvar.csv");
  const tempSqlitePath = process.env.RASP_SQLITE_PATH ?? path.join(dataDir, "df_rasp_gnomad_clinvar.sqlite");

  let originalCsvExists = false;
  let originalSqliteExists = false;
  let originalCsvContent: Buffer | null = null;
  let originalSqliteContent: Buffer | null = null;

  beforeAll(async () => {
    closeRaspResources();

    if (fs.existsSync(tempCsvPath)) {
      originalCsvExists = true;
      originalCsvContent = fs.readFileSync(tempCsvPath);
    }
    if (fs.existsSync(tempSqlitePath)) {
      originalSqliteExists = true;
      originalSqliteContent = fs.readFileSync(tempSqlitePath);
    }

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write a mock CSV database
    const mockCsvContent = [
      "uniprot_id,pdb_chain,pdb,chain_id,variant,RaSP;score_ml,clinvar;Clinvar_signifiance,gnomad;AF",
      "P00439,X,X,X,R408H,1.45,Pathogenic,0.0001",
      "P00439,X,X,X,D12E,-0.32,Benign,0.05",
      "P01112,X,X,X,G12V,2.54,Pathogenic,0.00001",
      "P01112,X,X,X,Q61H,0.98,Likely pathogenic,0.00002",
      "P02340,X,X,X,V150F,3.12,Uncertain_significance,0.001"
    ].join("\n") + "\n";

    fs.writeFileSync(tempCsvPath, mockCsvContent);

    // Build SQLite database from mock CSV
    await buildRaspSqliteDatabase(tempCsvPath, tempSqlitePath);
    closeRaspResources();
  });

  afterAll(() => {
    closeRaspResources();

    const safeWrite = (filePath: string, content: Buffer) => {
      try {
        fs.writeFileSync(filePath, content);
      } catch (e) {
        console.warn(`[Test Cleanup] Failed to restore ${filePath}:`, e);
      }
    };

    const safeUnlink = (filePath: string) => {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {
        console.warn(`[Test Cleanup] Failed to unlink ${filePath}:`, e);
      }
    };

    if (originalCsvExists && originalCsvContent) {
      safeWrite(tempCsvPath, originalCsvContent);
    } else {
      safeUnlink(tempCsvPath);
    }

    if (originalSqliteExists && originalSqliteContent) {
      safeWrite(tempSqlitePath, originalSqliteContent);
    } else {
      safeUnlink(tempSqlitePath);
    }
  });

  it("should successfully lookup score in SQLite database for first protein", async () => {
    const result = await lookupPrecomputedRaspScore("P00439", 408, "Arg", "His");
    expect(result.score).toBeCloseTo(1.45, 2);
  });

  it("should successfully lookup negative (destabilizing) score in SQLite database", async () => {
    const result = await lookupPrecomputedRaspScore("P00439", 12, "Asp", "Glu");
    expect(result.score).toBeCloseTo(-0.32, 2);
  });

  it("should successfully lookup score in SQLite database for middle protein", async () => {
    const result = await lookupPrecomputedRaspScore("P01112", 12, "Gly", "Val");
    expect(result.score).toBeCloseTo(2.54, 2);
  });

  it("should successfully lookup score in SQLite database for last protein", async () => {
    const result = await lookupPrecomputedRaspScore("P02340", 150, "Val", "Phe");
    expect(result.score).toBeCloseTo(3.12, 2);
  });

  it("should return null for missing position in existing protein", async () => {
    const result = await lookupPrecomputedRaspScore("P00439", 999, "Ala", "Gly");
    expect(result.score).toBeNull();
    expect(result.reason).toBe("Residue position is not present in the pre-computed database");
  });

  it("should return null for missing protein in SQLite database", async () => {
    const result = await lookupPrecomputedRaspScore("P53000", 50, "Cys", "Trp");
    expect(result.score).toBeNull();
    expect(result.reason).toBe("Residue position is not present in the pre-computed database");
  });

  it("should initialize database without error when SQLite exists", async () => {
    await expect(initializeRaspDatabase()).resolves.toBeUndefined();
  });
});

/**
 * Durability of the index verdict and of the lookup cache.
 *
 * The failure these guard against is the one the whole RaSP contract exists to prevent: an engine
 * that produced a usable answer is *silently* reported as having nothing, with nothing logged and
 * nothing failing. The loader used to latch a one-shot `checked` boolean, conflating "this file is
 * bad" (a fact about the file) with "there is no usable file" (a fact about the deployment, which
 * changes the moment somebody rebuilds) — so a boot with a truncated index left RaSP off for the
 * life of the process, even after a correct index was in place.
 */
describe("RaSP index durability", () => {
  const dataDir = path.dirname(process.env.RASP_CSV_PATH ?? path.join(process.cwd(), "data", "x"));
  const tempCsvPath = process.env.RASP_CSV_PATH ?? path.join(dataDir, "df_rasp_gnomad_clinvar.csv");
  const tempSqlitePath = process.env.RASP_SQLITE_PATH ?? path.join(dataDir, "df_rasp_gnomad_clinvar.sqlite");

  const FULL_CSV = [
    "uniprot_id,pdb_chain,pdb,chain_id,variant,RaSP;score_ml,clinvar;Clinvar_signifiance,gnomad;AF",
    "P00439,X,X,X,R408H,1.45,Pathogenic,0.0001",
    "P01112,X,X,X,G12V,2.54,Pathogenic,0.00001",
  ].join("\n") + "\n";

  /** Rebuilds the shared fixture index WITHOUT touching the loader's cached verdict. */
  async function rebuildFixture(): Promise<void> {
    fs.writeFileSync(tempCsvPath, FULL_CSV);
    await buildRaspSqliteDatabase(tempCsvPath, tempSqlitePath);
  }

  it("stops reporting a store failure once an index appears, with no restart or reset", async () => {
    closeRaspResources();
    if (fs.existsSync(tempSqlitePath)) fs.rmSync(tempSqlitePath);

    // A fresh deployment: the index is absent.
    const before = await lookupPrecomputedRaspScore("P00439", 408, "R", "H");
    expect(before.score).toBeNull();
    expect(before.reason).toBe(RASP_STORE_UNAVAILABLE_REASON);

    // The index arrives. Note: deliberately NO closeRaspResources() here — the point is that the
    // loader notices on its own, the way it must when someone runs `npm run migrate:rasp` against a
    // live server.
    await rebuildFixture();

    const after = await lookupPrecomputedRaspScore("P00439", 408, "R", "H");
    expect(after.score).toBeCloseTo(1.45, 2);
  });

  it("stops rejecting a truncated index once it has been rebuilt", async () => {
    closeRaspResources();
    await rebuildFixture();

    // Truncate the completeness record, which is what the loader verifies against.
    const { DatabaseSync } = await import("node:sqlite");
    const broken = new DatabaseSync(tempSqlitePath, { open: true });
    broken.exec("DROP TABLE rasp_index_meta");
    broken.close();

    const rejected = await lookupPrecomputedRaspScore("P00439", 408, "R", "H");
    expect(rejected.score).toBeNull();
    expect(rejected.reason).toBe(RASP_STORE_UNAVAILABLE_REASON);

    // Repair it — again with no reset, because a rebuild is exactly what the verdict must not
    // outlive. The old one-shot flag made this impossible without a process restart.
    closeRaspResources(); // release the handle so the replacement can be swapped in
    await rebuildFixture();

    const repaired = await lookupPrecomputedRaspScore("P00439", 408, "R", "H");
    expect(repaired.score).toBeCloseTo(1.45, 2);
  });

  it("does not memoise a store-unavailable miss", async () => {
    closeRaspResources();
    if (fs.existsSync(tempSqlitePath)) fs.rmSync(tempSqlitePath);

    // Through the CACHING entry point, while the store is unusable. This LRU has no TTL, so a
    // memoised store failure would keep RaSP (a weight-1.5 consensus engine) silent for the life of
    // the process even after the index was repaired.
    const miss = await runRaspLocal("", "", "X", 408, "R", "H", "P00439");
    expect(miss?.reason).toBe(RASP_STORE_UNAVAILABLE_REASON);

    await rebuildFixture();

    const hit = await runRaspLocal("", "", "X", 408, "R", "H", "P00439");
    expect(hit?.score).toBeCloseTo(1.45, 2);
  });

  it("still memoises a genuine coverage miss, which is a property of the variant", async () => {
    // The opposite policy, pinned so the fix above cannot be "solved" by disabling the cache.
    closeRaspResources();
    await rebuildFixture();

    const first = await runRaspLocal("", "", "X", 999, "A", "G", "P00439");
    expect(first?.score).toBeNull();
    expect(first?.reason).toContain("position");

    const second = await runRaspLocal("", "", "X", 999, "A", "G", "P00439");
    expect(second).toEqual(first);
  });
});

/**
 * Two RaSP sources in one index, and an index from before sources existed.
 *
 * The AlphaFold-proteome row must win over the experimental-set row: it is UniProt-numbered by
 * construction, whereas the authors note some experimental positions follow the structure's numbering.
 * And a v2 index (no `source` column) must keep working, or an upgrade would switch RaSP off in every
 * deployment that has not rebuilt.
 */
describe("RaSP sources", () => {
  const dataDir = path.dirname(process.env.RASP_CSV_PATH ?? path.join(process.cwd(), "data", "x"));
  const csvPath = process.env.RASP_CSV_PATH ?? path.join(dataDir, "df_rasp_gnomad_clinvar.csv");
  const sqlitePath = process.env.RASP_SQLITE_PATH ?? path.join(dataDir, "df_rasp_gnomad_clinvar.sqlite");
  const proteomeDir = path.join(dataDir, "rasp-proteome-test");
  const saved: Record<string, Buffer | null> = {};

  beforeAll(() => {
    closeRaspResources();
    for (const p of [csvPath, sqlitePath]) saved[p] = fs.existsSync(p) ? fs.readFileSync(p) : null;
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterAll(() => {
    closeRaspResources();
    for (const [p, content] of Object.entries(saved)) {
      try {
        if (content) fs.writeFileSync(p, content);
        else if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
    fs.rmSync(proteomeDir, { recursive: true, force: true });
  });

  it("prefers the AlphaFold-proteome row and reports its source and the coverage", async () => {
    fs.writeFileSync(
      csvPath,
      "uniprot_id,pdb_chain,pdb,chain_id,variant,RaSP;score_ml,clinvar;Clinvar_signifiance,gnomad;AF\n" +
        "P00439,A,1pdb,A,R2W,1.45,,\nP01112,A,2pdb,A,G12V,2.54,,\n"
    );
    fs.mkdirSync(proteomeDir, { recursive: true });
    fs.writeFileSync(
      path.join(proteomeDir, "AF-P00439-F1-model_v2.txt"),
      "# --------------------\n#     sequence: MRAG\n# --------------------\n#\nvariant score_ml_fermi score_ml\nR2W 0.81 2.40\n"
    );
    await buildRaspSqliteDatabase(csvPath, sqlitePath, { proteomeDir });
    closeRaspResources();

    const { getRaspCoverage } = await import("./energy-models.ts");
    const both = await lookupPrecomputedRaspScore("P00439", 2, "R", "W");
    expect(both).toEqual({ score: 2.4, source: "alphafold" });
    const experimentalOnly = await lookupPrecomputedRaspScore("P01112", 12, "G", "V");
    expect(experimentalOnly).toEqual({ score: 2.54, source: "experimental" });
    expect(getRaspCoverage()).toEqual({ proteins: 2, sources: { experimental: 2, alphafold: 1 } });
  });

  it("still serves a v2 index that has no source column", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    closeRaspResources();
    if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
    const db = new DatabaseSync(sqlitePath, { open: true });
    db.exec(`
      CREATE TABLE rasp_variants (uniprot_id TEXT NOT NULL, pos INTEGER NOT NULL, wt TEXT NOT NULL, mut TEXT NOT NULL,
        pdb TEXT, pdb_chain TEXT, chain_id TEXT, rasp_score REAL, clinvar_significance TEXT, gnomad_af REAL) STRICT;
      CREATE TABLE rasp_index_meta (schema_version INTEGER NOT NULL, rows INTEGER NOT NULL, proteins INTEGER NOT NULL,
        source_file TEXT, source_bytes INTEGER, built_at TEXT NOT NULL) STRICT;
      INSERT INTO rasp_variants VALUES ('P00439', 408, 'R', 'H', NULL, NULL, NULL, 1.45, NULL, NULL);
      INSERT INTO rasp_index_meta VALUES (2, 1, 1, 'df.csv', 0, '2026-01-01');
    `);
    // Pad past the loader's 1 KB placeholder floor, as a real index always is.
    db.exec(`CREATE TABLE pad (x TEXT); INSERT INTO pad VALUES ('${"x".repeat(4096)}');`);
    db.close();

    const { getRaspCoverage } = await import("./energy-models.ts");
    expect(await lookupPrecomputedRaspScore("P00439", 408, "Arg", "His")).toEqual({ score: 1.45, source: "experimental" });
    expect(getRaspCoverage()).toEqual({ proteins: 1, sources: { experimental: 1 } });
  });
});

/**
 * ProtVar's precomputed FoldX rides on the energetics payload for display, but it is FoldX again: it
 * must never enter the consensus, and a pending lookup must never hold the verdict provisional.
 */
describe("enrichBiophysicalResult — ProtVar reference value", () => {
  const foldxRaw = { ddG: 2.6, status: "success", energetics: { foldxMean: 2.6 } };

  it("carries the ProtVar fields and leaves the consensus to the counted engines", () => {
    const withIt = enrichBiophysicalResult(foldxRaw, {
      protvarStatus: "done", protvarVal: 2.09, protvarPlddt: 49.5, protvarModel: "AF-P15056-F1", protvarReason: null, protvarError: null,
    });
    const without = enrichBiophysicalResult(foldxRaw, {});
    expect(withIt.energetics).toMatchObject({ protvar: 2.09, protvarStatus: "done", protvarPlddt: 49.5, protvarModel: "AF-P15056-F1" });
    expect(withIt.energetics.consensusEnginesCounted).toBe(without.energetics.consensusEnginesCounted);
    expect(withIt.energetics.consensusVerdict).toBe(without.energetics.consensusVerdict);
  });

  it("does not list a pending ProtVar lookup as a pending tool", () => {
    const result = enrichBiophysicalResult(foldxRaw, { protvarStatus: "pending", protvarVal: null });
    expect(result.energetics.pendingTools).not.toContain("ProtVar");
    expect(result.energetics.evidenceComplete).toBe(true);
  });

  it("keeps a ProtVar value already on the cached payload", () => {
    const cached = { ...foldxRaw, energetics: { ...foldxRaw.energetics, protvar: 1.1, protvarStatus: "done", protvarModel: "AF-X-F1" } };
    expect(enrichBiophysicalResult(cached, {}).energetics).toMatchObject({ protvar: 1.1, protvarStatus: "done", protvarModel: "AF-X-F1" });
  });
});
