/**
 * egress-governor.ts — fair share of each remote provider between the people using the server
 * (doc/COMPUTE_ROUTING_PLAN.md WP-I1).
 *
 * The team shares one server IP, so a provider counts all of us as one client. One person's burst
 * (a 200-variant landscape, a prewarm sweep) used to take every slot the per-host semaphore had, and
 * everyone else waited behind it, or got the whole team rate limited. The governor sits ABOVE the
 * per-host semaphore and circuit breaker (both stay as backstops) and decides whose call goes next:
 *
 *  - **Work-conserving fair share**, as in the job queue (WP-B). Alone, a person gets every slot.
 *    When several people wait for the same provider, slots rotate between them (the person served
 *    least recently goes next). Unrequested work (`system`: prewarm) goes when no person waits, or once
 *    it has waited {@link SYSTEM_AGING_MS}, so it is delayed, never starved into failure.
 *    "People" means signed-in accounts: in `AUTH_MODE=legacy` every request is the one `legacy` owner.
 *  - **Rates only where they are known.** A provider's `ratePerMin` comes from its published limit,
 *    with the source in the registry; from an operator override (`configured`); or it is LEARNED from a
 *    429 that arrives after at least 10 calls in a minute: half that pace (`observed`), forgotten after
 *    an hour without another 429. Every other provider is limited by concurrency alone (`unmeasured`).
 *  - **Adaptive, and visible.** A rate-limit answer (429, or 503 with `Retry-After`) halves the rate,
 *    once per {@link DECREASE_COOLDOWN_MS} (a burst of refusals to calls already in flight is one
 *    signal, not five); after 20 successes it rises by 5% (at least 1/min), never above a published or
 *    configured limit. The current value is on `/capabilities`.
 *  - **A wait counts against the caller's deadline.** A call still waiting 1.5 s before its deadline
 *    fails with {@link EgressWaitExceededError} instead of being sent too late to be useful. A call
 *    without a deadline waits at most 120 s, the bound the per-host semaphore already uses.
 *  - **Lanes.** A long compute call (a JapanFold fold) holds its slot until the answer's headers
 *    arrive, minutes later. Such calls run in their own lane (`lane: "compute"`), with their own slots,
 *    so a short call to the same host does not wait behind them. Lanes are refused for providers with a
 *    published rate, where they would double it.
 *
 * `EGRESS_GOVERNOR` (shared with the 429 pause, `provider-pause.ts`):
 *   off     calls go straight through (today's behaviour).
 *   shadow  calls go straight through; each call the governor WOULD have held is counted and logged
 *           (`[egress:shadow]`, at most once a minute per provider), and rates still adapt, so the
 *           numbers can be read before anything is enforced.
 *   on      calls wait for their turn.
 *
 * State is per process: during a blue/green hand-over two processes each keep their own counts.
 * Loopback, private and dotless hosts (the model sidecar) are never governed.
 */
import {
  EGRESS_WAIT_EXCEEDED,
  egressBusySentence,
  isKnownProviderHost,
  providerLabelForHost,
} from "../../../src/shared/providerLimits.ts";
import { EGRESS_SYSTEM_OWNER, currentEgressOwner } from "./egress-context.ts";
import { egressGovernorMode, isProviderRateLimited, isRateLimitAnswer } from "./provider-pause.ts";
import { noteBusy } from "./cache-scope.ts";

export type LimitBasis = "documented" | "configured" | "observed" | "unmeasured";

export interface ProviderSpec {
  id: string;
  hostnames: string[];
  /** What the provider counts us by: the server IP, a server key, or each user's own key. */
  credentialKind: "ip" | "server-key" | "user-key";
  maxConcurrent: number;
  ratePerMin?: number;
  /** Calls that may go at once after an idle spell; defaults to one second's worth of the rate. */
  burst?: number;
  limitBasis: LimitBasis;
  /** Where a documented rate was published. Required when `limitBasis` is `documented`. */
  source?: string;
  /** In the registry or an override (as opposed to a host first met at run time). */
  registered?: boolean;
  /** One person's own token at this provider (WP-I4): its own allowance, so its own bucket. */
  ownToken?: boolean;
}

