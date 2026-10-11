/**
 * scripts/lib/foldx-job.ts — a FoldX job directory laid out exactly as the production runner lays it
 * out, for the measuring scripts (`foldx-timing.ts`, `compute-benchmark.ts`). They never touch the
 * cache, the queue or the server.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AA3: Record<string, string> = {
  A: "ALA", R: "ARG", N: "ASN", D: "ASP", C: "CYS", Q: "GLN", E: "GLU", G: "GLY", H: "HIS", I: "ILE",
  L: "LEU", K: "LYS", M: "MET", F: "PHE", P: "PRO", S: "SER", T: "THR", W: "TRP", Y: "TYR", V: "VAL"
};

/**
 * The values the runner is given when the client omits conditions — the UI's own defaults
 * (`src/shared/biophysicsConditions.ts`: pH 7.4, 298.15 K, 0.15 M). The production runner adds exactly
 * these only when the caller supplies options, so a benchmark job matches a default UI job; a job with
 * custom conditions would not, and `--timeSeedRotabase=false` is a property of the runner itself.
 */
export const EXTRA_ARGS = ["--timeSeedRotabase=false", "--pH=7.4", "--temperature=298.15", "--ionStrength=0.15"];

export function linkOrCopy(source: string, dest: string, kind: "dir" | "file") {
  if (fs.existsSync(dest)) return;
  try {
    fs.symlinkSync(source, dest, kind === "dir" ? (process.platform === "win32" ? "junction" : "dir") : "file");
  } catch {
    fs.cpSync(source, dest, { recursive: true });
  }
}

/**
 * Where job dirs live. On Windows FoldX "runs OK" in `%TEMP%` but silently writes NO output
 * (RepairPDB: no wt_Repair.pdb; BuildModel: "BuildModel failed:" with no wt_1.pdb) — antivirus
 * or an indexer interferes, the same fault scripts/with-local-tmp.mjs works around for esbuild.
 * The identical inputs succeed inside the repo, so default there.
 */
export function defaultWorkRoot(): string {
  return process.platform === "win32" ? path.join(process.cwd(), "node_modules", ".cache", "tmp") : os.tmpdir();
}

/**
 * A fresh job dir holding `wt.pdb`, the mutant list and links to the parameter files. Fresh every time:
 * FoldX APPENDS to `Dif_wt.fxout` when one exists, so a reused dir silently mixes runs.
 */
export function prepareFoldxJobDir(opts: {
  workRoot: string;
  label: string;
  pdbText: string;
  /** `individual_list.txt` line without the semicolon, e.g. `QA867H`. */
  mutation: string;
  foldxDir: string;
}): string {
  fs.mkdirSync(opts.workRoot, { recursive: true });
  const jobDir = fs.mkdtempSync(path.join(opts.workRoot, `foldx-${opts.label}-`));
  fs.writeFileSync(path.join(jobDir, "wt.pdb"), opts.pdbText, "utf8");
  fs.writeFileSync(path.join(jobDir, "individual_list.txt"), `${opts.mutation};\n`, "utf8");
  linkOrCopy(path.join(opts.foldxDir, "molecules"), path.join(jobDir, "molecules"), "dir");
  linkOrCopy(path.join(opts.foldxDir, "rotabase.txt"), path.join(jobDir, "rotabase.txt"), "file");
  return jobDir;
}
