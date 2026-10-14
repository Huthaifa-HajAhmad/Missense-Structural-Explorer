/**
 * provider-pause.ts — the team-wide pause after a provider says "too many requests"
 * (doc/COMPUTE_ROUTING_PLAN.md WP-I3).
 *
 * The team shares one server IP. When a provider answers 429 (or 503 with `Retry-After`), it is
 * limiting all of us, so the pause is per host and applies to everyone: nobody's next call goes out
 * until it ends. A 429 is a policy answer, not a failure, so under `on` it does not count toward the
 * per-host circuit breaker (`http-client.ts`); the pause does the breaker's job for that case, with the
 * provider's own timing instead of a fixed 60 s ejection.
 *
 * `EGRESS_GOVERNOR` decides what the pause does:
 *   off     (default) nothing is recorded and nothing changes: today's behaviour, where a 429 that ends a
 *           call counts as a breaker failure.
 *   shadow  pauses are recorded and shown on `/capabilities`, and each call that WOULD have been held is
 *           logged as one `[egress:shadow]` line. Responses and breaker accounting are unchanged.
 *   on      calls to a paused host wait for the pause when the caller's deadline allows it, otherwise
 *           fail at once with {@link ProviderRateLimitedError}; the 429 does not count toward the breaker.
 *
 * Its only server dependency is `cache-scope.ts` (itself dependency-free), so `http-client.ts` can import it.
 */
import {
  PROVIDER_RATE_LIMITED,
  providerLabelForHost,
  retryAfterSeconds,
  rateLimitedSentence,
} from "../../../src/shared/providerLimits.ts";
import { noteRateLimited } from "./cache-scope.ts";

export type EgressMode = "off" | "shadow" | "on";

export function egressGovernorMode(): EgressMode {
  const raw = (process.env.EGRESS_GOVERNOR || "off").trim().toLowerCase();
  return raw === "shadow" || raw === "on" ? raw : "off";
}

/**
 * Longest pause one answer can impose: the same bound `fetchWithRetry` puts on a `Retry-After` it
 * sleeps for. `Retry-After` is provider-controlled; an uncapped `Retry-After: 3600` would switch a
 * tool off for the whole team for an hour on one reply.
 */
export const MAX_PAUSE_MS = 10_000;

/**
 * Pause when the provider gives no usable `Retry-After` (absent, unparseable, or 0).
 *
 * Without a floor a bare 429 would pause nothing, and the next caller would hit the provider in the
 * same millisecond. Five seconds is half the cap: long enough to stop a burst, short enough that a
 * provider which was only briefly busy is back before anyone notices.
 */
export const DEFAULT_PAUSE_MS = 5_000;

/** Window over which `/capabilities` counts recent 429s. */
const RECENT_WINDOW_MS = 15 * 60_000;

/** A waiter keeps this much of its deadline for the call itself after the pause ends. */
const WAIT_MARGIN_MS = 1_500;

interface HostState {
  pausedUntil: number;
  /** Status that started the current pause (429, or 503 with Retry-After). */
  lastStatus: number;
  rateLimits: number[];
  /** Calls a `shadow` pause would have held; reported, never acted on. */
  wouldHold: number;
  /** Last `[egress:shadow]` hold line, so a busy pause logs once a minute, not once per call. */
  lastHoldLog: number;
}

const hosts = new Map<string, HostState>();

function stateOf(hostname: string): HostState {
  let s = hosts.get(hostname);
  if (!s) {
    if (hosts.size > 500) sweepOwnKeys(Date.now());
    s = { pausedUntil: 0, lastStatus: 0, rateLimits: [], wouldHold: 0, lastHoldLog: 0 };
    hosts.set(hostname, s);
  }
  return s;
}

/** People's own-token keys (WP-I4) come and go; one whose pause and recent 429s are over is dropped. */
function sweepOwnKeys(now: number): void {
  for (const [key, s] of hosts) {
    if (!key.includes("#own:") || s.pausedUntil > now) continue;
    if (s.rateLimits.every(t => now - t > RECENT_WINDOW_MS)) hosts.delete(key);
  }
}