/**
 * Concurrency for every provider without its own entry. It equals the per-host semaphore
 * (`http-client.ts`), so turning the governor on changes ORDER (whose call goes next), not throughput.
 */
export const DEFAULT_MAX_CONCURRENT = 5;
/** Longest a call without a deadline waits for its turn: the per-host semaphore's own bound. */
export const MAX_WAIT_MS = 120_000;
/** A waiter is refused this long before its deadline: a turn granted later could not finish. */
const DEADLINE_MARGIN_MS = 1_500;
/** Successes before the rate rises by one step. */
const INCREASE_AFTER_SUCCESSES = 20;
/** Floor for any decreased or learned rate without a published one. */
const MIN_RATE_PER_MIN = 5;
/**
 * A published rate is never cut below this fraction of itself: eight halvings would take Ensembl from
 * 900/min to the absolute floor, and the additive increase would need most of an hour to climb back.
 */
const DOCUMENTED_FLOOR_FRACTION = 0.1;
/** Rate-limit answers within this window of a decrease are the same episode: one halving, not several. */
export const DECREASE_COOLDOWN_MS = 5_000;
/**
 * Calls in the last minute before a 429 teaches an unmeasured provider a rate. Below this, a 429 says
 * nothing about our VOLUME (one refusal after two calls is the provider's state, not our pace); the
 * team-wide pause (`provider-pause.ts`) handles it, and no rate is invented from it.
 */
const LEARN_MIN_CALLS = 10;
/** A learned rate is forgotten after this long without another rate-limit answer. */
export const LEARNED_RATE_TTL_MS = 60 * 60_000;
/** A `system` call that has waited this long is served in turn with the people. */
export const SYSTEM_AGING_MS = 30_000;
/**
 * Hosts met at run time (not in the registry) kept at most. Request-chosen endpoints (a person's own
 * AlphaGenome or GPN server) reach the governor too; past this, idle ones are forgotten.
 */
export const MAX_RUNTIME_HOSTS = 200;

/**
 * Published limits only. Each number here has its source; a provider absent from this table is
 * governed by concurrency alone until a 429 teaches the governor its rate.
 */
function registry(): ProviderSpec[] {
  const ensembl = (id: string, host: string): ProviderSpec => ({
    id,
    hostnames: [host],
    credentialKind: "ip",
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    // "we are allowed 55000 requests over an hour ... an average of 15 requests per second"
    ratePerMin: 900,
    burst: 15,
    limitBasis: "documented",
    source: "https://github.com/Ensembl/ensembl-rest/wiki/Rate-Limits",
    registered: true,
  });
  // NCBI E-utilities: 3 requests/s per IP without a key, 10/s with one. `clinvar.ts` sends
  // NCBI_API_KEY when it is set, so the limit follows the key.
  const ncbiKey = Boolean(process.env.NCBI_API_KEY);
  return [
    ensembl("ensembl", "rest.ensembl.org"),
    ensembl("ensembl-grch37", "grch37.rest.ensembl.org"),
    {
      id: "ncbi-eutils",
      hostnames: ["eutils.ncbi.nlm.nih.gov"],
      credentialKind: ncbiKey ? "server-key" : "ip",
      maxConcurrent: ncbiKey ? DEFAULT_MAX_CONCURRENT : 3,
      ratePerMin: ncbiKey ? 600 : 180,
      burst: ncbiKey ? 10 : 3,
      limitBasis: "documented",
      source: "https://support.nlm.nih.gov/kbArticle/?pn=KA-05317",
      registered: true,
    },
  ];
}

function ipv4Octets(h: string): number[] | null {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every(n => n <= 255) ? o : null;
}

/**
 * True for hosts the governor never touches: loopback, private and link-local addresses (IPv4 and
 * IPv6), and local names. It decides governance only, never access: a name like `10.example.org` is
 * not an address and is governed like any other host.
 */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost") return true;
  if (/\.(localhost|local|lan|internal|home\.arpa)$/.test(h)) return true;
  const v4 = ipv4Octets(h);
  if (v4) {
    const [a, b] = v4;
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isLocalHost(mapped[1]);
    return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  // A dotless name is a container or service name (the sidecar), never a public provider.
  return !h.includes(".");
}

