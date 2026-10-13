/**
 * http-client.ts — Core HTTP infrastructure for all external service calls.
 *
 * Contains:
 *   - Circuit breaker setup (per-hostname)
 *   - The team-wide 429 pause gate (`provider-pause.ts`, WP-I3)
 *   - fetchWithRetry (retry + jitter + Retry-After header support)
 *   - normalizeGeneSymbol
 *   - normalizeVariantTo3Letter
 *
 * This module has zero dependencies on other server/services modules,
 * making it safe to import anywhere without circular references.
 */
import { CircuitBreaker, Semaphore, anySignal } from "../../utils.ts";
import { AMINO_ACID_1_TO_3_TITLE } from "../../../src/shared/aminoAcids.ts";
import {
  awaitProviderPause,
  egressGovernorMode,
  isRateLimitAnswer,
  pauseRemainingMs,
  rateLimitedErrorFor,
  recordRateLimit,
} from "./provider-pause.ts";

/**
 * Upper bound on a server-supplied `Retry-After`.
 *
 * `Retry-After` is attacker/misconfiguration-controlled: an upstream answering
 * `503 Retry-After: 600` would otherwise pin a request for ten minutes, far past
 * the caller's own budget (the coordinate ladder allots 25s). Capping keeps the
 * hint useful without letting it dictate our scheduling.
 */
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Floor applied when a server sends `Retry-After: 0`.
 *
 * Honouring the value literally would turn a trivially-returned 503 into a
 * zero-delay retry loop against a struggling upstream, so a small floor is kept.
 */
const MIN_RETRY_AFTER_MS = 50;

/**
 * A refusal that arrives faster than this is a POLICY answer (rate limit, blocked client, broken
 * endpoint), not transient load, and is not retried.
 *
 * Measured: Ensembl returns 500 for every endpoint — `/info/ping` included — in ~90ms when it refuses
 * a client, and VariantValidator returns 429. Retrying those multiplied our footprint and deepened the
 * block.
 */
const FAST_REFUSAL_MS = 1_000;

/**
 * Who we are, sent on every upstream call.
 *
 * Both Ensembl and VariantValidator document a User-Agent as a REQUIREMENT for API clients (EBI asks
 * for an application identifier and a contact), and it is anonymous retrying traffic that gets
 * throttled. Costs nothing and is the polite half of staying unblocked.
 */
export const UPSTREAM_USER_AGENT =
  "Missense-Structural-Explorer/1.0 (+https://missense-resolve.duckdns.org; structural variant analysis)";

/**
 * Multiplier on every retry sleep. 1 in production; only {@link setBackoffScaleForTests} changes it.
 */
let backoffScale = 1;

/**
 * Test hook: shrink (or, with 0, skip) the real wall-clock time `fetchWithRetry` spends in backoff.
 *
 * A suite that deliberately fails providers otherwise pays 1.5-3 s of REAL sleep per call, which is
 * where several test files spent most of their time on CI. The retry DECISIONS (attempt counts,
 * Retry-After clamping, deadline checks) are computed before the sleep and are unaffected; only how
 * long the loop waits is scaled. Restore with `setBackoffScaleForTests(1)`.
 */
export function setBackoffScaleForTests(scale: number): void {
  backoffScale = scale;
}

/**
 * Sleep that aborts as soon as `signal` fires.
 *
 * The previous implementation awaited a bare timer, so a caller abort (including
 * the resolution ladder's deadline) could not interrupt a backoff already in
 * progress — the cancellation was only observed at the top of the next attempt.
 */
