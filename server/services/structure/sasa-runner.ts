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

/** Every standard residue of one chain: the same method and rounding as the single-residue mode. */
export interface SasaAllSuccess {
  status: "success";
  residues: Array<{ resId: number; resName: string; rsa: number }>;
}

export type SasaAllResult = SasaAllSuccess | SasaEvalFailure;

type ToolOutput = { ok: true; parsed: Record<string, unknown> } | { ok: false; message: string };

/**
 * Runs tools/sasa_eval.py on PDB text with a two-tier strategy and returns its parsed JSON.
 * 1. Direct execution via the tools virtualenv Python (fastest in production Linux / Docker containers).
 * 2. Automatic fallback to `uv run --no-project` if the virtualenv interpreter is missing, crashes,
 *    or encounters platform DLL mismatches.
 * Both modes (one residue, or every residue) share it, so they cannot drift in how they start or fail.
 */
async function runSasaTool(pdbText: string, chain: string, target: string, options?: SasaRunnerOptions): Promise<ToolOutput> {
  const tempDir = path.join(process.cwd(), "temp_jobs", `sasa_${crypto.randomUUID()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const pdbPath = path.join(tempDir, "protein.pdb");
  await fs.promises.writeFile(pdbPath, pdbText, "utf8");

  const pythonScript = path.join(process.cwd(), "tools", "sasa_eval.py");
  const timeout = options?.timeoutMs ?? 15000;
  const execAsync = options?.executor ?? execFileAsync;
  const read = (stdout: string): ToolOutput => {
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return parsed.status === "success"
      ? { ok: true, parsed }
      : { ok: false, message: typeof parsed.message === "string" ? parsed.message : "The accessibility script returned no value." };
  };

  try {
    const venvPython = process.platform === "win32"
      ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "tools", ".venv", "bin", "python");

    const useVenv = !options?.forceUvFallback && fs.existsSync(venvPython);

    if (useVenv) {
      try {
        const { stdout } = await execAsync(venvPython, [pythonScript, pdbPath, chain, target], { timeout });
        return read(stdout);
      } catch (venvErr) {
        console.warn("[SASA-Runner] Direct venv execution failed, falling back to uv run --no-project:", (venvErr as Error).message);
      }
    }

    // Tier 2: Resilient standalone fallback using uv with PEP 723 metadata
    try {
      const { stdout } = await execAsync("uv", ["run", "--no-project", pythonScript, pdbPath, chain, target], { timeout });
      return read(stdout);
    } catch (uvErr) {
      console.warn("[SASA-Runner] Fallback uv execution failed:", (uvErr as Error).message);
      const code = (uvErr as { code?: string })?.code;
      return {
        ok: false,
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

/** The accessibility of one residue, with its burial word and secondary structure. */
export async function executeSasaEval(
  pdbText: string,
  chain: string,
  position: number,
  options?: SasaRunnerOptions
): Promise<SasaEvalResult> {
  const out = await runSasaTool(pdbText, chain, position.toString(), options);
  return out.ok ? (out.parsed as unknown as SasaEvalSuccess) : { status: "error", message: out.message };
}

/** The relative accessibility of every standard residue of a chain, in one run of the tool. */
export async function executeSasaAll(pdbText: string, chain: string, options?: SasaRunnerOptions): Promise<SasaAllResult> {
  const out = await runSasaTool(pdbText, chain, "all", options);
  return out.ok ? (out.parsed as unknown as SasaAllSuccess) : { status: "error", message: out.message };
}
