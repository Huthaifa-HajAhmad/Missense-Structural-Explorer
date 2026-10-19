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
  /**
   * What RepairPDB did before BuildModel, when it was tried. "Unrepaired (repair failed)" alone sent an
   * RCA looking for a bad template when RepairPDB had been working correctly and was killed by its
   * budget 64% of the way through; this says which, and how far it got.
   */
  repair?: FoldxRepairDiagnostic;
}

export type FoldxRepairOutcome = "completed" | "reused" | "skipped" | "timed-out" | "failed" | "no-output";

/** The facts of one RepairPDB attempt, small enough to log whole and to carry in a timeout record. */
export interface FoldxRepairDiagnostic {
  outcome: FoldxRepairOutcome;
  /** Why it was not attempted (outcome "skipped"). */
  skipReason?: string;
  budgetMs?: number;
  elapsedMs?: number;
  /** FoldX's own "number of incomplete residues = N" (truncated side chains it must rebuild). */
  incompleteResidues?: number;
  /** Residues FoldX had finished optimising when the process ended ("Now optimizing Residue" lines). */
  residuesOptimised?: number;
  /** The residue FoldX was working on, e.g. "ILEA546". */
  lastResidue?: string | null;
  signal?: string | null;
  exitCode?: number | string | null;
  /** The last lines of FoldX's own output, verbatim. Empty stderr is recorded as empty, not omitted. */
  stderrTail?: string;
  stdoutTail?: string;
}

/** What FoldX's RepairPDB prints that says how far it got; all of it is optional in the output. */
export function parseRepairProgress(stdout: string): Pick<FoldxRepairDiagnostic, "incompleteResidues" | "residuesOptimised" | "lastResidue"> {
  const incomplete = /number of incomplete residues\s*=\s*(\d+)/i.exec(stdout);
  let optimised = 0;
  let last: string | null = null;
  for (const match of stdout.matchAll(/Now optimizing Residue\s+(\S+)/g)) {
    optimised++;
    last = match[1];
  }
  return { incompleteResidues: incomplete ? Number(incomplete[1]) : undefined, residuesOptimised: optimised, lastResidue: last };
}

/**
 * The last `maxChars` of FoldX output, kept to whole lines so a log reader does not start mid-word.
 * FoldX's `getInstances` heartbeat lines and blank lines carry nothing and would fill the tail.
 */
export function tailOutput(text: string | undefined | null, maxChars = 600): string {
  const body = (text ?? "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .filter(line => line.trim() !== "" && line.trim() !== "getInstances")
    .join("\n")
    .trimEnd();
  if (body.length <= maxChars) return body;
  const cut = body.slice(body.length - maxChars);
  const firstBreak = cut.indexOf("\n");
  return firstBreak >= 0 ? cut.slice(firstBreak + 1) : cut;
}

function describeRepair(repair: FoldxRepairDiagnostic, residueCount: number): string {
  const seconds = (ms?: number) => (ms === undefined ? "?" : (ms / 1000).toFixed(0));
  const progress = repair.residuesOptimised
    ? `, had optimised ${repair.residuesOptimised} of ${residueCount} residues${repair.lastResidue ? ` (at ${repair.lastResidue})` : ""}`
    : "";
  const incomplete = repair.incompleteResidues !== undefined ? `; ${repair.incompleteResidues} incomplete residues` : "";
  switch (repair.outcome) {
    case "timed-out":
      return `RepairPDB was killed by its ${seconds(repair.budgetMs)} s budget after ${seconds(repair.elapsedMs)} s${progress}${incomplete}`;
    case "failed":
      return `RepairPDB failed after ${seconds(repair.elapsedMs)} s (exit ${repair.exitCode ?? "?"}${repair.signal ? `, ${repair.signal}` : ""})${incomplete}` +
        `${repair.stderrTail ? `: ${repair.stderrTail.split("\n").slice(-3).join(" | ")}` : ", empty stderr"}`;
    case "no-output":
      return `RepairPDB exited without writing wt_Repair.pdb after ${seconds(repair.elapsedMs)} s${incomplete}`;
    case "completed":
      return `RepairPDB completed in ${seconds(repair.elapsedMs)} s${incomplete}`;
    case "reused":
      return repair.elapsedMs !== undefined ? `joined the background RepairPDB of this structure after ${seconds(repair.elapsedMs)} s` : "RepairPDB output reused from cache";
    case "skipped":
      return `RepairPDB skipped (${repair.skipReason ?? "not applicable"}${repair.elapsedMs !== undefined ? `; waited ${seconds(repair.elapsedMs)} s for the background repair of this structure, which did not finish` : ""})`;
  }
}

function describeRun(ctx: FoldxRunContext): string {
  return `${(ctx.budgetMs / 1000).toFixed(0)} s budget; ${ctx.residueCount} residues, ${ctx.template} template, ` +
    `${ctx.numberOfRuns} runs${ctx.emulated ? ", emulated through Box64" : ""}` +
    (ctx.repair ? `; ${describeRepair(ctx.repair, ctx.residueCount)}` : "");
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
  /**
   * Whether FoldX ran through Box64. The runner knows (`getFoldxExecutionTarget`); the binary path
   * never contains "box64", so inferring it from the path reported `emulated: false` for every
   * production timeout on the ARM host.
   */
  emulated?: boolean;
  /** What RepairPDB did first (see {@link FoldxRunContext.repair}). */
  repair?: FoldxRepairDiagnostic;
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
    host: { platform: process.platform, arch: process.arch, emulated: input.emulated ?? /box64/i.test(input.binary) },
    ...(input.repair ? { repair: input.repair } : {})
  };
}
