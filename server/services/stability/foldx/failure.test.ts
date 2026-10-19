import { describe, expect, it } from "vitest";
import { canRetryFoldxAfterRepair, classifyFoldxFailure, describeFoldxFailure, foldxCrashContext, parseRepairProgress, tailOutput } from "./failure";

describe("FoldX failure diagnostics", () => {
  const crash = { message: "Command failed: /usr/local/bin/box64 foldx --command=BuildModel", stderr: "[BOX64] Signal 11 function handler SIG_DFL\nUnhandled signal caught, aborting" };
  it("identifies the reported Box64 crash without declaring the input invalid", () => {
    expect(classifyFoldxFailure(crash)).toBe("runtime-crash");
    const diagnostic = describeFoldxFailure(crash, false);
    expect(diagnostic).toContain("native process crash through Box64");
    expect(diagnostic).toContain("Signal 11");
    expect(diagnostic).not.toContain("unknown cause");
    expect(diagnostic).toContain("does not establish that the PDB is invalid");
  });
  it("classifies our own budget kill as a timeout even when Box64 prints a signal on the way down", () => {
    const killedByBudget = { ...crash, killed: true, signal: "SIGTERM" };
    expect(classifyFoldxFailure(killedByBudget)).toBe("timeout");
    expect(describeFoldxFailure(killedByBudget, false)).toContain("exceeded its execution budget");
    expect(describeFoldxFailure(killedByBudget, false)).not.toContain("native process crash");
  });
  it("does not retry a process crash on another template", () => {
    expect(canRetryFoldxAfterRepair(true, crash)).toBe(false);
  });
  it("does not retry cancellation or exhausted budgets", () => {
    const controller = new AbortController();
    controller.abort();
    expect(canRetryFoldxAfterRepair(true, new Error("failed"), controller.signal)).toBe(false);
    expect(canRetryFoldxAfterRepair(true, { name: "AbortError" })).toBe(false);
    expect(canRetryFoldxAfterRepair(true, { killed: true })).toBe(false);
  });
  it("allows the existing original-template fallback only after repair and ordinary execution failure", () => {
    expect(canRetryFoldxAfterRepair(true, new Error("engine rejected cleaned input"))).toBe(true);
    expect(canRetryFoldxAfterRepair(false, new Error("engine rejected input"))).toBe(false);
  });
  it("reports missing output and execution timeout explicitly", () => {
    expect(classifyFoldxFailure(new Error("BuildModel completed without producing a mutant PDB"))).toBe("missing-output");
    expect(describeFoldxFailure({ signal: "SIGTERM", message: "killed" }, false)).toContain("execution budget");
  });
  it("states the budget, size, template and emulation in a timeout, so it can be diagnosed from the log", () => {
    const timeout = { killed: true, signal: "SIGTERM", message: "Command failed: /usr/local/bin/box64 foldx --command=BuildModel" };
    const text = describeFoldxFailure(timeout, false, {
      budgetMs: 180000, residueCount: 1085, numberOfRuns: 5, template: "unrepaired (AlphaFold model)", emulated: true
    });
    expect(text).toBe(
      "FoldX BuildModel exceeded its execution budget (180 s budget; 1085 residues, unrepaired (AlphaFold model) template, " +
      "5 runs, emulated through Box64): Command failed: /usr/local/bin/box64 foldx --command=BuildModel"
    );
  });
  it("captures a reproducible crash context without logging coordinates", () => {
    const context = foldxCrashContext({ binary: "/usr/local/bin/box64", jobDir: "/tmp/job", pdbText: ["ATOM  1", "ATOM  2", "HETATM 3"].join("\n"), mutation: "QA867H;", args: ["--command=BuildModel"] });
    expect(context).toMatchObject({ jobDir: "/tmp/job", atomRecords: 2, hetatmRecords: 1, host: { emulated: true } });
    expect(JSON.stringify(context)).not.toContain("ATOM  1");
  });
});

