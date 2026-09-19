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
 * The abandoned `response.json()` promise is not cancellable; the caller stops waiting on it, which
 * is the whole point. The socket is released when the response is collected.
 */

/**
 * Resolves with the parsed JSON body, or rejects if it has not arrived within `ms`.
 *
 * The rejection message names what actually happened, because "the request timed out" is
 * indistinguishable from a header timeout and sends people looking in the wrong place.
 * The default type parameter mirrors `Response.json()`, which returns `any` — callers that want a
 * checked shape pass one, and the existing call sites keep the ergonomics they had.
 */
export async function readJsonWithTimeout<T = any>(response: Response, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return (await Promise.race([
      response.json() as Promise<T>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Sub-second budgets must not render as "within 0s" — a message that reads as though no
          // time was allowed at all.
          const budget = ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
          reject(
            new Error(
              `The server sent response headers but its body did not arrive within ${budget}.`
            )
          );
        }, ms);
      }),
    ])) as T;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