type Override = Partial<Pick<ProviderSpec, "maxConcurrent" | "ratePerMin" | "burst">>;

/**
 * `EGRESS_PROVIDER_LIMITS_JSON`, keyed by registry id or hostname. Each entry is checked on its own:
 * a bad entry is logged and skipped, the others still apply. Unparseable JSON is logged and ignored.
 */
function overrides(): Record<string, Override> {
  const raw = process.env.EGRESS_PROVIDER_LIMITS_JSON;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
  } catch (err) {
    console.warn(`[egress] EGRESS_PROVIDER_LIMITS_JSON ignored: ${(err as Error).message}`);
    return {};
  }
  const out: Record<string, Override> = {};
  for (const [key, v] of Object.entries(parsed as Record<string, any>)) {
    const o: Override = {};
    let bad: string | null = null;
    for (const k of ["maxConcurrent", "ratePerMin", "burst"] as const) {
      const n = v?.[k];
      if (n === undefined) continue;
      if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
        bad = `${k} must be a positive number`;
        break;
      }
      if (k === "ratePerMin" && n < MIN_RATE_PER_MIN) {
        bad = `ratePerMin must be at least ${MIN_RATE_PER_MIN}`;
        break;
      }
      o[k] = k === "ratePerMin" ? n : Math.max(1, Math.floor(n));
    }
    if (bad) console.warn(`[egress] EGRESS_PROVIDER_LIMITS_JSON entry "${key}" ignored: ${bad}`);
    else out[key.toLowerCase()] = o;
  }
  return out;
}

/** Raised when a call's turn would come after its deadline (or after {@link MAX_WAIT_MS}). */
export class EgressWaitExceededError extends Error {
  readonly code = EGRESS_WAIT_EXCEEDED;
  readonly statusCode = 503;
  readonly providerId: string;
  readonly provider: string;
  readonly waitedMs: number;
  constructor(providerId: string, provider: string, waitedMs: number) {
    super(egressBusySentence(provider));
    this.name = "EgressWaitExceededError";
    this.providerId = providerId;
    this.provider = provider;
    this.waitedMs = waitedMs;
  }
}

export function isEgressWaitExceeded(err: unknown): err is EgressWaitExceededError {
  return Boolean(err) && (err as { code?: unknown }).code === EGRESS_WAIT_EXCEEDED;
}

/**
 * True when the SERVER held a call back (fair-share wait, team-wide 429 pause) and nothing was sent.
 * Not a verdict on the provider: callers must not negative-cache it, count it toward their own circuit
 * breakers, or call the provider "down" because of it.
 */
export function isEgressRefusal(err: unknown): boolean {
  return isEgressWaitExceeded(err) || isProviderRateLimited(err);
}

interface Waiter {
  owner: string;
  enqueuedAt: number;
  grant: () => void;
  fail: (err: Error) => void;
}

class ProviderState {
  readonly spec: ProviderSpec;
  readonly label: string;
  /** Rate in force now (adapted); undefined = concurrency only. */
  ratePerMin: number | undefined;
  burst: number;
  basis: LimitBasis;
  /** Ceiling the additive increase may not pass (a published or configured rate), if any. */
  readonly rateCap: number | undefined;
  /** Floor a decrease may not pass. */
  readonly rateFloor: number;
  tokens: number;
  lastRefill: number;
  inFlight = 0;
  readonly waiting = new Map<string, Waiter[]>();
  /** Order in which owners were last granted a slot (lower = longer ago). */
  readonly lastServed = new Map<string, number>();
  successStreak = 0;
  lastDecreaseAt = Number.NEGATIVE_INFINITY;
  lastRateLimitAt = Number.NEGATIVE_INFINITY;
  lastUsed: number;
  /** Calls started in the last minute, to learn a rate from a 429 of an unmeasured provider. */
  readonly recentStarts: number[] = [];
  // Counters for /capabilities.
  calls = 0;
  held = 0;
  wouldHold = 0;
  refused = 0;
  rateLimits = 0;
  lastShadowLog = 0;
  refillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(spec: ProviderSpec, now: number) {
    this.spec = spec;
    this.label = providerLabelForHost(spec.hostnames[0] ?? spec.id);
    this.ratePerMin = spec.ratePerMin;
    this.burst = spec.burst ?? (spec.ratePerMin ? Math.max(1, Math.ceil(spec.ratePerMin / 60)) : 1);
    this.basis = spec.limitBasis;
    const capped = spec.limitBasis === "documented" || spec.limitBasis === "configured";
    this.rateCap = capped ? spec.ratePerMin : undefined;
    this.rateFloor =
      spec.limitBasis === "documented" && spec.ratePerMin
        ? Math.max(MIN_RATE_PER_MIN, spec.ratePerMin * DOCUMENTED_FLOOR_FRACTION)
        : MIN_RATE_PER_MIN;
    this.tokens = this.burst;
    this.lastRefill = now;
    this.lastUsed = now;
  }

