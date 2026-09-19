import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  lookupPrecomputedRaspScore,
  closeRaspResources,
  initializeRaspDatabase,
  runRaspLocal,
  RASP_STORE_UNAVAILABLE_REASON,
} from "./energy-models.ts";
import { buildRaspSqliteDatabase } from "./build-rasp-sqlite.ts";

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
