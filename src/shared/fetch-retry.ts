/**
 * fetch-retry.ts â€” Consolidated client-side fetch retry utility.
 *
 * Provides:
 *   - Exponential backoff with jitter
 *   - Automatic retry for 429 (rate-limit) and transient 5xx gateway errors (502, 503, 504)
 *   - Non-retryable error detection (e.g. API_KEY_MISSING / isConfigError)
 *   - Proper AbortSignal cascading and timeout cleanup
 *   - `Retry-After` awareness and a caller-deadline guard (see below)
 *   - `withTransientRetry`: the same backoff/deadline policy for the phase `fetchWithRetry`
 *     cannot cover — the BODY read, which happens after this module has already returned
 *     (see "THE POST-HEADERS GAP" below)
 *
 * WHY THE DEADLINE GUARD EXISTS
 * -----------------------------
 * The caller (authSession) arms ONE watchdog for the WHOLE call and passes the same value as
 * the per-attempt `timeout`, so a retry could be aborted mid-flight by a timer that was already
 * running when it started. Observed production failure, `POST /api/v1/translate-variant`:
 * the server correctly answered `503 Retry-After: 60` after exhausting its provider ladder;
 * this utility retried 430ms later (ignoring the hint), the second attempt began a FRESH ladder,
 * the caller's 45s watchdog fired inside it, and the user was shown the bare
 * "Analysis query error: Request timed out after 45000ms" â€” the server's actionable guidance
 * ("enter the protein-level substitution directly") destroyed by a scheduling bug.
 *
 * Three rules fix that:
 *   1. A `Retry-After` longer than {@link MAX_IN_REQUEST_RETRY_AFTER_MS} is not waited out
 *      in-request â€” the server already said when to come back, so its response is returned.
 *   2. When the caller supplies a `deadlineAt`, no attempt is started that cannot finish inside
 *      it, and every attempt's own timeout is CAPPED by the time that remains. This is what
 *      makes "no attempt the caller's watchdog can abort" a real invariant rather than an
 *      estimate: the previous version projected the NEXT attempt's cost from the PREVIOUS
 *      attempt's duration, so a fast failure followed by a stalled retry still ended in the
 *      watchdog's timeout with the server's message discarded.
 *   3. `timeout` bounds time-to-headers for the initial response; a caller abort still cancels
 *      a stalled body read, because the forwarding listener stays attached for the lifetime of
 *      the returned response.
 *
 * THE POST-HEADERS GAP — WHY `withTransientRetry` EXISTS
 * -----------------------------------------------------
 * Everything above guards the CONNECTION: the moment `fetch()` resolves with an ok response this
 * module hands the Response back and stops. The body is read later by the caller (`res.json()`),
 * so a connection that dies *during that read* is terminal — no retry, and the browser's raw
 * `TypeError: Failed to fetch` is what the user is shown.
 *
 * That is not hypothetical. Production, 2026-09-27T19:24:01Z, revision f194815: the literature
 * fetch reported `TypeError: Failed to fetch` with a stack of exactly one frame —
 * `Object.pull` in the client body-stall watchdog (`bindWatchdogToBody`, src/api/authSession.ts).
 * That frame is only reachable from `reader.read()`, which proves the headers had already
 * arrived: the response was severed MID-BODY. The running image had been built at 19:06:22Z and
 * the container was being replaced by that deploy, so Caddy's in-flight upstream response was cut
 * when the old app container went away. (See `deploy/docker-compose.oci.yml` — no
 * `stop_grace_period`, so Docker SIGKILLs 10s after SIGTERM.)
 *
 * A severed response is a *transient* condition — the retry lands on the replacement container —
 * and the affected reads here are idempotent GETs, so re-issuing the whole operation (request
 * AND body) is safe. `withTransientRetry` does that under one budget, and
 * {@link describeConnectionFailure} turns the leftover browser string into something a
 * clinician can act on.
 *
 * Deliberately NOT retried: `AbortError`/`TimeoutError` (the caller's own watchdog made a
 * decision — re-issuing would fight the deadline it is enforcing), and `SyntaxError` from a
 * half-written JSON body (a truncated *chunked* stream always errors the read; a body that ends
 * cleanly but does not parse is a server bug, and retrying it just hides it).
 */

