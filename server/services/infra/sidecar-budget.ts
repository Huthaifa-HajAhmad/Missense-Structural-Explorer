/**
 * sidecar-budget.ts — tells the model server how long the caller will wait.
 *
 * The model server runs on CPU, one forward pass at a time, and a thread cannot be killed once it
 * has started. A request the caller already gave up on (its own timer fired) used to stay in that
 * queue and take its turn anyway, so live requests waited behind dead ones. The caller now sends
 * how many milliseconds it will wait; the sidecar turns that into a deadline and refuses to START
 * a pass after it. See `BudgetHeaderMiddleware` and `PriorityCpuGate` in
 * `tools/model_server_app/engine_resilience.py` — `server/tests/sidecar-budget.test.ts` fails if the
 * two sides stop using the same header name.
 *
 * The value is relative (milliseconds from now), not a clock time, so Node and the sidecar need no
 * shared clock.
 */
export const SIDECAR_BUDGET_HEADER = "X-Budget-Ms";

/**
 * What a refused call means for the model it was asking about.
 *
 * The model server answers `503` when its CPU gate turns a pass away because the caller's own deadline
 * had already passed (`GateDeadlineExceeded`, `tools/model_server_app/engine_resilience.py`). Before
 * this mapping that refusal was a bare `500`, and every caller here reads an unrecognised status as
 * `offline` — so a server that had just ANSWERED was reported to the reader as "Offline", which is a
 * different fact and a wrong one. The pass was refused because the box was busy: a timeout, and
 * retryable.
 *
 * 401/403 stay `unauthorized` (our secret or the caller's token was refused) and anything else stays
 * `offline` (no usable answer at all).
 */
export function sidecarFailure(
  label: string,
  status: number
): { error: string; status: "unauthorized" | "timeout" | "offline" } {
  if (status === 401 || status === 403) {
    return { error: `${label} sidecar returned HTTP ${status}`, status: "unauthorized" };
  }
  if (status === 503) {
    return {
      error: `${label} did not start: the model server was still busy with earlier work`,
      status: "timeout"
    };
  }
  return { error: `${label} sidecar returned HTTP ${status}`, status: "offline" };
}
