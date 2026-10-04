import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { CONFIG } from "../config.ts";
import { buildModelBudgetMs, FOLDX_REPAIR_MAX_RESIDUES } from "../services/stability/foldx/budget.ts";
import {
  CLIENT_FOLDX_POLL_BUDGET_MS,
  CLIENT_FOLDX_POLL_REQUEST_MS,
  CLIENT_FOLDX_QUEUE_BUDGET_MS,
  CLIENT_FOLDX_SUBMIT_BUDGET_MS,
} from "../../src/shared/timeouts.ts";

/**
 * The FoldX budgets must NEST, and the client must budget the two phases of a job separately.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * A FoldX run is supervised by several independent timers across two processes. They were all 300 s
 * while the work they supervise can legitimately take 840 s, so the outermost timer always fired
 * first and a *successful* long run was reported to the user as a timeout. Nothing cancels the
 * queued job, so the server kept computing and wrote a result no client would ever read.
 *
 * The first fix replaced four equal timers with four *ordered* ones — and still got it wrong, because
 * a job's life has two phases. A job can legitimately wait `foldxQueuedLeaseMs` (1800 s) for a
 * concurrency slot and then execute for up to `foldxSec` (900 s), so a single client budget covering
 * both abandoned jobs the server completed. The client now budgets queue wait and execution
 * separately, restarting its clock when the server first reports `running`.
 *
 * The defect was invisible because nothing failed when the numbers drifted. This test is the thing
 * that fails now. If you need to break the ordering, change the design — not this test.
 */

const SEC = 1000;
const { timeouts } = CONFIG;

/**
 * Worst-case wall-clock cost of one FoldX job, per PATH, all stages serialised.
 *
 * The BuildModel cap is sized to the structure (`foldx/budget.ts`), so the worst case is no longer
 * the sum of every stage's ceiling. RepairPDB runs only at ≤ FOLDX_REPAIR_MAX_RESIDUES, so a job
 * either repairs and then models a small structure, or skips repair and models a large one. Both
 * paths can still pay the retry (it follows any RepairPDB failure, including the pre-flight one).
 * Each path is computed under emulation, the slower host.
 */
const REPAIRED_PATH_MS =
  timeouts.foldxSemaphoreWaitMs +
  timeouts.foldxRepairMs +
  buildModelBudgetMs({ residueCount: FOLDX_REPAIR_MAX_RESIDUES, numberOfRuns: 5, emulated: true }) +
  timeouts.foldxBuildModelRetryMs;
const LARGE_PATH_MS =
  timeouts.foldxSemaphoreWaitMs +
  buildModelBudgetMs({ residueCount: Number.MAX_SAFE_INTEGER, numberOfRuns: 5, emulated: true }) +
  timeouts.foldxBuildModelRetryMs;
const WORST_CASE_WORK_MS = Math.max(REPAIRED_PATH_MS, LARGE_PATH_MS);

