/**
 * timeouts.ts — client-side time budgets for the biophysical pipeline.
 *
 * These live in `src/shared` for one reason: the FoldX budgets only work if they **nest** with
 * the server's, and the only way to assert that is for one test to see both sides. `server/config.ts`
 * holds the server budgets; `server/tests/foldx-timeout-budget.test.ts` imports both and fails the
 * build if the ordering is ever broken (a server test may import `src/shared`; a client test may
 * not import the server, which is why the shared module exists).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE ARE THREE BUDGETS AND NOT ONE (read before changing a number)
 * ─────────────────────────────────────────────────────────────────────────────
 * The first version of this module had a single client budget plus an absolute watchdog, and it
 * reproduced the very defect it was written to remove. A FoldX job spends its life in two different
 * states, and only one of them is the job's own fault:
 *
 *   • **queued** — waiting for a concurrency slot. The server permits this to last
 *     `CONFIG.timeouts.foldxQueuedLeaseMs` (1800 s), because a job can sit behind several 840 s
 *     executions.
 *   • **running** — actually executing. Budgeted by `CONFIG.timeouts.foldxSec` (900 s).
 *
 * A single 1000 s client budget covered *queue wait plus execution*, so a job that waited 300 s and
 * then ran for 800 s was abandoned at 1000 s — and because nothing cancels the server job, the
 * server finished it and wrote a result no client would ever read. The client is the one that gives
 * up, so the client is the one that has to budget the phases separately and restart its clock when
 * the server first reports `running`.
 *
 * The required ordering, asserted by `server/tests/foldx-timeout-budget.test.ts`:
 *
 *   server work ≤ foldxSec < foldxReaperLeaseMs ≤ CLIENT_FOLDX_QUEUE_BUDGET_MS
 *   server work ≤ foldxSec < CLIENT_FOLDX_POLL_BUDGET_MS
 *
 * There is deliberately **no absolute watchdog** any more: it reintroduced the same class of race
 * (it fired while the job was still legitimately queued, because it was armed before submission and
 * could not see the phase), and `foldxService` now bounds every phase itself.
 */

/**
 * How long the initial `/generate-mutant` request may take.
 *
 * Generous because that request can resolve a structure from PDBe and fall back to AlphaFold, each
 * with its own transport budget. Without this the POST had no timeout at all, so a stalled
 * connection left the spinner up indefinitely.
 */
export const CLIENT_FOLDX_SUBMIT_BUDGET_MS = 120_000; // 120 s

/**
 * How long a job may wait in the queue before the client gives up on it.
 *
 * Must be at least the server's queued-job lease (`CONFIG.timeouts.foldxQueuedLeaseMs`), otherwise
 * the client abandons jobs the server is still legitimately holding.
 */
export const CLIENT_FOLDX_QUEUE_BUDGET_MS = 1_800_000; // 1800 s

/**
 * How long a job may **execute** before the client gives up.
 *
 * Must exceed the server's whole-job cap (`CONFIG.timeouts.foldxSec`), otherwise the client
 * abandons jobs the server is still running. This clock starts when the server first reports the job
 * as `running`, so queue wait does not consume it.
 */
export const CLIENT_FOLDX_POLL_BUDGET_MS = 1_000_000; // 1000 s

/**
 * Per-request ceiling inside the poll loop.
 *
 * Bounds a single stalled poll so the loop's own deadline is always reached, rather than the loop
 * hanging inside one fetch.
 */
export const CLIENT_FOLDX_POLL_REQUEST_MS = 30_000; // 30 s

/**
 * Minimum interval between automatic biophysics retries for the same variant.
 *
 * The backfill gate used to be permanently true (see `workflowOrchestrator`), so every visit
 * re-ran a multi-minute FoldX job and then overwrote the good cached status with a fresh failure.
 * With the predicate fixed, this cooldown covers the remaining case: a snapshot that keeps
 * failing for a reason a retry cannot fix. There is no negative caching or circuit breaker behind
 * it, so this timer IS the backpressure — do not set it to zero.
 */
export const BIOPHYSICS_RETRY_COOLDOWN_MS = 15 * 60 * 1000; // 15 min