import { readTextWithTimeout } from "./httpBody.ts";
export interface FetchRetryOptions extends RequestInit {
  timeout?: number;
  /** Whole-call budget (ms from now) the caller's watchdog enforces. */
  totalTimeoutMs?: number;
  /**
   * Absolute epoch-ms instant by which this call must be finished â€” the caller's watchdog
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

/**
 * True when a retryable response's body proves a configuration error (`API_KEY_MISSING`).
 *
 * BOUNDED by the caller's remaining deadline when there is one. This read runs after the attempt
 * timer has been cleared, so unbounded it let a server that sent headers and then stalled the body
 * hold the call past `deadlineAt` â€” at which point the caller's watchdog replaced the response we
 * already had with a bare timeout, losing the message the whole fix exists to preserve.
 * A body that cannot be read in time is not a configuration error: the caller retries.
 */
async function isUnrecoverableConfigError(
  response: Response,
  budgetMs: number | null
): Promise<boolean> {
  /**
   * Built on the SHARED body-deadline primitive, not a second race of its own.
   *
   * This module and `httpBody.ts` had each grown a "read a body under a deadline" mechanism, which is
   * how two implementations of one rule drift apart. A body that cannot be read in time is not a
   * configuration error, so a deadline rejection folds to the empty string -- the same outcome the
   * local race produced, with one implementation instead of two. The response is CLONED because
   * reading a body consumes it and the caller still needs the original.
   */
  const text = await readTextWithTimeout(response.clone(), budgetMs).catch(() => "");
  return text.includes("API_KEY_MISSING") || text.includes("isConfigError");
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

    /** Detach the forwarding listener (retry paths only â€” see rule 3 in the header). */
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
        // Fast-path: a body that proves a configuration error bypasses retry entirely.
        if (await isUnrecoverableConfigError(response, remainingBudgetMs())) {
          return response;
        }

        const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("Retry-After"));

        // Rule 1: an advertised cooldown longer than a request can wait is not waited out.
        if (retryAfterMs !== null && retryAfterMs > MAX_IN_REQUEST_RETRY_AFTER_MS) {
          console.warn(
            `[Client Retry] ${url} answered ${response.status} with Retry-After ${retryAfterMs}ms, ` +
              `longer than a single request can wait (limit ${MAX_IN_REQUEST_RETRY_AFTER_MS}ms) â€” ` +
              "returning the response so its message reaches the user instead of retrying."
          );
          return response;
        }

        attempt++;
        const delay =
          retryAfterMs !== null ? retryAfterMs : backoffDelay(attempt, initialDelay, backoffFactor);

