import { describe, it, expect } from "vitest";
import { executeSasaEval } from "./sasa-runner.ts";

const mockCysPdb = `
ATOM      1  N   CYS A 182      11.104  13.207  10.000  1.00 90.00           N
ATOM      2  CA  CYS A 182      12.000  14.000  10.000  1.00 90.00           C
ATOM      3  C   CYS A 182      13.000  14.000  11.000  1.00 90.00           C
ATOM      4  O   CYS A 182      13.000  14.000  12.000  1.00 90.00           O
ATOM      5  CB  CYS A 182      12.000  15.000   9.000  1.00 90.00           C
ATOM      6  SG  CYS A 182      11.000  15.000   8.000  1.00 90.00           S
TER
`.trim();

describe("SASA Runner (Two-Tier Resilient Biophysical Execution)", () => {
  it("should calculate SASA, RSA, and burial status via direct interpreter", async () => {
    const result = await executeSasaEval(mockCysPdb, "A", 182);
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.resName).toBe("CYS");
      expect(result.resId).toBe(182);
      expect(result.sasa).toBeGreaterThan(0);
      expect(result.rsa).toBeGreaterThan(0);
      expect(["core", "surface", "boundary"]).toContain(result.burialStatus);
    }
  });

  it("should transparently fallback to uv run --no-project when forced", async () => {
    const result = await executeSasaEval(mockCysPdb, "A", 182, { forceUvFallback: true });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.resName).toBe("CYS");
      expect(result.resId).toBe(182);
      expect(result.sasa).toBeGreaterThan(0);
      expect(result.rsa).toBeGreaterThan(0);
      expect(["core", "surface", "boundary"]).toContain(result.burialStatus);
    }
  });

  it("should return a clean structured error when the target residue is missing", async () => {
    const result = await executeSasaEval(mockCysPdb, "A", 999);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("Residue 999 in chain A not found");
    }
  });
});
