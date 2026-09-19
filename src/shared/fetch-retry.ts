/**
 * fetch-retry.ts — Consolidated client-side fetch retry utility.
 *
 * Provides:
 *   - Exponential backoff with jitter
 *   - Automatic retry for 429 (rate-limit) and transient 5xx gateway errors (502, 503, 504)
 *   - Non-retryable error detection (e.g. API_KEY_MISSING / isConfigError)
 *   - Proper AbortSignal cascading and timeout cleanup
 *   - `Retry-After` awareness and a caller-deadline guard (see below)
 *
 * WHY THE DEADLINE GUARD EXISTS
 * -----------------------------
 * The caller (authSession) arms ONE watchdog for the WHOLE call and passes the same value as
 * the per-attempt `timeout`, so a retry could be aborted mid-flight by a timer that was already
 * running when it started. Observed production failure, `POST /api/v1/translate-variant`:
 * the server correctly answered `503 Retry-After: 60` after exhausting its provider ladder;
 * this utility retried 430ms later (ignoring the hint), the second attempt began a FRESH ladder,
 * the caller's 45s watchdog fired inside it, and the user was shown the bare
 * "Analysis query error: Request timed out after 45000ms" — the server's actionable guidance
 * ("enter the protein-level substitution directly") destroyed by a scheduling bug.
 *
 * Three rules fix that:
 *   1. A `Retry-After` longer than {@link MAX_IN_REQUEST_RETRY_AFTER_MS} is not waited out
 *      in-request — the server already said when to come back, so its response is returned.
 *   2. When the caller supplies a `deadlineAt`, no attempt is started that cannot finish inside
 *      it, and every attempt's own timeout is CAPPED by the time that remains. This is what
 *      makes "no attempt the caller's watchdog can abort" a real invariant rather than an
 *      estimate: the previous version projected the NEXT attempt's cost from the PREVIOUS
 *      attempt's duration, so a fast failure followed by a stalled retry still ended in the
 *      watchdog's timeout with the server's message discarded.
 *   3. `timeout` bounds time-to-headers for the initial response; a caller abort still cancels
 *      a stalled body read, because the forwarding listener stays attached for the lifetime of
 *      the returned response.
 */

export interface FetchRetryOptions extends RequestInit {
  timeout?: number;
  /** Whole-call budget (ms from now) the caller's watchdog enforces. */
  totalTimeoutMs?: number;
  /**
   * Absolute epoch-ms instant by which this call must be finished — the caller's watchdog
   * deadline. Preferred over `totalTimeoutMs`, which necessarily starts counting from inside
   * this function and therefore ignores time already spent (session handshake, re-auth).
   */
  deadlineAt?: number;
  /** Minimum time a started attempt deserves; below this a retry is not worth beginning. */
  minAttemptMs?: number;
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
 * Floor applied to a requested `Retry-After`, mirroring the server's own floor.
 *
 * `Retry-After: 0` would otherwise produce a zero-delay hot retry against a struggling
 * upstream.
 */
export const MIN_RETRY_AFTER_MS = 50;

/** Default minimum time a retry is worth starting. */
const DEFAULT_MIN_ATTEMPT_MS = 250;

/**
 * Parses a `Retry-After` header into milliseconds, or `null` when absent/unusable.
 *
 * Strict by design: `Number.parseInt("12abc")` returns 12, which turned a malformed header into
 * a 12-second delay, and a plausible HTTP-date string was read as ~33 minutes of delta-seconds.
 * Only a plain integer (delta-seconds) or a parseable HTTP-date is accepted; a date already in
 * the past falls back to normal backoff rather than requesting an immediate hot retry.
 */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d{1,10}$/.test(trimmed)) {
    return Math.max(MIN_RETRY_AFTER_MS, Number.parseInt(trimmed, 10) * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  const delta = date - Date.now();
  return delta > 0 ? Math.max(MIN_RETRY_AFTER_MS, delta) : null;
}

/** Sleep that rejects as soon as `signal` aborts, so cancellation is never waited out. */
function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  // Checked BEFORE attaching a listener: an abort landing in the gap between the response
  // arriving and the listener being added used to be missed, so the loop slept the whole delay
  // (measured 437ms) and then issued an extra request with an already-aborted signal.
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("The user aborted a request.", "AbortError"));
  }
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let timer: any = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("The user aborted a request.", "AbortError"));
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

  const minAttemptMs = options.minAttemptMs ?? DEFAULT_MIN_ATTEMPT_MS;
  const deadlineAt =
    options.deadlineAt ??
    (options.totalTimeoutMs ? Date.now() + options.totalTimeoutMs : undefined);
  const configuredTimeout = options.timeout ?? 60000;

  // Our own knobs must never travel into `RequestInit` and on to `fetch` (the server twin
  // strips its `probe` flag for the same reason).
  const { timeout: _timeout, totalTimeoutMs: _totalTimeoutMs, deadlineAt: _deadlineAt, minAttemptMs: _minAttemptMs, ...init } =
    options;

  /** Time left before the caller's watchdog fires, or null when unbounded. */
  const remainingBudgetMs = (): number | null =>
    deadlineAt === undefined ? null : deadlineAt - Date.now();

  /** Is a retry worth starting: does the delay plus a meaningful attempt still fit? */
  const canAffordAttempt = (delayMs: number): boolean => {
    const remaining = remainingBudgetMs();
    if (remaining === null) return true;
    return remaining - delayMs > minAttemptMs;
  };

  let attempt = 0;

  while (true) {
    const remainingBeforeAttempt = remainingBudgetMs();
    if (remainingBeforeAttempt !== null && remainingBeforeAttempt <= 0) {
      throw new DOMException(
        `Request timed out after ${options.timeout ?? options.totalTimeoutMs}ms`,
        "TimeoutError"
      );
    }

    // Rule 2: the attempt may not outlive the caller's deadline, so the watchdog can never
    // abort it mid-flight and replace a server response with a bare timeout.
    const timeoutVal =
      remainingBeforeAttempt === null
        ? configuredTimeout
        : Math.max(1, Math.min(configuredTimeout, remainingBeforeAttempt));

    const controller = new AbortController();
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

    /** Detach the forwarding listener (retry paths only — see rule 3 in the header). */
    const detachForwarding = () => {
      if (options.signal) {
        options.signal.removeEventListener("abort", onSignalAbort);
      }
    };

    const fetchOptions: RequestInit = { ...init, signal: controller.signal };
    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

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
          detachForwarding();
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

        if (!canAffordAttempt(delay)) {
          detachForwarding();
          console.warn(
            `[Client Retry] Skipping retry of ${url} (status ${response.status}): a ${delay}ms delay ` +
              "leaves no meaningful attempt inside the caller's deadline — returning the response instead."
          );
          return response;
        }

        detachForwarding();
        console.warn(`[Client Retry] Endpoint ${url} returned status ${response.status}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await abortableDelay(delay, options.signal);
        continue;
      }

      // Not retryable (or retries exhausted): keep the forwarding listener attached so a later
      // caller abort still cancels a stalled body read.
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      detachForwarding();

      if (err.name === "AbortError" || options.signal?.aborted) {
        throw err;
      }

      if (attempt < maxRetries) {
        attempt++;
        const delay = backoffDelay(attempt, initialDelay, backoffFactor);

        if (!canAffordAttempt(delay)) {
          console.warn(
            `[Client Retry] Skipping retry of ${url} after "${err.message || err}": a ${delay}ms delay ` +
              "leaves no meaningful attempt inside the caller's deadline — surfacing the error instead."
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