  refill(now: number): void {
    if (!this.ratePerMin) return;
    const add = ((now - this.lastRefill) / 60_000) * this.ratePerMin;
    this.tokens = Math.min(this.burst, this.tokens + add);
    this.lastRefill = now;
  }

  /** A learned rate that has not been confirmed by a 429 for an hour is dropped. */
  forgetStaleLearning(now: number): void {
    if (this.basis === "observed" && now - this.lastRateLimitAt > LEARNED_RATE_TTL_MS) {
      this.ratePerMin = undefined;
      this.basis = "unmeasured";
      this.burst = 1;
      this.tokens = 1;
    }
  }

  /** Ms until one token is available (0 if one is, or there is no rate). */
  msUntilToken(): number {
    if (!this.ratePerMin || this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.ratePerMin) * 60_000);
  }

  hasWaiters(): boolean {
    for (const q of this.waiting.values()) if (q.length) return true;
    return false;
  }

  waitingCount(): number {
    let n = 0;
    for (const q of this.waiting.values()) n += q.length;
    return n;
  }

  idle(): boolean {
    return this.inFlight === 0 && !this.hasWaiters() && !this.refillTimer;
  }
}

let specs: Map<string, ProviderSpec> | null = null;
const states = new Map<string, ProviderState>();
let grantSeq = 0;

function buildSpecs(): Map<string, ProviderSpec> {
  const map = new Map<string, ProviderSpec>();
  const ov = overrides();
  const used = new Set<string>();
  for (const s of registry()) {
    // An override may name the entry by id or by any of its hostnames; either way it is MERGED into
    // the entry, so a published rate keeps its source and stays the ceiling.
    let merged: ProviderSpec = { ...s };
    for (const key of [s.id, ...s.hostnames]) {
      const o = ov[key];
      if (!o) continue;
      used.add(key);
      merged = { ...merged, ...o };
      if (s.ratePerMin && o.ratePerMin && o.ratePerMin > s.ratePerMin) {
        console.warn(
          `[egress] EGRESS_PROVIDER_LIMITS_JSON "${key}": ${o.ratePerMin}/min is above the published ${s.ratePerMin}/min; using ${s.ratePerMin}.`
        );
        merged.ratePerMin = s.ratePerMin;
      }
    }
    for (const host of s.hostnames) map.set(host, merged);
  }
  // An override for a host with no registry entry: an operator's own limit.
  for (const [key, o] of Object.entries(ov)) {
    if (used.has(key)) continue;
    if (!key.includes(".")) {
      console.warn(`[egress] EGRESS_PROVIDER_LIMITS_JSON entry "${key}" ignored: not a registry id or a hostname.`);
      continue;
    }
    map.set(key, {
      id: key,
      hostnames: [key],
      credentialKind: "ip",
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      limitBasis: o.ratePerMin ? "configured" : "unmeasured",
      registered: true,
      ...o,
    });
  }
  return map;
}

function specFor(hostname: string): ProviderSpec | null {
  const h = hostname.toLowerCase();
  if (isLocalHost(h)) return null;
  if (!specs) specs = buildSpecs();
  return (
    specs.get(h) ?? {
      id: h,
      hostnames: [h],
      credentialKind: "ip",
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      limitBasis: "unmeasured",
    }
  );
}

