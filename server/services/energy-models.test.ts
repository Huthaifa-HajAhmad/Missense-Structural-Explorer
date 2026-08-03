import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { lookupPrecomputedRaspScore } from "./energy-models.ts";

describe("RaSP Database Atomic Seeks & Lookups Unit Tests", () => {
  const dataDir = path.join(process.cwd(), "data");
  const tempCsvPath = path.join(dataDir, "df_rasp_gnomad_clinvar.csv");
  const tempIndexPath = path.join(dataDir, "df_rasp_gnomad_clinvar.index.json");

  let originalCsvExists = false;
  let originalIndexExists = false;
  let originalCsvContent: Buffer | null = null;
  let originalIndexContent: string | null = null;

  beforeAll(() => {
    // Save original files if they exist to avoid side effects
    if (fs.existsSync(tempCsvPath)) {
      originalCsvExists = true;
      originalCsvContent = fs.readFileSync(tempCsvPath);
    }
    if (fs.existsSync(tempIndexPath)) {
      originalIndexExists = true;
      originalIndexContent = fs.readFileSync(tempIndexPath, "utf8");
    }

    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write a mock CSV database
    // Structure: uniprot_id,?,?,,variant,score
    const mockCsvContent = [
      "P00439,X,X,X,R408H,1.45",
      "P00439,X,X,X,D12E,-0.32",
      "P01112,X,X,X,G12V,2.54",
      "P01112,X,X,X,Q61H,0.98",
      "P02340,X,X,X,V150F,3.12"
    ].join("\n") + "\n";

    fs.writeFileSync(tempCsvPath, mockCsvContent);

    // Calculate byte offsets for each protein
    // P00439 starts at 0
    // P01112 starts at line 3 length: line 1 + line 2
    const lines = mockCsvContent.split("\n");
    const offsetP00439 = 0;
    const offsetP01112 = lines[0].length + 1 + lines[1].length + 1;
    const offsetP02340 = offsetP01112 + lines[2].length + 1 + lines[3].length + 1;

    const mockIndex = {
      "P00439": offsetP00439,
      "P01112": offsetP01112,
      "P02340": offsetP02340
    };

    try {
      fs.writeFileSync(tempIndexPath, JSON.stringify(mockIndex));
    } catch {
      // If file is locked, wait briefly and retry
      try {
        fs.writeFileSync(tempIndexPath, JSON.stringify(mockIndex));
      } catch (e) {
        console.warn("[Test Setup] Failed to overwrite temp index path:", e);
      }
    }
  });

  afterAll(() => {
    const safeWrite = (filePath: string, content: string | Buffer) => {
      let attempts = 0;
      while (attempts < 5) {
        try {
          fs.writeFileSync(filePath, content);
          break;
        } catch (e) {
          attempts++;
          if (attempts >= 5) break;
          const end = Date.now() + 50;
          while (Date.now() < end) {}
        }
      }
    };

    const safeUnlink = (filePath: string) => {
      let attempts = 0;
      while (attempts < 5) {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          break;
        } catch (e) {
          attempts++;
          if (attempts >= 5) break;
          const end = Date.now() + 50;
          while (Date.now() < end) {}
        }
      }
    };

    // Restore or cleanup
    if (originalCsvExists && originalCsvContent) {
      safeWrite(tempCsvPath, originalCsvContent);
    } else {
      safeUnlink(tempCsvPath);
    }

    if (originalIndexExists && originalIndexContent) {
      safeWrite(tempIndexPath, originalIndexContent);
    } else {
      safeUnlink(tempIndexPath);
    }
  });

  it("should successfully lookup score using atomic seeks for first protein in index", async () => {
    const result = await lookupPrecomputedRaspScore("P00439", 408, "Arg", "His");
    expect(result.score).toBeCloseTo(1.45, 2);
  });

  it("should successfully lookup score using atomic seeks for middle protein in index", async () => {
    const result = await lookupPrecomputedRaspScore("P01112", 12, "Gly", "Val");
    expect(result.score).toBeCloseTo(2.54, 2);
  });

  it("should successfully lookup score using atomic seeks for last protein in index", async () => {
    const result = await lookupPrecomputedRaspScore("P02340", 150, "Val", "Phe");
    expect(result.score).toBeCloseTo(3.12, 2);
  });

  it("should return null for missing position in existing protein", async () => {
    const result = await lookupPrecomputedRaspScore("P00439", 999, "Ala", "Gly");
    expect(result.score).toBeNull();
    expect(result.reason).toBe("Residue position is not present in the pre-computed database");
  });

  it("should return null for missing protein in index", async () => {
    const result = await lookupPrecomputedRaspScore("P53000", 50, "Cys", "Trp");
    expect(result.score).toBeNull();
    expect(result.reason).toBe("Protein is not present in the pre-computed database");
  });
});
