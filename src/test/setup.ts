import "@testing-library/jest-dom";

/**
 * Test-environment safety: never touch the developer's real analysis database.
 *
 * `AnalysisDatabase.getInstance()` defaults to `<cwd>/data/analyses.sqlite`
 * (server/services/infra/analysis-db-core.ts), and `clearAllCaches(true)` — which
 * several suites call in `beforeEach` — issues
 * `DELETE FROM external_cache; DELETE FROM variant_analyses;`
 * (server/services/infra/analysis-db.ts).
 *
 * Running the suite without this guard therefore erased the developer's saved
 * analyses and their persisted cache. Point the default at an in-memory database
 * instead; the worker pool inherits the variable, and `:memory:` is the
 * isolation strategy the DB suites already use explicitly.
 *
 * An explicitly provided ANALYSIS_DB_PATH is respected, so a test that needs a
 * real file can still opt in.
 */
if (!process.env.ANALYSIS_DB_PATH) {
  process.env.ANALYSIS_DB_PATH = ":memory:";
}
