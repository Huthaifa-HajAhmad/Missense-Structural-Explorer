import fs from "fs";
import path from "path";

/**
 * The Python interpreter of the `tools` virtual environment, or null when it is not installed.
 *
 * Running a tools script with this interpreter directly is the fast path: no download, no
 * dependency resolution. `uv run` is only the fallback for a machine that has no such environment.
 */
export function toolsVenvPython(): string | null {
  const venvPython = process.platform === "win32"
    ? path.join(process.cwd(), "tools", ".venv", "Scripts", "python.exe")
    : path.join(process.cwd(), "tools", ".venv", "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : null;
}

/**
 * Whether a child process was stopped because it ran out of time (Node's `execFile` `timeout`
 * option kills it and sets `killed`).
 *
 * This matters for fallbacks. A script that timed out was too slow on this machine at this moment;
 * starting the same script again through another launcher is slower still (the launcher may also
 * download packages first), and it doubles the wait for nothing.
 */
export function wasKilledByTimeout(err: unknown): boolean {
  return (err as { killed?: boolean } | null)?.killed === true;
}