describe("RepairPDB diagnostics in a failure record", () => {
  // Lines FoldX 5.1 printed for CNNM2 6N7E chain A (305 residues, 44 truncated side chains) on the OCI host.
  const repairStdout = [
    "Start RepairPDB >>>",
    "1 models read: wt.pdb",
    "Repair will take all residues into account",
    "number of incomplete residues = 44",
    "completing sidechain atoms of LEUA432",
    "Now optimizing Residue GLUA431",
    "Optimize Residue ID= GLUA431",
    "Now optimizing Residue LEUA432",
    "Now optimizing Residue ASNA433",
  ].join("\n");

  it("reads how far RepairPDB got from FoldX's own output", () => {
    expect(parseRepairProgress(repairStdout)).toEqual({ incompleteResidues: 44, residuesOptimised: 3, lastResidue: "ASNA433" });
    expect(parseRepairProgress("")).toEqual({ incompleteResidues: undefined, residuesOptimised: 0, lastResidue: null });
  });

  it("says a repair was killed by its budget, and how far it was, instead of 'repair failed'", () => {
    const timeout = { killed: true, signal: "SIGTERM", message: "Command failed: /usr/local/bin/box64 foldx --command=BuildModel" };
    const text = describeFoldxFailure(timeout, true, {
      budgetMs: 180000, residueCount: 305, numberOfRuns: 5, template: "unrepaired (repair failed)", emulated: true,
      repair: { outcome: "timed-out", budgetMs: 420000, elapsedMs: 420012, ...parseRepairProgress(repairStdout) }
    });
    expect(text).toContain("RepairPDB was killed by its 420 s budget after 420 s, had optimised 3 of 305 residues (at ASNA433); 44 incomplete residues");
  });

  it("says when the job joined a background repair, including one that landed at once", () => {
    const ctx = { budgetMs: 180000, residueCount: 305, numberOfRuns: 5, template: "repaired (reused)", emulated: true };
    const timeout = { killed: true, message: "m" };
    expect(describeFoldxFailure(timeout, false, { ...ctx, repair: { outcome: "reused", elapsedMs: 95_400 } }))
      .toContain("joined the background RepairPDB of this structure after 95 s");
    expect(describeFoldxFailure(timeout, false, { ...ctx, repair: { outcome: "reused", elapsedMs: 0 } }))
      .toContain("joined the background RepairPDB of this structure after 0 s");
    expect(describeFoldxFailure(timeout, false, { ...ctx, repair: { outcome: "reused" } }))
      .toContain("RepairPDB output reused from cache");
  });

  it("says when a skipped repair cost the job a wait for the background one", () => {
    const ctx = { budgetMs: 600000, residueCount: 305, numberOfRuns: 5, template: "unrepaired (repair exceeds its budget under Box64)", emulated: true };
    const timeout = { killed: true, message: "m" };
    expect(describeFoldxFailure(timeout, false, { ...ctx, repair: { outcome: "skipped", skipReason: "repair-exceeds-budget", elapsedMs: 220_000 } }))
      .toContain("RepairPDB skipped (repair-exceeds-budget; waited 220 s for the background repair of this structure, which did not finish)");
    expect(describeFoldxFailure(timeout, false, { ...ctx, repair: { outcome: "skipped", skipReason: "repair-exceeds-budget" } }))
      .toContain("RepairPDB skipped (repair-exceeds-budget)");
  });

  it("records an empty stderr as empty rather than leaving the reader to wonder", () => {
    const text = describeFoldxFailure({ killed: true, message: "m" }, true, {
      budgetMs: 1000, residueCount: 10, numberOfRuns: 5, template: "unrepaired (repair failed)", emulated: false,
      repair: { outcome: "failed", elapsedMs: 3000, exitCode: 1, stderrTail: "" }
    });
    expect(text).toContain("RepairPDB failed after 3 s (exit 1), empty stderr");
  });

  it("carries the repair diagnostic and the real emulation flag in the crash context", () => {
    const repair = { outcome: "timed-out" as const, budgetMs: 420000, elapsedMs: 420000 };
    const context = foldxCrashContext({
      binary: "/app/tools/foldx_linux/foldx_20261231", jobDir: "/tmp/job", pdbText: "ATOM  1", mutation: "SA489C;", args: [], emulated: true, repair
    });
    // The binary path never contains "box64"; inferring emulation from it reported `false` on the ARM host.
    expect(context.host.emulated).toBe(true);
    expect(context.repair).toEqual(repair);
  });

  it("keeps the tail of long output to whole lines", () => {
    const text = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const tail = tailOutput(text, 100);
    expect(tail.length).toBeLessThanOrEqual(100);
    expect(tail.startsWith("line ")).toBe(true);
    expect(tail.endsWith("line 499")).toBe(true);
  });
});
