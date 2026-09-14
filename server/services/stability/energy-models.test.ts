import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { lookupPrecomputedRaspScore, closeRaspResources, initializeRaspDatabase } from "./energy-models.ts";
import { buildRaspSqliteDatabase } from "../../../scripts/build-rasp-sqlite.ts";

describe("RaSP SQLite Database & Lookups Unit Tests", () => {
  const dataDir = path.join(process.cwd(), "data");
  const tempCsvPath = path.join(dataDir, "df_rasp_gnomad_clinvar.csv");
  const tempSqlitePath = path.join(dataDir, "df_rasp_gnomad_clinvar.sqlite");

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
