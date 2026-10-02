import "@testing-library/jest-dom";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Test-environment safety: no test may read or write the repository's real state.
 *
 * WHY THIS FILE IS LOAD-BEARING
 * -----------------------------
 * Every guard below exists because running the suite damaged real developer state. These are
 * incidents, not precautions:
 *
 *   1. `ANALYSIS_DB_PATH` — `clearAllCaches(true)`, which many suites call in `beforeEach`,
 *      issues `DELETE FROM external_cache; DELETE FROM variant_analyses;` against
 *      `data/analyses.sqlite`. Running the suite erased the developer's saved analyses.
 *   2. `SHARED_STATE_DB_PATH` — `server/routes/state.ts` constructs its queue database in a
 *      MODULE-SCOPE initialiser and is reachable from `middleware.ts` through a VALUE import of
 *      `PUBLIC_ENDPOINTS`, so merely importing the API router opened the real database. Two
 *      suites additionally `fs.rmSync`'d that same file.
 *   3. `AUDIT_LOG_PATH` / `JOB_REGISTRY_PATH` — route tests appended real records to
 *      `logs/audit.jsonl` and deleted the live `temp_jobs/job_registry.json`.
 *   4. `RASP_CSV_PATH` / `RASP_SQLITE_PATH` — `energy-models.test.ts` overwrote the real
 *      414 MB `data/df_rasp_gnomad_clinvar.csv` with a five-line mock and restored it only in
 *      `afterAll`, so an interrupt, timeout or OOM destroyed it permanently. This is the
 *      highest-consequence path in the suite.
 *
 * ORDERING MATTERS: this runs before any test module is imported, which is the only ordering
 * that works — several modules resolve their storage paths at import time, so an override
 * applied later would be too late.
 *
 * The root lives under the OS temp directory, so a crashed run cannot leave mock content where
 * production reads it.
 */
// Each setup execution belongs to one test file. Parallel files (and concurrent agent runs)
// must not clear another file's caches/database/fixtures through the same redirected directory.
const TEST_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "missense-test-state-"));

/** Redirect targets, one per real path a module resolves. */
const TEST_STATE_ENV: Record<string, string> = {
  SHARED_STATE_DB_PATH: path.join(TEST_STATE_ROOT, "data", "shared_state.sqlite"),
  AUDIT_LOG_PATH: path.join(TEST_STATE_ROOT, "logs", "audit.jsonl"),
  JOB_REGISTRY_PATH: path.join(TEST_STATE_ROOT, "temp_jobs", "job_registry.json"),
  RASP_CSV_PATH: path.join(TEST_STATE_ROOT, "data", "df_rasp_gnomad_clinvar.csv"),
  RASP_SQLITE_PATH: path.join(TEST_STATE_ROOT, "data", "df_rasp_gnomad_clinvar.sqlite"),
  /**
   * The FoldX disk cache and the `/debug/clear-caches` handler that empties it.
   *
   * These were the last unredirectable real-state deleters: the handler used hardcoded
   * `process.cwd()` paths and read no variable, and a route suite calls it directly, so every
   * suite run emptied the developer's real `logs/foldx_cache` (hours of recomputation) and
   * deleted the live job registry.
   */
  FOLDX_CACHE_DIR: path.join(TEST_STATE_ROOT, "logs", "foldx_cache"),
  GEMINI_CACHE_DIR: path.join(TEST_STATE_ROOT, "logs", "gemini_cache"),
};

for (const dir of [
  path.join(TEST_STATE_ROOT, "data"),
  path.join(TEST_STATE_ROOT, "logs"),
  path.join(TEST_STATE_ROOT, "temp_jobs"),
  path.join(TEST_STATE_ROOT, "logs", "gemini_cache"),
  path.join(TEST_STATE_ROOT, "logs", "foldx_cache"),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Refuse to start if a redirect did not take effect.
 *
 * This is the part that makes the guard trustworthy rather than hopeful. The reason this class
 * of bug survived several rounds of fixing is that a missing override is INVISIBLE: the suite
 * passes green while writing real files. Asserting here converts silent data loss into an
 * immediate, obvious failure — including the case where the operator has exported a real
 * `ANALYSIS_DB_PATH` in their shell or CI, which previously caused the guard to stand down.
 */
function resolveRealStateDir(target: string): boolean {
  const repoStateDirs = ["data", "logs", "temp_jobs"].map(d => path.join(process.cwd(), d));
  const resolved = path.resolve(target);
  return repoStateDirs.some(dir => resolved === dir || resolved.startsWith(dir + path.sep));
}

/**
 * `NODE_ENV` is a second, independent guard — assert it rather than trust it.
 *
 * `biophysical-queue.ts`, `literature-rag.ts` and `landscape.ts` each decide whether to open a
 * real database by testing `process.env.NODE_ENV === "test"`. Vitest only defaults that variable
 * (`NODE_ENV ||= "test"`), so an inherited value from a shell, CI or Docker wins — and
 * `SHARED_STATE_DB_PATH` is read by only one of the three shared-state writers, so the other two
 * would open the real file. Vitest guarantees the value, which makes asserting it safe.
 */
if (process.env.NODE_ENV !== "test") {
  throw new Error(
    `[test-setup] NODE_ENV is "${process.env.NODE_ENV}" rather than "test". Modules that gate real ` +
    `database access on it would open the developer's real state. Unset NODE_ENV, or set it to "test".`
  );
}

for (const [key, value] of Object.entries(TEST_STATE_ENV)) {
  // Overwrite unconditionally: an inherited value is far more likely to be a real path than a
  // deliberate test redirect.
  process.env[key] = value;
  if (process.env[key] !== value) {
    throw new Error(`[test-setup] ${key} was not redirected (got ${process.env[key]}).`);
  }
  if (resolveRealStateDir(value)) {
    throw new Error(`[test-setup] ${key} points inside the repository (${value}); tests must not touch real state.`);
  }
}

process.env.ANALYSIS_DB_PATH = ":memory:";
if (process.env.ANALYSIS_DB_PATH !== ":memory:") {
  throw new Error(
    `[test-setup] ANALYSIS_DB_PATH is "${process.env.ANALYSIS_DB_PATH}" rather than ":memory:"; ` +
    `clearAllCaches(true) would delete real rows.`
  );
}

/**
 * jsdom ships no ResizeObserver, and libraries that measure their own list throw on mount without
 * one — that is exactly how `cmdk` sizes its scroll area, so the command palette could not render
 * in a component test at all. A no-op observer is sufficient here: jsdom computes no layout, so
 * every assertion that runs afterwards is about content and behaviour, never geometry.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
}

if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = function () {};
}
