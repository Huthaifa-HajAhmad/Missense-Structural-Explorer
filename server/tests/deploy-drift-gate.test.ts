import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * A commit that can never deploy must not read as "the watch is happy".
 *
 * `cd.yml` is gated on a SUCCESSFUL push run of `ci.yml`: its job `if` refuses anything else. Nothing
 * retries a gate that was cancelled or failed, so a merge whose CI push run was cancelled has no
 * deploy coming — ever — and production stays on the previous revision until a human notices.
 *
 * That is what happened on 2026-11-11. `main@451b01ea`'s CI push run was cancelled 69 s in by
 * `concurrency: cancel-in-progress` (a second merge landed), so its CD run concluded `skipped`. The
 * drift watch's "no deploying CD run for this sha" branch looked at CI, printed
 * `::warning::... Not failing the watch`, and exited 0 — on every hourly cron and every CD completion
 * for the next 29 hours, while production served the prior merge. A watcher that reports green for a
 * revision that cannot deploy is worse than no watcher, because it is the signal people trust.
 *
 * So the branch now decides instead of warning: a CI run still queued/in progress, or a commit that
 * is seconds old, is a notice (a deploy may still arrive); CI completed without success, or green CI
 * with no CD run after a short scheduling window, is a failure that names the fix.
 *
 * These assertions read the shipped YAML rather than a copy of it, so the policy cannot drift away
 * from the file the runner executes.
 */

const REPO_ROOT = process.cwd();

const workflow = fs.readFileSync(
  path.join(REPO_ROOT, ".github", "workflows", "deploy-drift.yml"),
  "utf-8"
);

const BRANCH_START = 'if [ -z "$run_json" ]; then';
const BRANCH_END = "\n          STATUS=$(printf";

/** The `if [ -z "$run_json" ]` block: the branch that runs when no CD run ever deployed this sha. */
function noDeployingRunBranch(): string {
  const start = workflow.indexOf(BRANCH_START);
  expect(start, `expected the drift watch to keep its "${BRANCH_START}" branch`).toBeGreaterThan(-1);
  const end = workflow.indexOf(BRANCH_END, start);
  expect(end, "expected the branch to stop before the CD-run verdict is parsed").toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("drift watch — a commit nothing will deploy", () => {
  it("no longer decides that case was fine", () => {
    // The regression, verbatim: read CI's state, print a warning, exit 0 regardless.
    expect(noDeployingRunBranch()).not.toContain("has no deploying CD run yet");
  });

  it("asks CI about this commit, not just about main", () => {
    const branch = noDeployingRunBranch();
    expect(branch, "the branch must read CI runs").toContain("--workflow=ci.yml");
    expect(branch, "the CI lookup must be pinned to this sha").toContain(
      'select(.headSha == \\"$main\\")'
    );
  });

  it("fails when CI finished without success, because a skipped gate is never retried", () => {
    const branch = noDeployingRunBranch();
    expect(branch, "a completed non-success CI run must render an error").toContain("::error::");
    expect(branch, "and it must exit non-zero").toMatch(/exit 1/);
    expect(branch, "the failure must be finalised on the commit's deploy status").toContain(
      "set_status failure"
    );
  });

  it("still waits, and only while waiting is honest", () => {
    const branch = noDeployingRunBranch();
    // A CI run that is queued or in progress is the one case where a deploy can still arrive.
    expect(branch).toContain('if [ "${CI_STATUS:-}" != "completed" ]; then');
    // The in-flight check must come FIRST: a running gate may never reach the conclusion verdict.
    const inFlight = branch.indexOf('if [ "${CI_STATUS:-}" != "completed" ]; then');
    const concludedVerdict = branch.indexOf('if [ "${CI_CONCLUSION:-}" != "success" ]; then');
    expect(concludedVerdict, "a running CI run must be checked before the conclusion").toBeGreaterThan(
      inFlight
    );
    // And the branch must end on the failure verdict, not fall through to "fine".
    const lastExit = branch.match(/exit [01]/g)?.pop();
    expect(lastExit, "the branch must not end by exiting 0").toBe("exit 1");
  });

  it("gives a green CI run a scheduling window before calling it drift", () => {
    // CI -> CD is a workflow_run hop that normally takes seconds. Failing instantly would red-X a
    // healthy merge whose CD run has not been created yet — the false positive this watch already
    // learned to avoid in 2026-10-12.
    const branch = noDeployingRunBranch();
    expect(branch, "a green CI run must not fail the watch on the first look").toMatch(
      /CI_CONCLUSION:-\}" != "success"/
    );
    expect(branch).toContain("CD_TRIGGER_MINUTES");
    expect(workflow, "the window must be a named, documented constant").toMatch(
      /CD_TRIGGER_MINUTES:\s*"10"/
    );
  });
});