/** Concurrency the governor allows `hostname`, so the per-host semaphore can match a raised override. */
export function maxConcurrentFor(hostname: string): number {
  return specFor(hostname)?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
}

/** Forget idle hosts met at run time once there are more than {@link MAX_RUNTIME_HOSTS}. */
function evictIdleRuntimeHosts(): void {
  let runtime = 0;
  // Own-token buckets count as runtime state: one appears for each person's token.
  const isRuntime = (st: ProviderState) => !st.spec.registered || Boolean(st.spec.ownToken);
  for (const s of states.values()) if (isRuntime(s)) runtime++;
  if (runtime <= MAX_RUNTIME_HOSTS) return;
  const idle = [...states.entries()]
    .filter(([, s]) => isRuntime(s) && s.idle())
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [key] of idle) {
    if (runtime <= MAX_RUNTIME_HOSTS) break;
    states.delete(key);
    runtime--;
  }
}

function stateFor(hostname: string, now = Date.now(), lane?: string, ownBucket?: string | null): ProviderState | null {
  const base = specFor(hostname);
  if (!base) return null;
  let spec = base;
  if (lane) {
    if (base.ratePerMin) {
      // Two lanes would each spend the full published rate.
      console.warn(`[egress] lane "${lane}" ignored for ${base.id}: it has a published rate.`);
    } else {
      spec = { ...base, id: `${base.id}#${lane}` };
    }
  }
  // A person's own token has its own allowance at the provider, so it gets its own slots and rate, apart
  // from the team token's (WP-I4). The bucket id is opaque (`credentials.ts`), never the token or its hash.
  if (ownBucket) spec = { ...spec, id: `${spec.id}#own:${ownBucket}`, ownToken: true };
  let s = states.get(spec.id);
  if (!s) {
    s = new ProviderState(spec, now);
    states.set(spec.id, s);
    evictIdleRuntimeHosts();
  }
  s.lastUsed = now;
  s.forgetStaleLearning(now);
  return s;
}

/**
 * The owner to serve next: people before `system`, and among people whoever was served least
 * recently. A `system` call that has waited {@link SYSTEM_AGING_MS} joins the rotation.
 */
function nextOwner(s: ProviderState, now: number): string | null {
  let best: string | null = null;
  let bestSeq = Number.POSITIVE_INFINITY;
  let bestArrival = Number.POSITIVE_INFINITY;
  for (const [owner, q] of s.waiting) {
    if (!q.length) continue;
    if (owner === EGRESS_SYSTEM_OWNER && now - q[0].enqueuedAt < SYSTEM_AGING_MS) continue;
    const seq = s.lastServed.get(owner) ?? -1;
    const arrival = q[0].enqueuedAt;
    if (seq < bestSeq || (seq === bestSeq && arrival < bestArrival)) {
      best = owner;
      bestSeq = seq;
      bestArrival = arrival;
    }
  }
  if (best) return best;
  return s.waiting.get(EGRESS_SYSTEM_OWNER)?.length ? EGRESS_SYSTEM_OWNER : null;
}

function takeSlot(s: ProviderState, owner: string, now: number, shadow = false): void {
  s.inFlight++;
  s.calls++;
  // Under `shadow` the bucket does not go into debt: a later switch to `on` must not open with a
  // backlog of tokens owed for calls that were already sent.
  if (s.ratePerMin) s.tokens = shadow ? Math.max(0, s.tokens - 1) : s.tokens - 1;
  s.lastServed.set(owner, ++grantSeq);
  s.recentStarts.push(now);
  const cutoff = now - 60_000;
  while (s.recentStarts.length && s.recentStarts[0] < cutoff) s.recentStarts.shift();
}

function dispatch(s: ProviderState): void {
  const now = Date.now();
  s.refill(now);
  while (s.inFlight < s.spec.maxConcurrent && s.hasWaiters()) {
    const wait = s.msUntilToken();
    if (wait > 0) {
      if (!s.refillTimer) {
        s.refillTimer = setTimeout(() => {
          s.refillTimer = null;
          dispatch(s);
        }, wait);
        s.refillTimer.unref?.();
      }
      return;
    }
    const owner = nextOwner(s, now)!;
    const q = s.waiting.get(owner)!;
    const w = q.shift()!;
    if (!q.length) s.waiting.delete(owner);
    takeSlot(s, owner, now);
    w.grant();
  }
}