/** True for the answers that pause a provider: 429 always, 503 only when it says when to come back. */
export function isRateLimitAnswer(status: number, retryAfterHeader: string | null | undefined): boolean {
  return status === 429 || (status === 503 && Boolean(retryAfterHeader && retryAfterHeader.trim()));
}

/**
 * How long one answer pauses its host: `Retry-After` (seconds or an HTTP date), capped at
 * {@link MAX_PAUSE_MS}, and {@link DEFAULT_PAUSE_MS} when it is absent, unparseable or not positive.
 */
export function pauseMsFromRetryAfter(header: string | null | undefined, now = Date.now()): number {
  let ms = Number.NaN;
  const raw = header?.trim();
  if (raw) {
    if (/^\d+$/.test(raw)) ms = Number(raw) * 1000;
    else {
      const date = Date.parse(raw);
      if (!Number.isNaN(date)) ms = date - now;
    }
  }
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_PAUSE_MS;
  return Math.min(ms, MAX_PAUSE_MS);
}

/**
 * The refusal a caller gets while its provider is paused (`on` only).
 *
 * Fields are assigned in the body, not as constructor parameter properties: the SQLite worker loads this
 * module through `http-client.ts` under Node's type stripping, which rejects parameter properties.
 */
export class ProviderRateLimitedError extends Error {
  readonly code = PROVIDER_RATE_LIMITED;
  readonly hostname: string;
  readonly provider: string;
  readonly retryAfterSec: number;
  /** Kept as the provider's status so existing `statusCode === 429` checks keep working. */
  readonly statusCode: number;
  constructor(hostname: string, provider: string, retryAfterSec: number, status = 429) {
    super(rateLimitedSentence(provider, retryAfterSec));
    this.name = "ProviderRateLimitedError";
    this.hostname = hostname;
    this.provider = provider;
    this.retryAfterSec = retryAfterSec;
    this.statusCode = status;
  }
}

export function isProviderRateLimited(err: unknown): err is ProviderRateLimitedError {
  return Boolean(err) && (err as { code?: unknown }).code === PROVIDER_RATE_LIMITED;
}

/**
 * Records a rate-limit answer from `hostname`. A later answer can lengthen the pause, never shorten it
 * (two callers that were already in flight both report; the second must not cut the first's pause).
 * Returns the pause in ms, or 0 under `off`.
 */
export function recordRateLimit(
  hostname: string,
  status: number,
  retryAfterHeader: string | null | undefined,
  now = Date.now()
): number {
  const mode = egressGovernorMode();
  if (mode === "off") return 0;
  noteRateLimited(hostname);
  const pauseMs = pauseMsFromRetryAfter(retryAfterHeader, now);
  const s = stateOf(hostname);
  // Logged when a pause starts, not for every refusal of calls already in flight during it.
  const starts = s.pausedUntil <= now;
  s.pausedUntil = Math.max(s.pausedUntil, now + pauseMs);
  s.lastStatus = status;
  s.rateLimits.push(now);
  prune(s, now);
  if (starts) console.warn(
    `[egress:${mode}] ${providerLabelForHost(hostname)} (${hostname}) answered ${status}; ` +
      `${mode === "on" ? "pausing" : "would pause"} ${hostname.includes("#own:") ? "this person's token" : "it for everyone"} for ${retryAfterSeconds(pauseMs)} s.`
  );
  return pauseMs;
}

/** Remaining pause for `hostname` in ms (0 when not paused). Recorded under `shadow` and `on`. */
export function pauseRemainingMs(hostname: string, now = Date.now()): number {
  const s = hosts.get(hostname);
  return s ? Math.max(0, s.pausedUntil - now) : 0;
}

