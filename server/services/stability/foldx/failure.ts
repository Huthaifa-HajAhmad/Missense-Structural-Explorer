import { DID_NOT_FIT_IN_MEMORY, isOutOfMemory } from "../../infra/failure-class.ts";

export type FoldxFailureKind = "runtime-crash" | "timeout" | "out-of-memory" | "missing-output" | "execution-error";

export function classifyFoldxFailure(error: any): FoldxFailureKind {
  const diagnostic = [error?.message, error?.stderr, error?.stdout, error?.signal].filter(Boolean).join(" ");
  // Timeout FIRST: `killed` is set only when Node killed the child (its `timeout`). A process killed
  // mid-run under Box64 can still print "Unhandled signal caught" on the way down, and checking the
  // crash text first would report our own budget kill as a native crash with the wrong advice.
  if (error?.killed || error?.code === "ETIMEDOUT") return "timeout";
  // Killed by something other than us, almost always the kernel's OOM killer. Before the crash check:
  // Box64 can print "Unhandled signal caught" while it is being killed.
  if (isOutOfMemory(error)) return "out-of-memory";
  if (/SIGSEGV|SIGABRT|Signal (?:11|6)\b|Unhandled signal caught|segmentation fault/i.test(diagnostic)) return "runtime-crash";
  if (error?.signal === "SIGTERM") return "timeout";
  if (/without producing a mutant PDB/i.test(diagnostic)) return "missing-output";
  return "execution-error";
}

export function canRetryFoldxAfterRepair(repairFailed: boolean, error: any, signal?: AbortSignal): boolean {
  return repairFailed && !signal?.aborted && error?.name !== "AbortError" && classifyFoldxFailure(error) === "execution-error";
}

/**
 * The facts a timeout cannot be diagnosed without. "Exceeded its execution budget" alone sent one
 * RCA chasing size and emulation for a run whose duration, size and repair state were all unknown
 * from the log; with these in the message the next reader starts from evidence.
 */
export interface FoldxRunContext {
  budgetMs: number;
  residueCount: number;
  numberOfRuns: number;
  /** "repaired", "repaired (reused)", "unrepaired (<reason>)" — the template BuildModel was given. */
  template: string;
  emulated: boolean;
}

function describeRun(ctx: FoldxRunContext): string {
  return `${(ctx.budgetMs / 1000).toFixed(0)} s budget; ${ctx.residueCount} residues, ${ctx.template} template, ` +
    `${ctx.numberOfRuns} runs${ctx.emulated ? ", emulated through Box64" : ""}`;
}

export function describeFoldxFailure(error: any, repairFailed: boolean, ctx?: FoldxRunContext): string {
  const kind = classifyFoldxFailure(error);
  const diagnostic = [error?.message, error?.stderr].filter(Boolean).join("\n").replace(/\x1b\[[0-9;]*m/g, "").slice(0, 4000);
  const box64 = /box64/i.test(diagnostic) ? " through Box64" : "";
  if (kind === "runtime-crash") {
    return `FoldX BuildModel failed (native process crash${box64}): ${diagnostic}. Inspect the runtime, binary architecture and exact input structure. This does not establish that the PDB is invalid.`;
  }
  if (kind === "out-of-memory") {
    return `FoldX BuildModel stopped because this structure ${DID_NOT_FIT_IN_MEMORY}${ctx ? ` (${describeRun(ctx)})` : ""}. ` +
      `It was killed for memory, not for time; a smaller structure or a computer with more memory will run it. ${diagnostic}`;
  }
  if (kind === "timeout") {
    return `FoldX BuildModel exceeded its execution budget${ctx ? ` (${describeRun(ctx)})` : ""}: ${diagnostic}`;
  }
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