function release(s: ProviderState): void {
  s.inFlight = Math.max(0, s.inFlight - 1);
  dispatch(s);
}

/**
 * Awaits a turn. A turn that never came in time is noted in the caller's cache scope as "busy" (noted
 * here, in the caller's own async context, rather than in the timer that refused it), so the cache may
 * answer from an expired entry instead (WP-I2). The provider did not refuse anything, so it is not
 * reported as limiting requests.
 */
async function waitForTurn(hostname: string, turn: Promise<void>): Promise<void> {
  try {
    await turn;
  } catch (err) {
    if (isEgressWaitExceeded(err)) noteBusy(hostname);
    throw err;
  }
}

export interface GovernedOptions {
  /** The caller's own deadline (epoch ms). */
  deadlineAt?: number;
  signal?: AbortSignal | null;
  /** Defaults to the current request's or job's owner (`egress-context.ts`). */
  owner?: string;
  /** A separate set of slots for long calls to the same host (see the module comment). */
  lane?: string;
  /** Which token the call carries (WP-I4); built by `credentialForCall` in `credentials.ts`. */
  credential?: GovernedCredential;
}

/**
 * The key the team-wide 429 pause (`provider-pause.ts`) uses for a call. A person's own token is paused on
 * its own: the provider limited that token, not the team's (WP-I4).
 */
export function pauseKeyFor(hostname: string, ownBucket?: string | null): string {
  return ownBucket ? `${hostname}#own:${ownBucket}` : hostname;
}

/** The credential side of a call: its bucket, and what to do when it is actually sent. */
export interface GovernedCredential {
  /** Opaque id of a person's own token; null for the team token (the provider's shared bucket). */
  bucket: string | null;
  /** Called once, when the call is sent (in every mode): records the use and charges a team share. */
  onSend?: () => void;
}

/**
 * Run `fn` (one outbound request to `hostname`) when the governor gives it a turn.
 *
 * A call that would get its turn too late to finish fails with {@link EgressWaitExceededError}.
 */
export async function governed<T>(hostname: string, fn: () => Promise<T>, opts: GovernedOptions = {}): Promise<T> {
  // The use is recorded (and a team share charged) only for a call that really goes out: a caller that
  // gave up while waiting for its turn is not charged.
  const send = opts.credential?.onSend
    ? () => {
        if (!opts.signal?.aborted) opts.credential!.onSend!();
        return fn();
      }
    : fn;
  const mode = egressGovernorMode();
  if (mode === "off") return send();
  const now = Date.now();
  const s = stateFor(hostname, now, opts.lane, opts.credential?.bucket);
  if (!s) return send();
  const owner = opts.owner ?? currentEgressOwner();

  if (mode === "shadow") {
    s.refill(now);
    const wouldHold = s.inFlight >= s.spec.maxConcurrent || s.msUntilToken() > 0;
    if (wouldHold) {
      s.wouldHold++;
      if (now - s.lastShadowLog > 60_000) {
        s.lastShadowLog = now;
        console.warn(
          `[egress:shadow] ${s.label} (${s.spec.id}): a call would have waited its turn ` +
            `(${s.inFlight}/${s.spec.maxConcurrent} in flight${s.ratePerMin ? `, ${Math.round(s.ratePerMin)}/min` : ""}); ` +
            `${s.wouldHold} such calls so far (sent anyway).`
        );
      }
    }
    takeSlot(s, owner, now, true);
    try {
      return await send();
    } finally {
      // `release` dispatches too, in case the mode changed while `on` waiters were queued.
      release(s);
    }
  }

  // on
  if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("Aborted");
  s.refill(now);
  if (s.inFlight < s.spec.maxConcurrent && !s.hasWaiters() && s.msUntilToken() === 0) {
    takeSlot(s, owner, now);
  } else {
    s.held++;
    await waitForTurn(hostname, new Promise<void>((resolve, reject) => {
      const limitAt = Math.min(
        opts.deadlineAt !== undefined ? opts.deadlineAt - DEADLINE_MARGIN_MS : Number.POSITIVE_INFINITY,
        now + MAX_WAIT_MS
      );
      let timer: ReturnType<typeof setTimeout> | null = null;
      const waiter: Waiter = {
        owner,
        enqueuedAt: now,
        grant: () => {
          cleanup();
          resolve();
        },
        fail: (err: Error) => {
          cleanup();
          reject(err);
        },
      };
      const remove = () => {
        const q = s.waiting.get(owner);
        if (!q) return;
        const i = q.indexOf(waiter);
        if (i >= 0) q.splice(i, 1);
        if (!q.length) s.waiting.delete(owner);
      };
      const onAbort = () => {
        remove();
        waiter.fail(opts.signal?.reason ?? new Error("Aborted"));
      };
      function cleanup() {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      }
      const q = s.waiting.get(owner) ?? [];
      q.push(waiter);
      s.waiting.set(owner, q);
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        remove();
        s.refused++;
        waiter.fail(new EgressWaitExceededError(s.spec.id, s.label, Date.now() - now));
        // The departing waiter may have been the head of a rotation; let the rest move.
        dispatch(s);
      }, Math.max(0, limitAt - now));
      timer.unref?.();
      dispatch(s);
    }));
  }
  try {
    return await send();
  } finally {
    release(s);
  }
}