        if (!canAffordAttempt(delay)) {
          // Returning the response, so the forwarding listener STAYS attached: a later caller
          // abort must still cancel this body read (detaching here reopened the header-then-stall
          // hole the body-bound watchdog exists to close).
          console.warn(
            `[Client Retry] Skipping retry of ${url} (status ${response.status}): a ${delay}ms delay ` +
              "leaves no meaningful attempt inside the caller's deadline â€” returning the response instead."
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
              "leaves no meaningful attempt inside the caller's deadline â€” surfacing the error instead."
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

/**
 * Browser texts that mean "the connection failed", not "the server answered with a failure".
 *
 * Every engine words this differently and none of them is structured — the message is the only
 * signal there is. Kept as data so the predicate and the presentation helper cannot drift apart.
 */
const CONNECTION_FAILURE_TEXTS = [
  "Failed to fetch",                                  // Chrome, Edge
  "NetworkError when attempting to fetch resource",    // Firefox
  "Load failed",                                      // Safari
  "The network connection was lost",                   // Safari, mid-transfer
  "The Internet connection appears to be offline",     // Safari / iOS
  "fetch failed",                                      // Node & undici (tests, SSR)
];

/**
 * Is this the browser's connection-level fetch failure?
 *
 * Gated on the error NAME as well as its text. Text alone misreads this project's own message
 * strings — `structureApi` throws `new Error("Failed to fetch sequence (HTTP 500 …)")`, which
 * contains "Failed to fetch" but is a server-side answer that {@link fetchWithRetry} already
 * retried; retrying it here would double the work and mislabel a 500 as a lost connection.
 * A real network failure always arrives as a `TypeError` (all three engines) or a `NetworkError`
 * DOMException, and both are what this accepts.
 *
 * `AbortError` and `TimeoutError` are rejected by name: those are the caller's watchdog or an
 * explicit cancellation, i.e. a decision, not a fault.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const { name, message } = err as { name?: unknown; message?: unknown };
  const errName = typeof name === "string" ? name : "";
  if (errName === "AbortError" || errName === "TimeoutError") return false;
  if (errName !== "TypeError" && errName !== "NetworkError") return false;
  return isConnectionFailureText(typeof message === "string" ? message : "");
}

/**
 * The text-only half of {@link isTransientNetworkError}, for the callers that only kept the
 * message — the Dev Console captures `console.error` output, which has already flattened the
 * error into a string by the time it is classified.
 */
export function isConnectionFailureText(text: string): boolean {
  return CONNECTION_FAILURE_TEXTS.some((fragment) => text.includes(fragment));
}

/**
 * Human text for a connection-level failure, or `null` when the error is not one.
 *
 * The banner used to read "Sync Error / Failed to fetch", which tells a clinician nothing about
 * whether to wait, retry, or reconnect. Presentation layers map through here instead of editing
 * the thrown error: the raw `TypeError` — and the stack that identified this bug — stays intact
 * in the console report.
 */
export function describeConnectionFailure(err: unknown, subject = "this data"): string | null {
  if (!isTransientNetworkError(err)) return null;
  return `Connection lost while loading ${subject}. Check your connection and try again.`;
}

export interface TransientRetryOptions {
  /** Extra attempts after the first. Two covers a container swap that has already started. */
  retries?: number;
  /** First backoff delay; doubles per attempt (with jitter, via the shared backoff helper). */
  baseDelayMs?: number;
  /**
   * Absolute epoch-ms instant the WHOLE operation must fit in — typically the same budget the
   * caller's watchdog enforces. No attempt is started that cannot finish inside it, so a retry
   * never extends the window the user's spinner already promised.
   */
  deadlineAt?: number;
  signal?: AbortSignal | null;
  /** Minimum time a started attempt deserves; below it the error is surfaced instead. */
  minAttemptMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

/**
 * Run an operation that includes reading the response BODY, retrying it on a lost connection.
 *
 * Pass the whole request-and-parse as one operation — `fetchWithAuth(...)` plus `res.json()` —
 * because a retry of only the request would re-read a body that was already consumed. Only
 * {@link isTransientNetworkError} triggers another attempt; an HTTP error, a schema rejection or
 * a watchdog timeout propagates on the first try, so a caller cannot be surprised by a delayed
 * failure it asked for.
 */
export async function withTransientRetry<T>(
  operation: (context: { attempt: number }) => Promise<T>,
  options: TransientRetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const minAttemptMs = options.minAttemptMs ?? DEFAULT_MIN_ATTEMPT_MS;

  let attempt = 0;

  while (true) {
    try {
      return await operation({ attempt });
    } catch (err) {
      // Not retryable, cancelled, or out of attempts: surface the original error untouched.
      if (attempt >= retries || !isTransientNetworkError(err) || options.signal?.aborted) {
        throw err;
      }

      attempt++;
      const delay = backoffDelay(attempt, baseDelayMs, 2);

      if (options.deadlineAt !== undefined && options.deadlineAt - Date.now() - delay <= minAttemptMs) {
        console.warn(
          `[Client Retry] Not retrying after "${(err as Error)?.message || err}": a ${delay}ms delay ` +
            "leaves no meaningful attempt inside the caller's budget — surfacing the error instead."
        );
        throw err;
      }

      options.onRetry?.({ attempt, delayMs: delay, error: err });
      await abortableDelay(delay, options.signal);
    }
  }
}
