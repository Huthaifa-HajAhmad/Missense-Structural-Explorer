import path from "path";
import fs from "fs";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SasaEvalSuccess {
  status: "success";
  resName: string;
  resId: number;
  sasa: number;
  maxSasa: number;
  rsa: number;
  burialStatus: "core" | "surface" | "boundary";
  sse: string;
}

export interface SasaEvalFailure {
  status: "error";
  message: string;
}

export type SasaEvalResult = SasaEvalSuccess | SasaEvalFailure;

export interface SasaRunnerOptions {
  timeoutMs?: number;
  /** Force fallback to uv run for testing */
  forceUvFallback?: boolean;
  /** Custom executor for testing and subprocess mocking */
  executor?: (command: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;
}

/**
 * Executes the biophysical SASA/RSA evaluation script on target PDB text.
 * Employs a resilient two-tier execution strategy:
 * 1. Direct execution via tools virtualenv Python (fastest in production Linux / Docker containers).
 * 2. Automatic fallback to `uv run --no-project` if the virtualenv interpreter is missing, crashes,
 *    or encounters platform DLL mismatches.
 */
export async function executeSasaEval(
  pdbText: string,
  chain: string,
  position: number,
  options?: SasaRunnerOptions
): Promise<SasaEvalResult> {
  const tempDir = path.join(process.cwd(), "temp_jobs", `sasa_${crypto.randomUUID()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const pdbPath = path.join(tempDir, "protein.pdb");
  await fs.promises.writeFile(pdbPath, pdbText, "utf8");

  const pythonScript = path.join(process.cwd(), "tools", "sasa_eval.py");
  const timeout = options?.timeoutMs ?? 15000;
  const execAsync = options?.executor ?? execFileAsync;

  try {
    const venvPython = process.platform === "win32"
      ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "tools", ".venv", "bin", "python");

    const useVenv = !options?.forceUvFallback && fs.existsSync(venvPython);

    if (useVenv) {
      try {
        const { stdout } = await execAsync(
          venvPython,
          [pythonScript, pdbPath, chain, position.toString()],
          { timeout }
        );
        const parsed = JSON.parse(stdout.trim());
        if (parsed.status === "success") {
          return parsed as SasaEvalSuccess;
        }
        return {
          status: "error",
          message: typeof parsed.message === "string" ? parsed.message : "The accessibility script returned no value."
        };
      } catch (venvErr) {
        console.warn("[SASA-Runner] Direct venv execution failed, falling back to uv run --no-project:", (venvErr as Error).message);
      }
    }

    // Tier 2: Resilient standalone fallback using uv with PEP 723 metadata
    try {
      const { stdout } = await execAsync(
        "uv",
        ["run", "--no-project", pythonScript, pdbPath, chain, position.toString()],
        { timeout }
      );
      const parsed = JSON.parse(stdout.trim());
      if (parsed.status === "success") {
        return parsed as SasaEvalSuccess;
      }
      return {
        status: "error",
        message: typeof parsed.message === "string" ? parsed.message : "The accessibility script returned no value."
      };
    } catch (uvErr) {
      console.warn("[SASA-Runner] Fallback uv execution failed:", (uvErr as Error).message);
      const code = (uvErr as { code?: string })?.code;
      return {
        status: "error",
        message:
          code === "ENOENT"
            ? "The accessibility script could not start: neither Python venv nor uv was found."
            : "The accessibility script failed to run (Python with uv and Biopython is required)."
      };
    }
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}
