import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
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
  it("hermetically parses successful output from the primary interpreter", async () => {
    const mockOutput = JSON.stringify({
      status: "success",
      resName: "CYS",
      resId: 182,
      sasa: 224.36,
      maxSasa: 167.0,
      rsa: 1.3435,
      burialStatus: "surface",
      sse: "c"
    });

    const executor = vi.fn().mockResolvedValue({ stdout: mockOutput });
    const result = await executeSasaEval(mockCysPdb, "A", 182, { executor });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.resName).toBe("CYS");
      expect(result.resId).toBe(182);
      expect(result.sasa).toBe(224.36);
      expect(result.rsa).toBe(1.3435);
      expect(result.burialStatus).toBe("surface");
      expect(result.sse).toBe("c");
    }
  });

  it("transparently falls back to uv run --no-project when primary interpreter fails", async () => {
    const mockSuccessOutput = JSON.stringify({
      status: "success",
      resName: "CYS",
      resId: 182,
      sasa: 15.0,
      maxSasa: 167.0,
      rsa: 0.0898,
      burialStatus: "core",
      sse: "h"
    });

    // Fail if called with venv python; succeed if called with uv
    const executor = vi.fn().mockImplementation(async (command: string, args: string[]) => {
      if (command === "uv") {
        expect(args[0]).toBe("run");
        expect(args[1]).toBe("--no-project");
        return { stdout: mockSuccessOutput };
      }
      const err = new Error("Command failed: status 0xC000007B");
      (err as any).code = 3221225794;
      throw err;
    });

    const result = await executeSasaEval(mockCysPdb, "A", 182, { executor });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.burialStatus).toBe("core");
      expect(result.rsa).toBe(0.0898);
    }
  });

  it("returns clean structured error when the target residue is missing", async () => {
    const mockErrorOutput = JSON.stringify({
      status: "error",
      message: "Residue 999 in chain A not found."
    });

    const executor = vi.fn().mockResolvedValue({ stdout: mockErrorOutput });
    const result = await executeSasaEval(mockCysPdb, "A", 999, { executor });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("Residue 999 in chain A not found");
    }
  });

  it("handles ENOENT when neither Python venv nor uv is found on the system", async () => {
    const executor = vi.fn().mockRejectedValue(Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" }));
    const result = await executeSasaEval(mockCysPdb, "A", 182, { executor, forceUvFallback: true });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("neither Python venv nor uv was found");
    }
  });

  // End-to-end integration check only when live tools runtime is present on host
  const venvPython = process.platform === "win32"
    ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "tools", ".venv", "bin", "python");

  if (fs.existsSync(venvPython)) {
    it("runs live end-to-end evaluation when local tools environment is provisioned", async () => {
      const result = await executeSasaEval(mockCysPdb, "A", 182);
      expect(result.status).toBe("success");
      if (result.status === "success") {
        expect(result.resName).toBe("CYS");
        expect(result.resId).toBe(182);
        expect(result.sasa).toBeGreaterThan(0);
      }
    });
  }
});
