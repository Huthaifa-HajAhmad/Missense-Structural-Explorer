import { describe, expect, it } from "vitest";
import { canRetryFoldxAfterRepair, classifyFoldxFailure, describeFoldxFailure, foldxCrashContext } from "./failure";

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
  it("captures a reproducible crash context without logging coordinates", () => {
    const context = foldxCrashContext({ binary: "/usr/local/bin/box64", jobDir: "/tmp/job", pdbText: ["ATOM  1", "ATOM  2", "HETATM 3"].join("\n"), mutation: "QA867H;", args: ["--command=BuildModel"] });
    expect(context).toMatchObject({ jobDir: "/tmp/job", atomRecords: 2, hetatmRecords: 1, host: { emulated: true } });
    expect(JSON.stringify(context)).not.toContain("ATOM  1");
  });
});