describe("FoldX timeout budgets nest", () => {
  it("budgets the whole job at least as long as the work it supervises", () => {
    const jobCapMs = timeouts.foldxSec * SEC;
    expect(
      WORST_CASE_WORK_MS,
      `worst-case work (${WORST_CASE_WORK_MS / SEC}s; repaired path ${REPAIRED_PATH_MS / SEC}s, ` +
        `large-structure path ${LARGE_PATH_MS / SEC}s) exceeds the job cap (${timeouts.foldxSec}s), ` +
        `so a successful run would be reported as a timeout`
    ).toBeLessThanOrEqual(jobCapMs);
  });

  it("keeps every server timer ordered as work ≤ cap < lease", () => {
    const jobCapMs = timeouts.foldxSec * SEC;
    expect(jobCapMs).toBeLessThan(timeouts.foldxReaperLeaseMs);
    expect(timeouts.foldxReaperLeaseMs).toBeLessThanOrEqual(timeouts.foldxQueuedLeaseMs);
  });

  it("budgets the client's EXECUTION phase beyond the server's job cap", () => {
    expect(
      CLIENT_FOLDX_POLL_BUDGET_MS,
      "the client would abandon jobs the server is still running"
    ).toBeGreaterThan(timeouts.foldxSec * SEC);
  });

  it("budgets the client's QUEUE phase at least as long as the server's queued lease", () => {
    // The assertion whose absence let a queued job be abandoned mid-wait: the previous single client
    // budget (1000 s) was shorter than the queue lease (1800 s).
    expect(
      CLIENT_FOLDX_QUEUE_BUDGET_MS,
      "the client would abandon a job the server is legitimately still queuing"
    ).toBeGreaterThanOrEqual(timeouts.foldxQueuedLeaseMs);
  });

  it("bounds the submit request and each individual poll", () => {
    // Both had no ceiling: a stalled connection hung the spinner with no deadline at all.
    expect(CLIENT_FOLDX_SUBMIT_BUDGET_MS).toBeGreaterThan(0);
    expect(CLIENT_FOLDX_POLL_REQUEST_MS).toBeGreaterThan(0);
    expect(CLIENT_FOLDX_POLL_REQUEST_MS).toBeLessThan(CLIENT_FOLDX_POLL_BUDGET_MS);
  });

  it("has no absolute watchdog left to race the phase budgets", () => {
    // A timer armed before submission cannot distinguish queued from running, which is why the
    // previous watchdog is gone rather than merely re-valued. Matched on the exported constant name,
    // not the word: the module's own prose explains at length WHY there is no watchdog.
    const timeoutsSource = fs.readFileSync(
      path.join(process.cwd(), "src", "shared", "timeouts.ts"),
      "utf-8"
    );
    expect(
      /export\s+const\s+\w*WATCHDOG\w*\s*[=:]/i.test(timeoutsSource),
      "an absolute watchdog reintroduces the queue-phase race; budget the phases in foldxService instead"
    ).toBe(false);
  });
});

describe("FoldX budgets are declared once", () => {
  const REPO_ROOT = process.cwd();

  /**
   * The original defect was independent literals that drifted apart. Scanning for literals is the
   * cheapest way to stop a new one appearing next to a CONFIG lookup.
   */
  it("has no hardcoded stage timeout left in the FoldX runner", () => {
    const runner = fs.readFileSync(
      path.join(REPO_ROOT, "server", "services", "stability", "foldx", "runner.ts"),
      "utf-8"
    );
    expect(
      /timeout:\s*\d/.test(runner),
      "runner.ts hardcodes a numeric exec timeout; use CONFIG.timeouts.foldx* instead"
    ).toBe(false);
    expect(
      /\.acquire\(\s*\d/.test(runner),
      "runner.ts hardcodes a numeric semaphore wait; use CONFIG.timeouts.foldxSemaphoreWaitMs"
    ).toBe(false);
  });

  it("has no hardcoded client budget left in the client timeout sites", () => {
    for (const relative of [
      "src/services/pipeline/foldxService.ts",
      "src/services/pipeline/workflowOrchestrator.ts",
    ]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf-8");
      expect(
        source.includes("300000"),
        `${relative} still contains the old 300000 ms budget literal; import from src/shared/timeouts`
      ).toBe(false);
    }
  });

  it("actually budgets the queue phase in the client poll loop", () => {
    // Guards the behaviour, not just the constants: the queue budget must be consulted somewhere, and
    // the clock must restart when the job starts running, or the phase-aware fix is inert.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "src", "services", "pipeline", "foldxService.ts"),
      "utf-8"
    );
    expect(source).toContain("CLIENT_FOLDX_QUEUE_BUDGET_MS");
    expect(
      /executionStart\s*=\s*Date\.now\(\)/.test(source),
      "foldxService must restart its clock when the job starts running"
    ).toBe(true);
  });
});