/**
 * Feed one upstream answer back, so the rate adapts. A rate-limit answer (429, or 503 with
 * `Retry-After`) halves the rate, once per {@link DECREASE_COOLDOWN_MS}, never below its floor, and
 * gives an unmeasured provider a rate learned from the traffic that drew it; 20 successes raise the
 * rate by 5%, never above a published or configured limit. Recorded under `shadow` too, so the values
 * can be read before `on`.
 */
export function noteEgressAnswer(
  hostname: string,
  status: number,
  retryAfter: string | null = null,
  now = Date.now(),
  lane?: string,
  ownBucket?: string | null
): void {
  if (egressGovernorMode() === "off") return;
  const s = stateFor(hostname, now, lane, ownBucket);
  if (!s) return;
  if (isRateLimitAnswer(status, retryAfter)) {
    s.rateLimits++;
    s.successStreak = 0;
    s.lastRateLimitAt = now;
    if (now - s.lastDecreaseAt < DECREASE_COOLDOWN_MS) return;
    if (s.ratePerMin) {
      s.ratePerMin = Math.max(s.rateFloor, s.ratePerMin / 2);
    } else {
      const cutoff = now - 60_000;
      const lastMinute = s.recentStarts.filter(t => t >= cutoff).length;
      if (lastMinute < LEARN_MIN_CALLS) return;
      s.ratePerMin = Math.max(MIN_RATE_PER_MIN, lastMinute / 2);
      s.basis = "observed";
    }
    s.lastDecreaseAt = now;
    s.burst = Math.max(1, Math.ceil(s.ratePerMin / 60));
    s.tokens = Math.min(s.tokens, s.burst);
    console.warn(
      `[egress] ${s.label} (${s.spec.id}) answered ${status}; its rate is now ${Math.round(s.ratePerMin * 10) / 10}/min (${s.basis}).`
    );
    return;
  }
  if (status >= 200 && status < 400 && s.ratePerMin) {
    if (++s.successStreak < INCREASE_AFTER_SUCCESSES) return;
    s.successStreak = 0;
    const next = s.ratePerMin + Math.max(1, s.ratePerMin * 0.05);
    s.ratePerMin = s.rateCap !== undefined ? Math.min(s.rateCap, next) : next;
    s.burst = Math.max(s.spec.burst ?? 1, Math.ceil(s.ratePerMin / 60));
  }
}

/** The basis of the rate in force for `hostname` (for the pause's health lines). */
export function limitBasisFor(hostname: string): LimitBasis {
  const spec = specFor(hostname);
  if (!spec) return "unmeasured";
  return states.get(spec.id)?.basis ?? spec.limitBasis;
}

