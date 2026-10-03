export type FoldxFailureKind = "runtime-crash" | "timeout" | "missing-output" | "execution-error";

export function classifyFoldxFailure(error: any): FoldxFailureKind {
  const diagnostic = [error?.message, error?.stderr, error?.stdout, error?.signal].filter(Boolean).join(" ");
  if (/SIGSEGV|SIGABRT|Signal (?:11|6)\b|Unhandled signal caught|segmentation fault/i.test(diagnostic)) return "runtime-crash";
  if (error?.killed || error?.code === "ETIMEDOUT" || error?.signal === "SIGTERM") return "timeout";
  if (/without producing a mutant PDB/i.test(diagnostic)) return "missing-output";
  return "execution-error";
}

export function canRetryFoldxAfterRepair(repairFailed: boolean, error: any, signal?: AbortSignal): boolean {
  return repairFailed && !signal?.aborted && error?.name !== "AbortError" && classifyFoldxFailure(error) === "execution-error";
}

export function describeFoldxFailure(error: any, repairFailed: boolean): string {
  const kind = classifyFoldxFailure(error);
  const diagnostic = [error?.message, error?.stderr].filter(Boolean).join("\n").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 4000);
  const box64 = /box64/i.test(diagnostic) ? " through Box64" : "";
  if (kind === "runtime-crash") {
    return `FoldX BuildModel failed (native process crash${box64}): ${diagnostic}. Inspect the runtime, binary architecture and exact input structure. This does not establish that the PDB is invalid.`;
  }
  if (kind === "timeout") return `FoldX BuildModel exceeded its execution budget: ${diagnostic}`;
  if (kind === "missing-output") return `FoldX BuildModel returned no mutant structure: ${diagnostic}`;
  return `FoldX BuildModel failed (${repairFailed ? "RepairPDB previously failed" : "execution error"}): ${diagnostic}. Verify the input structure and FoldX parameter files.`;
}

export interface FoldxCrashInput {
  binary: string;
  jobDir: string;
  pdbText: string;
  mutation: string;
  args: readonly string[];
}

/**
 * Everything needed to reproduce a native FoldX crash offline: the exact input, command line and
 * host. A Signal 11 under emulation says nothing about the PDB, so the log must carry enough to
 * rerun `jobDir` by hand and to tell an emulator bug from a bad input.
 */
export function foldxCrashContext(input: FoldxCrashInput) {
  const lines = input.pdbText.split(/\r?\n/);
  return {
    binary: input.binary,
    jobDir: input.jobDir,
    mutation: input.mutation,
    args: [...input.args],
    pdbBytes: input.pdbText.length,
    atomRecords: lines.filter(line => line.startsWith("ATOM")).length,
    hetatmRecords: lines.filter(line => line.startsWith("HETATM")).length,
    host: { platform: process.platform, arch: process.arch, emulated: /box64/i.test(input.binary) }
  };
}
