/**
 * fetch-retry.ts — Consolidated client-side fetch retry utility.
 *
 * Provides:
 *   - Exponential backoff with jitter
 *   - Automatic retry for 429 (rate-limit) and transient 5xx gateway errors (502, 503, 504)
 *   - Non-retryable error detection (e.g. API_KEY_MISSING / isConfigError)
 *   - Proper AbortSignal cascading and timeout cleanup
 *   - `Retry-After` awareness and a caller-budget guard (see below)
 *
 * WHY THE BUDGET GUARD EXISTS
 * ---------------------------
 * The caller (authSession) arms ONE watchdog for the WHOLE call and passes the same value as
 * the per-attempt `timeout`, so a retry can be aborted mid-flight by a timer that was already
 * running when it started. Observed production failure, `POST /api/v1/translate-variant`:
 * the server correctly answered `503 Retry-After: 60` after exhausting its 25s provider ladder;
 * this utility retried 430ms later (ignoring the hint), the second attempt began another 25s
 * ladder, the caller's 45s watchdog fired inside it, and the user was shown the bare
 * "Analysis query error: Request timed out after 45000ms" — the server's actionable guidance
 * ("enter the protein-level substitution directly") destroyed by a scheduling bug.
 *
 * Two rules fix that:
 *   1. A `Retry-After` longer than {@link MAX_IN_REQUEST_RETRY_AFTER_MS} is not waited out
 *      in-request — the server already told us when to come back, so return its response and
 *      let its message reach the UI.
 *   2. A retry is not started unless it can plausibly finish inside `totalTimeoutMs`; the last
 *      response (or error) is returned instead of being replaced by a caller-side timeout.
 */

export interface FetchRetryOptions extends RequestInit {
  timeout?: number;
  /**
   * Whole-call budget that the caller's watchdog enforces. When set, retries that cannot
   * finish within it are skipped so the last server response survives to the user.
   */
  totalTimeoutMs?: number;
}

/**
 * Longest `Retry-After` this utility is willing to wait inside a single request.
 *
 * Beyond this, waiting cannot help: the server is advertising a cooldown (the coordinate
 * ladder sends 60s) that outlasts any interactive request budget, and the response body it
 * just returned is more useful to the caller than a timeout would be.
 */
export const MAX_IN_REQUEST_RETRY_AFTER_MS = 2000;

/**
 * Parses a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds.
 * Returns `null` when the header is absent or unparseable, so callers fall back to backoff.
 */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number.parseInt(header.trim(), 10);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** Sleep that rejects as soon as `signal` aborts, so cancellation is never waited out. */
function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: any = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new DOMException("The user aborted a request.", "AbortError"));
    };

    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Exponential backoff with jitter, used when the server gives no usable Retry-After. */
function backoffDelay(attempt: number, initialDelay: number, backoffFactor: number): number {
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(initialDelay * Math.pow(backoffFactor, attempt - 1) * jitter);
}

export async function fetchWithRetry(
  url: string,
  options: FetchRetryOptions = {},
  maxRetries = 2,
  initialDelay = 500,
  backoffFactor = 2
): Promise<Response> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("You appear to be offline. Please verify your internet connection and try again.");
  }

  const callStartedAt = Date.now();

  const budgetRemainingMs = (): number | null =>
    options.totalTimeoutMs ? options.totalTimeoutMs - (Date.now() - callStartedAt) : null;

  /**
   * Can another attempt finish before the caller's watchdog fires?
   *
   * The last attempt's duration is the only honest estimate available, so it is used as the
   * projected cost. Starting a retry that cannot fit is strictly worse than not retrying: its
   * result is discarded when the watchdog aborts it, and the caller reports a timeout instead
   * of the response the server already produced.
   */
  const canAffordRetry = (delayMs: number, lastAttemptMs: number): boolean => {
    const remaining = budgetRemainingMs();
    if (remaining === null) return true;
    return remaining - delayMs - lastAttemptMs > 0;
  };

  let attempt = 0;

  while (true) {
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    const timeoutVal = options.timeout ?? 60000;
    const timeoutId = setTimeout(() => {
      controller.abort(new DOMException(`Network request timed out after ${timeoutVal}ms`, "TimeoutError"));
    }, timeoutVal);

    const onSignalAbort = () => controller.abort(options.signal?.reason);
    if (options.signal) {
      options.signal.addEventListener("abort", onSignalAbort);
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      }
    }

    const fetchOptions: RequestInit = { ...options, signal: controller.signal };
    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onSignalAbort);
      }

      if (response.ok) {
        return response;
      }

      const shouldRetryStatus = [502, 503, 504, 429].includes(response.status) || response.status >= 500;
      if (shouldRetryStatus && attempt < maxRetries) {
        // Fast-path: Check response body for unrecoverable auth/config errors
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (text.includes("API_KEY_MISSING") || text.includes("isConfigError")) {
            return response; // Bypass retry for missing/invalid credentials
          }
        } catch {
          // Ignore body read error
        }

        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("Retry-After"));

        // Rule 1: an advertised cooldown longer than a request can wait is not waited out.
        if (retryAfterMs !== null && retryAfterMs > MAX_IN_REQUEST_RETRY_AFTER_MS) {
          console.warn(
            `[Client Retry] ${url} answered ${response.status} with Retry-After ${retryAfterMs}ms, ` +
              `longer than a single request can wait (limit ${MAX_IN_REQUEST_RETRY_AFTER_MS}ms) — ` +
              "returning the response so its message reaches the user instead of retrying."
          );
          return response;
        }

        attempt++;
        const delay =
          retryAfterMs !== null ? retryAfterMs : backoffDelay(attempt, initialDelay, backoffFactor);

        // Rule 2: never start a retry the caller's watchdog would abort mid-flight.
        if (!canAffordRetry(delay, Date.now() - attemptStartedAt)) {
          console.warn(
            `[Client Retry] Skipping retry of ${url} (status ${response.status}): ${delay}ms delay plus ` +
              `~${Date.now() - attemptStartedAt}ms attempt would exceed the request budget — ` +
              "returning the response instead."
          );
          return response;
        }

        console.warn(`[Client Retry] Endpoint ${url} returned status ${response.status}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await abortableDelay(delay, options.signal);
        continue;
      }
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onSignalAbort);
      }

      if (err.name === "AbortError" || options.signal?.aborted) {
        throw err;
      }

      if (attempt < maxRetries) {
        attempt++;
        const delay = backoffDelay(attempt, initialDelay, backoffFactor);

        if (!canAffordRetry(delay, Date.now() - attemptStartedAt)) {
          console.warn(
            `[Client Retry] Skipping retry of ${url} after "${err.message || err}": ${delay}ms delay plus ` +
              `~${Date.now() - attemptStartedAt}ms attempt would exceed the request budget — surfacing the error instead.`
          );
          throw err;
        }

        console.warn(`[Client Retry] Endpoint ${url} threw error: ${err.message || err}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await abortableDelay(delay, options.signal);
        continue;
      }
      throw err;
    }
  }
}