export interface GovernorProviderHealth {
  id: string;
  /** For the line that sums people's own tokens at one provider: how many tokens it sums. */
  ownTokens?: number;
  provider: string;
  hostnames: string[];
  credentialKind: ProviderSpec["credentialKind"];
  maxConcurrent: number;
  inFlight: number;
  waiting: number;
  ratePerMin: number | null;
  limitBasis: LimitBasis;
  source: string | null;
  calls: number;
  held: number;
  wouldHold: number;
  refused: number;
  rateLimits: number;
}

function healthOf(s: ProviderState): GovernorProviderHealth {
  return {
    id: s.spec.id,
    provider: s.label,
    hostnames: s.spec.hostnames,
    credentialKind: s.spec.credentialKind,
    maxConcurrent: s.spec.maxConcurrent,
    inFlight: s.inFlight,
    waiting: s.waitingCount(),
    ratePerMin: s.ratePerMin !== undefined ? Math.round(s.ratePerMin * 10) / 10 : null,
    limitBasis: s.basis,
    source: s.spec.source ?? null,
    calls: s.calls,
    held: s.held,
    wouldHold: s.wouldHold,
    refused: s.refused,
    rateLimits: s.rateLimits,
  };
}

/**
 * Providers the governor has seen traffic for since start-up. Hostnames and counts only.
 *
 * `publicView` (the unauthenticated `/capabilities`): hosts that are neither in the registry nor a
 * provider this deployment calls on its own account are request-chosen endpoints (a person's own
 * AlphaGenome or GPN server), so they are summed into one unnamed `other` line.
 */
export function governorHealth(opts: { publicView?: boolean } = {}): GovernorProviderHealth[] {
  const named: GovernorProviderHealth[] = [];
  let other: GovernorProviderHealth | null = null;
  // People's own tokens are summed per provider, never listed one by one (WP-I4).
  const ownLines = new Map<string, GovernorProviderHealth>();
  for (const s of states.values()) {
    const h = healthOf(s);
    const host = s.spec.hostnames[0] ?? "";
    if (s.spec.ownToken) {
      // How many people's tokens are in use is not for the public page (WP-I4).
      const baseId = s.spec.id.slice(0, s.spec.id.indexOf("#own:"));
      let line = ownLines.get(baseId);
      if (!line) {
        line = { ...h, id: `${baseId}#own-tokens`, provider: `${s.label} (people's own tokens)`, ownTokens: 0, maxConcurrent: s.spec.maxConcurrent, inFlight: 0, waiting: 0, calls: 0, held: 0, wouldHold: 0, refused: 0, rateLimits: 0 };
        ownLines.set(baseId, line);
      }
      line.ownTokens = (line.ownTokens ?? 0) + 1;
      for (const k of ["inFlight", "waiting", "calls", "held", "wouldHold", "refused", "rateLimits"] as const) line[k] += h[k];
      continue;
    }
    if (!opts.publicView || s.spec.registered || isKnownProviderHost(host)) {
      named.push(h);
      continue;
    }
    other ??= {
      id: "other",
      provider: "Other hosts",
      hostnames: [],
      credentialKind: "ip",
      maxConcurrent: DEFAULT_MAX_CONCURRENT,
      inFlight: 0,
      waiting: 0,
      ratePerMin: null,
      limitBasis: "unmeasured",
      source: null,
      calls: 0,
      held: 0,
      wouldHold: 0,
      refused: 0,
      rateLimits: 0,
    };
    for (const k of ["inFlight", "waiting", "calls", "held", "wouldHold", "refused", "rateLimits"] as const) {
      other[k] += h[k];
    }
  }
  named.push(...[...ownLines.values()].map(l => (opts.publicView ? { ...l, ownTokens: undefined } : l)));
  named.sort((a, b) => a.id.localeCompare(b.id));
  return other ? [...named, other] : named;
}

/** Test hook: state is module-global; the registry is re-read so env overrides apply. */
export function resetEgressGovernorForTests(): void {
  for (const s of states.values()) if (s.refillTimer) clearTimeout(s.refillTimer);
  states.clear();
  specs = null;
  grantSeq = 0;
}