/** The typed refusal for `hostname`, worded with `provider` when the caller knows the tool's name. */
export function rateLimitedErrorFor(hostname: string, provider?: string, status = 429): ProviderRateLimitedError {
  const remaining = pauseRemainingMs(hostname) || DEFAULT_PAUSE_MS;
  noteRateLimited(hostname);
  return new ProviderRateLimitedError(
    hostname,
    provider ?? providerLabelForHost(hostname),
    retryAfterSeconds(remaining),
    status
  );
}

function abortableWait(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error("Aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The gate every outbound call passes before it is sent.
 *
 * Under `on`, a paused host makes the caller wait for the pause when its deadline leaves room for the
 * call afterwards, and refuses it at once otherwise (a caller without a deadline does not wait: it
 * cannot say how long it is willing to). Waiting is a loop because another caller's 429 can lengthen
 * the pause while this one sleeps. Under `shadow` the call goes out and the hold is only logged.
 */
export async function awaitProviderPause(
  hostname: string,
  opts: { deadlineAt?: number; signal?: AbortSignal | null; provider?: string } = {}
): Promise<void> {
  const mode = egressGovernorMode();
  if (mode === "off") return;
  let remaining = pauseRemainingMs(hostname);
  if (remaining <= 0) return;
  if (mode === "shadow") {
    const s = stateOf(hostname);
    s.wouldHold++;
    const now = Date.now();
    if (now - s.lastHoldLog > 60_000) {
      s.lastHoldLog = now;
      console.warn(
        `[egress:shadow] a call to ${hostname} would have been held ${retryAfterSeconds(remaining)} s ` +
          `(sent anyway; ${s.wouldHold} so far).`
      );
    }
    return;
  }
  while (remaining > 0) {
    const fits = opts.deadlineAt !== undefined && Date.now() + remaining + WAIT_MARGIN_MS <= opts.deadlineAt;
    if (!fits) throw rateLimitedErrorFor(hostname, opts.provider, stateOf(hostname).lastStatus || 429);
    await abortableWait(remaining, opts.signal);
    remaining = pauseRemainingMs(hostname);
  }
}

function prune(s: HostState, now: number): void {
  const cutoff = now - RECENT_WINDOW_MS;
  while (s.rateLimits.length && s.rateLimits[0] < cutoff) s.rateLimits.shift();
}

/** One provider's line on `/capabilities`. Hostnames only: no tokens, no credential hashes. */
export interface ProviderHealth {
  hostname: string;
  provider: string;
  state: "ok" | "paused";
  pausedUntil: string | null;
  retryAfterSec: number | null;
  recentRateLimits: number;
  /** Calls a `shadow` pause would have held since start-up. */
  wouldHold: number;
  /**
   * Always "unmeasured" here: this module cannot see the governor's rates without an import cycle.
   * `/capabilities` replaces it with the governor's basis (`egress-governor.ts` `limitBasisFor`).
   */
  limitBasis: "documented" | "observed" | "unmeasured";
}

/** Every host that has rate-limited us in the last 15 minutes, or is paused now. */
export function providerHealth(now = Date.now()): { mode: EgressMode; providers: ProviderHealth[] } {
  const providers: ProviderHealth[] = [];
  for (const [hostname, s] of hosts) {
    prune(s, now);
    const remaining = Math.max(0, s.pausedUntil - now);
    if (remaining === 0 && s.rateLimits.length === 0) continue;
    providers.push({
      hostname,
      provider: providerLabelForHost(hostname),
      state: remaining > 0 ? "paused" : "ok",
      pausedUntil: remaining > 0 ? new Date(s.pausedUntil).toISOString() : null,
      retryAfterSec: remaining > 0 ? retryAfterSeconds(remaining) : null,
      recentRateLimits: s.rateLimits.length,
      wouldHold: s.wouldHold,
      limitBasis: "unmeasured",
    });
  }
  providers.sort((a, b) => a.hostname.localeCompare(b.hostname));
  return { mode: egressGovernorMode(), providers };
}

/** Test hook: pause state is module-global, like the breakers in `http-client.ts`. */
export function resetProviderPausesForTests(): void {
  hosts.clear();
}
