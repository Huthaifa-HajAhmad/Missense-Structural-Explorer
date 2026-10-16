import fs from "fs";
import path from "path";
import { detectFoldxBinaryAndDir } from "./detector.ts";

/**
 * Whether a FoldX program this host can run is installed, and what it still needs to run.
 *
 * `/diagnostics` and `/capabilities` both answer "is FoldX usable?", and they answered it
 * differently. The diagnostics scan accepted any `foldx*` file, so a binary with no `rotabase.txt`
 * beside it read as ready — and every job then failed in the runner, which refuses to start
 * without that parameter file. This mirrors what the runner does: the same binary detection, the
 * same `rotabase.txt` search, and the same Box64 rule for an x86_64 program on an arm64 host.
 *
 * Shared by `/diagnostics` and `/capabilities`, so the two endpoints cannot disagree.
 */
export interface FoldxReadiness {
  /** Installed, with its parameter file, and runnable on this host. */
  ready: boolean;
  binaryFound: boolean;
  rotabasePresent: boolean;
  /** An x86_64 FoldX program on an arm64 Linux host runs only under Box64. */
  box64Required: boolean;
  box64Present: boolean;
}

/** Below this a file is a stub or a truncated download, not an engine. Same floor as `/capabilities`. */
const FOLDX_MIN_BINARY_BYTES = 1024 * 1024;

function isFoldxProgram(file: string): boolean {
  try {
    const st = fs.statSync(file);
    return st.isFile() && st.size > FOLDX_MIN_BINARY_BYTES;
  } catch {
    return false;
  }
}

export function resolveFoldxReadiness(): FoldxReadiness {
  const { foldxBin, foldxDir } = detectFoldxBinaryAndDir();
  // The detector hands back the bare name `foldx` when it found nothing. That must not be read as
  // a file in the working directory.
  const binaryFound = foldxBin !== "foldx" && isFoldxProgram(foldxBin);

  // Mirrors the search in stability/foldx/runner.ts; keep the two lists in step.
  const rotabasePresent = [
    foldxDir ? path.join(foldxDir, "rotabase.txt") : "",
    path.join(process.cwd(), "tools", "foldx", "rotabase.txt"),
    path.join(process.cwd(), "tools", "foldx_linux", "rotabase.txt"),
    path.join("/app/tools/foldx", "rotabase.txt"),
    path.join("/app/tools/foldx_linux", "rotabase.txt"),
    path.join(process.cwd(), "rotabase.txt"),
  ].some(p => p && fs.existsSync(p));

  // The runner only switches to Box64 when the binary it is about to run exists at this path.
  const box64Required =
    binaryFound && process.platform === "linux" && (process.arch === "arm64" || process.arch === "arm");
  const box64Present = fs.existsSync(process.env.BOX64_PATH || "/usr/local/bin/box64");

  return {
    ready: binaryFound && rotabasePresent && (!box64Required || box64Present),
    binaryFound,
    rotabasePresent,
    box64Required,
    box64Present,
  };
}