function abortableSleep(rawMs: number, signal?: AbortSignal | null): Promise<void> {
  const ms = rawMs * backoffScale;
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error("Aborted"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function normalizeGeneSymbol(gene: string): string {
  const g = gene.trim().toUpperCase();
  if (g === "GBA1") return "GBA";
  return g;
}

const hostBreakers = new Map<string, CircuitBreaker>();
const hostSemaphores = new Map<string, Semaphore>();

function getHostBreaker(hostname: string): CircuitBreaker {
  let breaker = hostBreakers.get(hostname);
  if (!breaker) {
    breaker = new CircuitBreaker(5, 60000); // 5 failures, 60s cooldown
    hostBreakers.set(hostname, breaker);
  }
  return breaker;
}

/**
 * True while a host is NOT breaker-ejected, i.e. a request to it can actually be answered.
 *
 * Callers that RESERVE time for a later fallback tier use this: holding budget for a tier whose
 * breaker is open is holding it for a request that will fail instantly, which starves the healthy
 * provider. Measured in production: VariantValidator was down (its liveness endpoint timed out at
 * 20s) while 15s of every 32s resolution budget was reserved for it, leaving Ensembl VEP — which was
 * answering, slowly — too little time to succeed.
 */
export function isHostAvailable(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return getHostBreaker(hostname).canExecute();
  } catch {
    // An unparseable URL is not our problem to judge here; let the request itself decide.
    return true;
  }
}

function getHostSemaphore(hostname: string): Semaphore {
  let sem = hostSemaphores.get(hostname);  if (!sem) {
    sem = new Semaphore(5); // max 5 concurrent requests per host (A3)
    hostSemaphores.set(hostname, sem);
  }
  return sem;
}

/**
 * Test hook: breaker and semaphore state is per-host module-global, so it survives between
 * tests and between files. Without a reset, a suite that drives a host to its failure
 * threshold leaves the breaker open, and later tests fail for reasons unrelated to what they
 * assert (an open breaker throws before `fetch` is called).
 */
export function resetHostStateForTests(): void {
  hostBreakers.clear();
  hostSemaphores.clear();
}

/**
 * Executes an async operation with per-host concurrency limiting (Semaphore)
 * and failure protection (CircuitBreaker). Useful for non-fetch requests (e.g. native node:https).
 */
export async function withHostLock<T>(
  hostname: string,
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  // No deadline here, so under `EGRESS_GOVERNOR=on` a paused host refuses at once rather than waiting.
  await awaitProviderPause(hostname, { signal });
  const sem = getHostSemaphore(hostname);
  await sem.acquire(120000, signal);
  const breaker = getHostBreaker(hostname);
  if (!breaker.canExecute()) {
    sem.release();
    throw new Error(`Upstream service ${hostname} is temporarily unavailable (circuit breaker open).`);
  }
  try {
    const result = await fn();
    breaker.recordSuccess();
    return result;
  } catch (err) {
    breaker.recordFailure();
    throw err;
  } finally {
    sem.release();
  }
}

/**
 * Options for {@link fetchWithRetry}.
 *
 * `probe` marks health-check traffic. It is excluded from the per-host circuit breaker on
 * purpose: a probe deliberately runs with a tighter budget than the traffic it reports on, so
 * counting its timeouts as upstream failures lets a monitor open the breaker that guards real
 * user requests — after which those requests fail instantly against a provider that is
 * actually healthy, for the whole cooldown. A monitor must be able to observe a service
 * without being able to disable it.
 */
export interface FetchWithRetryOptions extends RequestInit {
  timeout?: number;
  probe?: boolean;
  /**
   * True when `timeout` is the CALLER's cap (e.g. the resolution ladder's share of its budget)
   * rather than this caller's configured tolerance for the provider.
   *
   * Such a timeout is not evidence about the provider's health, so it is exempt from the
   * per-host breaker — the same reasoning as `probe`, for the same failure mode: otherwise our
   * own scheduling ejects a healthy provider and pushes traffic to the fallback tier.
   * Provider-specific timeouts and transport errors still count.
   */
  cappedByCaller?: boolean;
  /**
   * Absolute instant (epoch ms) by which the caller needs an answer.
   *
   * The fetch loop uses it to avoid starting an attempt or a retry that cannot finish in time, and to
   * size each attempt to the time actually left. Without it a hopeless retry consumed the caller's
   * window and the provider was then reported as unreachable although it had answered.
   */
  deadlineAt?: number;
}

export async function fetchWithRetry(url: string, options: FetchWithRetryOptions = {}, retries = 3, delay = 1000): Promise<Response> {
  let hostname = "unknown";
  try {
    hostname = new URL(url).hostname;
  } catch (_) {}

  // Never forward our own flag to fetch().
  const { probe = false, ...init } = options;

  // The team-wide 429 pause (WP-I3). A probe is exempt for the same reason it skips the breaker: a
  // monitor must still be able to observe the provider. Its own 429 is still recorded below.
  if (!probe) await awaitProviderPause(hostname, { deadlineAt: options.deadlineAt, signal: options.signal });
  const governorOn = egressGovernorMode() === "on";
  /** The call ended on a rate-limit answer (429, or 503 with Retry-After). */
  let rateLimited = false;

  const sem = getHostSemaphore(hostname);
  await sem.acquire(120000, options.signal ?? undefined); // Wait up to 120s to acquire hostname lock, respecting signal
  try {
    const breaker = getHostBreaker(hostname);
    // A probe skips the gate as well as the accounting: it must still be able to report that
    // the provider has recovered while the breaker is open.
    if (!probe && !breaker.canExecute()) {
      throw new Error(`Upstream service ${hostname} is temporarily unavailable (circuit breaker open).`);
    }

    const timeoutMs = options.timeout ?? 15000;
    let lastStatus = 200;
    let lastAttemptMs = 0;
    /** Counts attempts actually started, so a short-circuited loop reports the truth. */
    let attemptsMade = 0;
    /** Kept so a deadline that blocks a retry throws the REAL cause, not a synthetic timeout. */
    let lastError: any = null;
    for (let i = 0; i < retries; i++) {
      if (options.signal?.aborted) {
        throw options.signal.reason || new Error("Aborted");
      }
      /**
       * Deadline-aware: never START an attempt that cannot finish in the time the caller has.
       *
       * Without this, a retry with no chance consumed the caller's whole window and the provider was
       * then reported as "unreachable" — measured in production: Ensembl VEP was answering in ~7s and
       * one transient 500 pushed the retry past the ladder's window, so a working provider was
       * declared dead and the request answered 503.
       */
      const timeLeft = options.deadlineAt ? options.deadlineAt - Date.now() : Number.POSITIVE_INFINITY;
      if (i > 0 && timeLeft < Math.max(lastAttemptMs, 1_500) + 250) {
        throw lastError ?? new Error("No time left for another attempt within the caller's deadline.");
      }
      const attemptTimeoutMs = Math.min(timeoutMs, Math.max(500, Math.floor(timeLeft)));
      const attemptStartedAt = Date.now();
      attemptsMade++;
      try {
        const controller = new AbortController();
        // Aborted with an explicit TimeoutError reason: undici rejects an aborted fetch with
        // `signal.reason`, so without one it is an anonymous `AbortError` that no caller can tell
        // apart from a transport failure. The `cappedByCaller` exemption below depends on this
        // distinction and was INERT until it was set (verified against a real hanging socket).
        const id = setTimeout(
          () => controller.abort(new DOMException("attempt timeout", "TimeoutError")),
          attemptTimeoutMs
        );

        const signal = options.signal
          ? anySignal([options.signal, controller.signal])
          : controller.signal;

        const res = await fetch(url, {
          ...init,
          // Identify ourselves unless the caller set one explicitly: see UPSTREAM_USER_AGENT.
          headers: { "User-Agent": UPSTREAM_USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
          signal
        });
        clearTimeout(id);
        lastAttemptMs = Date.now() - attemptStartedAt;

        if (res.status === 429 || res.status >= 500) {
          lastStatus = res.status;
          let backoff = delay * (2 ** i);
          let hasRetryAfter = false;
          // Retry-After is valid on any 5xx or 429, not just 429 (RFC 9110 §10.2.3).
          // Honouring it on 503 keeps an explicit "Retry-After: 0" — sent by providers
          // that are already free again — from being overridden by our own exponential
          // backoff. It is clamped and floored so an upstream cannot dictate our schedule
          // nor induce a zero-delay hot retry.
          const retryAfterHeader = res.headers?.get("Retry-After");
          if (retryAfterHeader) {
            const seconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(seconds)) {
              backoff = seconds * 1000;
              hasRetryAfter = true;
            } else {
              const date = Date.parse(retryAfterHeader);
              if (!isNaN(date)) {
                backoff = Math.max(0, date - Date.now());
                hasRetryAfter = true;
              }
            }
            if (hasRetryAfter) {
              backoff = Math.min(Math.max(backoff, MIN_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS);
            }
          }
          if (!hasRetryAfter) {
            const jitter = 0.5 + Math.random() * 0.5;
            backoff = Math.round(backoff * jitter);
          }

          rateLimited = isRateLimitAnswer(res.status, retryAfterHeader);
          if (rateLimited) {
            recordRateLimit(hostname, res.status, retryAfterHeader);
            // Under `on` our own retry honours the team pause too: retrying sooner than everyone else
            // is allowed to would be the burst the pause exists to stop.
            if (governorOn) backoff = Math.max(backoff, pauseRemainingMs(hostname));
          }

          /**
           * A FAST refusal is not transient load: do not retry it.
           *
           * Ensembl answers every endpoint — including `/info/ping` — with a 500 HTML page in ~90ms
           * when it is refusing a client, and VariantValidator answers 429. Retrying those inside the
           * same request triples our footprint against services that are already rate-limiting us,
           * which is how a deployment EARNS a longer block: per user query we could issue
           * `retries x rungs x client retries` requests. So a 429/5xx that arrives faster than
           * {@link FAST_REFUSAL_MS} is reported as-is, and only a slow failure (which is what load
           * looks like) is retried.
           */
          const fastRefusal = lastAttemptMs < FAST_REFUSAL_MS;
          const retryAfterFits =
            hasRetryAfter && (!options.deadlineAt || Date.now() + backoff < options.deadlineAt);

          if (fastRefusal && !retryAfterFits) {
            // BREAK, not throw: a throw here is caught by this loop's own catch, which treats it as a
            // failed attempt and retries it — the exact storm this rule exists to prevent (the first
            // version did that, and the test caught 3 attempts where 1 was intended).
            break;
          }

          // Never sleep after the final attempt: there is no next try to prepare for, and
          // the sleep would be pure added latency before the throw.
          if (i < retries - 1) {
            console.warn(`[Upstream Fetch ${res.status}] error/limit on ${url}. Retrying after ${backoff}ms (attempt ${i + 1}/${retries})...`);
            await abortableSleep(backoff, options.signal);
          }
          continue;
        }

        if (!probe) breaker.recordSuccess();
        return res;
      } catch (err: any) {
        lastError = err;
        // A thrown attempt is not a rate-limit answer, whatever an earlier attempt returned.
        rateLimited = false;
        // A CALLER-INITIATED abort (the resolution ladder's window or deadline, or a client
        // disconnect) is not an upstream failure: our own timer closed the request. Booking it
        // as a failure ejected a healthy-but-slow provider on the shared per-host breaker for
        // the whole cooldown, so every subsequent request skipped it — and was then answered by
        // the metadata-free fallback tier. Only aborts raised by this client's own attempt
        // timeout, and transport errors, count against the provider.
        if (options.signal?.aborted) {
          throw err;
        }
        if (i === retries - 1) {
          // A timeout WE imposed — the caller capped this attempt below the provider's configured
          // tolerance (see ResolutionProviderOptions.cappedByCaller) — is our scheduling, not a
          // verdict on the provider. Booking it ejected a slow-but-healthy provider for the whole
          // cooldown. Transport errors and the provider's own timeout still count.
          const imposedByCaller =
            options.cappedByCaller === true &&
            (err?.name === "TimeoutError" || /timed out|attempt timeout/i.test(String(err?.message ?? "")));
          if (!probe && !imposedByCaller) breaker.recordFailure();
          err.statusCode = lastStatus;
          throw err;
        }
        const jitter = 0.5 + Math.random() * 0.5;
        const backoff = Math.round(delay * (2 ** i) * jitter);
        console.warn(`[Upstream Fetch Error] Failed to fetch ${url} (attempt ${i + 1}/${retries}): ${err.message}. Retrying in ${backoff}ms...`);
        await abortableSleep(backoff, options.signal);
      }
    }
    if (governorOn && rateLimited) {
      // A 429 is the provider's policy answer, not a failure: the pause handles it, so it does not
      // count toward the breaker (under `off` and `shadow` it still does, which is today's behaviour).
      throw rateLimitedErrorFor(hostname, undefined, lastStatus);
    }
    if (!probe) breaker.recordFailure();
    // The attempt count is reported honestly: a fast refusal breaks out after ONE attempt, and a
    // message claiming "after 3 attempts" would send a reader looking for retry behaviour that the
    // policy deliberately declined to perform.
    const errObj = new Error(
      `Failed to fetch ${url} after ${attemptsMade} attempt${attemptsMade === 1 ? "" : "s"}${
        lastStatus !== 200 ? ` (last status ${lastStatus})` : ""
      }.`
    );
    (errObj as any).statusCode = lastStatus;
    throw errObj;
  } finally {
    sem.release();
  }
}

export function normalizeVariantTo3Letter(variant: string): string {
  const clean = variant.replace(/^p\./i, "").trim();
  const match = clean.match(/^([a-zA-Z]{3}|[a-zA-Z])(\d+)([a-zA-Z]{3}|[a-zA-Z])$/);
  if (!match) return clean;

  let wt = match[1];
  const pos = match[2];
  let mut = match[3];

  if (wt.length === 1) {
    wt = AMINO_ACID_1_TO_3_TITLE[wt.toUpperCase()] || wt;
  } else {
    wt = wt.charAt(0).toUpperCase() + wt.slice(1).toLowerCase();
  }

  if (mut.length === 1) {
    mut = AMINO_ACID_1_TO_3_TITLE[mut.toUpperCase()] || mut;
  } else {
    mut = mut.charAt(0).toUpperCase() + mut.slice(1).toLowerCase();
  }

  return `${wt}${pos}${mut}`;
}
