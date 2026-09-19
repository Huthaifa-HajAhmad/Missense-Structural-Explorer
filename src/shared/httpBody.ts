/**
 * httpBody.ts — reading a response body under a deadline.
 *
 * WHY THIS EXISTS
 * ---------------
 * `fetch` timeouts (including `fetchWithAuth`'s `options.timeout`) cover the *headers*. They are
 * cleared as soon as the response resolves, which happens on the first byte — before the body has
 * been read. So `await res.json()` has no deadline at all, and a server (or a proxy, or a
 * half-closed connection) that sends headers and then stalls leaves the caller hung forever.
 *
 * That was measured, not assumed: with `timeout: 400`, `fetchWithRetry` resolved in 14 ms on
 * headers plus a partial body, and `await res.json()` was still pending after 3000 ms.
 *
 * This matters here specifically because an earlier change deleted the FoldX pipeline's absolute
 * watchdog. The watchdog could not tell a queued job from a running one — which is why it went — but
 * it *did* bound the whole operation, body reads included, and nothing replaced that coverage.
 * The poll loop's phase deadlines are checked between iterations, so a loop stalled inside one
 * `res.json()` never reaches them. This closes that gap.
 *
 * This is the ONE body-deadline implementation. `fetch-retry.ts` grew a second race of its own for the
 * configuration-error probe, and two implementations of one rule in adjacent layers is precisely how they
 * drift — so the text case moved here and that call site now uses it.
 *
 * The abandoned `response.json()` promise is not cancellable; the caller stops waiting on it, which
 * is the whole point. The socket is released when the response is collected.
 */

/**
 * The shared mechanism: race `work` against `ms`, rejecting with a message that names what happened.
 *
 * "The request timed out" would be indistinguishable from a HEADER timeout and sends people looking in
 * the wrong place, so the message says which part of the response never arrived.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Sub-second budgets must not render as "within 0s" — a message that reads as though no
          // time was allowed at all.
          const budget = ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
          reject(
            new Error(`The server sent response headers but its body did not arrive within ${budget}.`)
          );
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Resolves with the parsed JSON body, or rejects if it has not arrived within `ms`.
 *
 * The default type parameter mirrors `Response.json()`, which returns `any` — callers that want a
 * checked shape pass one, and the existing call sites keep the ergonomics they had.
 */
export async function readJsonWithTimeout<T = any>(response: Response, ms: number): Promise<T> {
  return withDeadline(response.json() as Promise<T>, ms);
}

/**
 * The same deadline for a TEXT body — used by the retry layer's configuration-error probe.
 *
 * `ms: null` means NO deadline, which that probe needs when the caller set none: it still has to read
 * the body to spot an `API_KEY_MISSING`, and an unbounded `response.text()` is correct there. `ms <= 0`
 * rejects, because no budget remained; the probe folds that to "not a configuration error" at its own
 * call site, which is where that judgement belongs.
 *
 * Callers that need to keep the original response must pass a CLONE: reading a body consumes it.
 */
export async function readTextWithTimeout(response: Response, ms: number | null): Promise<string> {
  if (ms === null) return response.text();
  if (ms <= 0) throw new Error("The server sent response headers but no body budget remained.");
  return withDeadline(response.text(), ms);
}
