/**
 * credentials.ts — which token a remote model call uses, and whose allowance it spends (WP-I4).
 *
 * Biohub (EvolutionaryScale Forge), Hugging Face and Tamarind count calls against the token that made them.
 * The server holds a team token for each (`BIOHUB_API_TOKEN`, `HF_TOKEN`, `TAMARIND_API_KEY`), and a person
 * may bring their own: in the request (Settings → Connections, this browser) or saved to their account
 * (`auth/user-secrets.ts`). {@link resolveCredential} decides, in this order:
 *
 *   1. a token the request brought: the person's own (unless it IS the team token, by value: a route that
 *      already resolved passes the team token on, and it must still count as the team's);
 *   2. the token the signed-in person saved to their account;
 *   3. the team token, under `SHARED_TOKEN_FALLBACK`:
 *        on       lent to anyone without a token, shared fairly by the governor;
 *        limited  (default) the same, and each signed-in person may make `SHARED_TOKEN_SHARE_PER_HOUR`
 *                 team-token calls per provider per hour; past that, no token (they are told to add
 *                 their own). Without accounts (`legacy`) nobody is told apart, so it behaves like `on`;
 *        off      never lent.
 *
 * A person with their own token never falls back to the team's: once step 1 or 2 answers, step 3 is not
 * reached, whatever the provider then says.
 *
 * Each call then goes through the governor with {@link credentialForCall}: a person's own token gets its
 * own bucket (its own allowance at the provider; the team token's slots are not spent), the team token the
 * provider's shared one. When the call is sent, the use is recorded for the response (`X-MSE-Credentials`)
 * and a team call is charged to the person's hourly share.
 *
 * Tokens are never logged, cached, or put in a cache key. A bucket id is random, not derived from the token.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import {
  CREDENTIAL_LABELS,
  type CredentialKind,
  type CredentialRefusal,
  type CredentialSource,
  type CredentialUse,
  type SharedTokenFallback,
} from "../../../src/shared/credentials.ts";
import { EGRESS_SYSTEM_OWNER, EGRESS_UNATTRIBUTED, currentEgressOwner } from "./egress-context.ts";
import { governed, pauseKeyFor, type GovernedCredential } from "./egress-governor.ts";
import { awaitProviderPause } from "./provider-pause.ts";
import { userSecretState } from "../../auth/user-secrets.ts";

/** The server's team token for each kind, by environment variable in order of preference. */
const TEAM_ENV: Readonly<Record<CredentialKind, readonly string[]>> = {
  biohub: ["BIOHUB_API_TOKEN", "ESM3_FORGE_API_KEY"],
  huggingface: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
  tamarind: ["TAMARIND_API_KEY"],
};

/** The host each kind's calls count against (the sidecar's calls are governed as this host). */
export const CREDENTIAL_HOSTS: Readonly<Record<CredentialKind, string>> = {
  biohub: "forge.evolutionaryscale.ai",
  huggingface: "huggingface.co",
  tamarind: "app.tamarind.bio",
};

export const DEFAULT_SHARE_PER_HOUR = 60;
const HOUR_MS = 60 * 60_000;
/** Owners that are not one identifiable person: no saved tokens, no per-person share. */
const NOT_A_PERSON = new Set(["legacy", EGRESS_SYSTEM_OWNER, EGRESS_UNATTRIBUTED]);

export function teamToken(kind: CredentialKind): string | null {
  for (const name of TEAM_ENV[kind]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

let warnedFallback = "";
export function sharedTokenFallback(): SharedTokenFallback {
  const raw = (process.env.SHARED_TOKEN_FALLBACK ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "limited" || raw === "off") return raw;
  if (raw && raw !== warnedFallback) {
    warnedFallback = raw;
    console.warn(`[credentials] SHARED_TOKEN_FALLBACK="${raw}" is not on, limited or off; using limited.`);
  }
  return "limited";
}

export function teamSharePerHour(): number {
  const n = Number(process.env.SHARED_TOKEN_SHARE_PER_HOUR);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_SHARE_PER_HOUR;
}

/** Whether `owner` is one identifiable person (a signed-in account). */
export function isPerson(owner: string): boolean {
  return Boolean(owner) && !NOT_A_PERSON.has(owner);
}

export interface ResolvedCredential {
  kind: CredentialKind;
  token: string | null;
  source: CredentialSource;
  refusal?: CredentialRefusal;
}

// ── Per-request record: what this request resolved and used, for `X-MSE-Credentials` ──────────────

interface MemoEntry {
  /** Whose resolution it is: a job or pre-warm started inside a request runs as another owner. */
  owner: string;
  resolved: ResolvedCredential;
}

export interface CredentialRecord {
  /** Resolutions made in this request, per kind, so repeated lookups agree (and a refusal can be reported). */
  readonly resolved: Map<CredentialKind, MemoEntry>;
  /** What the response reports: calls sent, and refusals of calls that would have been made. */
  readonly uses: Map<CredentialKind, CredentialUse>;
}

const records = new AsyncLocalStorage<CredentialRecord>();

export function newCredentialRecord(): CredentialRecord {
  return { resolved: new Map(), uses: new Map() };
}

export function runWithCredentialRecord<T>(record: CredentialRecord, fn: () => T): T {
  return records.run(record, fn);
}

/** What the current request's remote calls used (and any refusal), for the response. */
export function currentCredentialUses(): CredentialUse[] {
  return [...(records.getStore()?.uses.values() ?? [])];
}

function noteUse(use: CredentialUse): void {
  const rec = records.getStore();
  if (!rec) return;
  const prev = rec.uses.get(use.kind);
  // A call that was sent outranks a refusal recorded in the same request.
  if (prev && prev.source !== "none" && use.source === "none") return;
  rec.uses.set(use.kind, use);
}

/**
 * Work several callers share (the core analysis run, a shared Tamarind submission) runs in a record of
 * its own; each caller then copies its uses into theirs, so every response says whose token the shared
 * call ran on (its source is the same for all of them: see {@link credentialSourceTag}).
 */
export function startWithOwnCredentialRecord<T>(fn: () => Promise<T>): { promise: Promise<T>; record: CredentialRecord } {
  const record = newCredentialRecord();
  return { promise: records.run(record, fn), record };
}

export function mergeCredentialUses(from: CredentialRecord): void {
  for (const use of from.uses.values()) noteUse(use);
}

// ── Team-token share per person (limited) ───────────────────────────────────────────────────────

const teamCalls = new Map<string, number[]>();
const SWEEP_ABOVE = 2000;

function shareKey(owner: string, kind: CredentialKind): string {
  return `${owner}\n${kind}`;
}

function recentTeamCalls(owner: string, kind: CredentialKind, now: number): number[] {
  const key = shareKey(owner, kind);
  const list = (teamCalls.get(key) ?? []).filter(t => now - t < HOUR_MS);
  if (list.length) teamCalls.set(key, list);
  else teamCalls.delete(key);
  return list;
}

/** Team-token calls this person may still make this hour; Infinity when no share applies. */
export function teamShareLeft(kind: CredentialKind, owner = currentEgressOwner(), now = Date.now()): number {
  if (sharedTokenFallback() !== "limited" || !isPerson(owner)) return Number.POSITIVE_INFINITY;
  return Math.max(0, teamSharePerHour() - recentTeamCalls(owner, kind, now).length);
}

function chargeTeamCall(kind: CredentialKind, owner: string, now = Date.now()): void {
  if (sharedTokenFallback() !== "limited" || !isPerson(owner)) return;
  if (teamCalls.size > SWEEP_ABOVE) {
    // People who have left keep no entry: drop every list whose calls are all older than an hour.
    for (const [key, list] of teamCalls) if (!list.some(t => now - t < HOUR_MS)) teamCalls.delete(key);
  }
  const list = recentTeamCalls(owner, kind, now);
  list.push(now);
  teamCalls.set(shareKey(owner, kind), list);
}

// ── Resolution ──────────────────────────────────────────────────────────────────────────────────

/** The person's saved token, "unreadable" when a row exists that no longer decrypts, or null. */
function savedTokenState(owner: string, kind: CredentialKind): string | "unreadable" | null {
  if (!isPerson(owner)) return null;
  try {
    const state = userSecretState(owner, kind);
    return state.state === "readable" ? state.token : state.state === "unreadable" ? "unreadable" : null;
  } catch (err: any) {
    console.warn(`[credentials] Could not read a saved ${kind} token: ${err?.message ?? err}`);
    return null;
  }
}

function savedToken(owner: string, kind: CredentialKind): string | null {
  const state = savedTokenState(owner, kind);
  return state && state !== "unreadable" ? state : null;
}

/** Step 3: the team token under the lending policy and this person's hourly share. */
function lendTeamToken(kind: CredentialKind, team: string, owner: string): ResolvedCredential {
  const policy = sharedTokenFallback();
  if (policy === "off") return { kind, token: null, source: "none", refusal: "team-token-off" };
  if (teamShareLeft(kind, owner) <= 0) return { kind, token: null, source: "none", refusal: "team-share-used" };
  return { kind, token: team, source: "team" };
}

/**
 * The token to use for `kind`. `supplied` is a token the caller already has (from the request, or one an
 * earlier resolution returned); it is classified by value, and the team token is re-checked against the
 * policy and the share every time (a resolution made earlier in the request may be out of date by the
 * time the call is made). Nothing is charged here, and nothing is reported: a refusal is reported only
 * where a call would have been made ({@link governedForCredential}, {@link noteRefusal}).
 */
export function resolveCredential(
  kind: CredentialKind,
  supplied?: string | null,
  opts: {
    /**
     * A status poll or a connection test: it must keep working for a job already submitted on the team
     * token, so the hourly share does not refuse it (the policy still does), and it is not memoised.
     */
    statusOnly?: boolean;
  } = {}
): ResolvedCredential {
  const given = typeof supplied === "string" ? supplied.trim() : "";
  const team = teamToken(kind);
  if (given && given !== team) return { kind, token: given, source: "own" };
  const owner = currentEgressOwner();

  if (opts.statusOnly) {
    const saved = savedToken(owner, kind);
    if (saved) return { kind, token: saved, source: "own" };
    if (team && sharedTokenFallback() !== "off") return { kind, token: team, source: "team" };
    return { kind, token: null, source: "none" };
  }

  const rec = records.getStore();
  const memo = rec?.resolved.get(kind);
  let resolved: ResolvedCredential;
  if (memo && memo.owner === owner && memo.resolved.source === "own" && !given) {
    resolved = memo.resolved;
  } else {
    const saved = given ? null : savedTokenState(owner, kind);
    if (saved === "unreadable") resolved = { kind, token: null, source: "none", refusal: "own-token-unreadable" };
    else if (saved) resolved = { kind, token: saved, source: "own" };
    else if (!team) resolved = { kind, token: null, source: "none" };
    // A person with their own token (sent or saved) never reaches this line.
    else resolved = lendTeamToken(kind, team, owner);
  }
  rec?.resolved.set(kind, { owner, resolved });
  return resolved;
}

/** Report this request's refusal for `kind`, if its resolution was one: a call would have been made here. */
export function noteRefusal(kind: CredentialKind): void {
  const entry = records.getStore()?.resolved.get(kind);
  if (entry?.owner === currentEgressOwner() && entry.resolved.refusal) {
    noteUse({ kind, source: "none", refusal: entry.resolved.refusal });
  }
}

/**
 * The person's own token for `kind`: the one the request brought, else the one saved to their account.
 * Never the team's. For "Test connection", which must not report on (or name the account behind) the team
 * token.
 */
export function ownCredential(kind: CredentialKind, supplied?: string | null): string | null {
  const given = typeof supplied === "string" ? supplied.trim() : "";
  if (given && given !== teamToken(kind)) return given;
  return savedToken(currentEgressOwner(), kind);
}

/** Whether a call for `kind` would carry a token (own, saved or team), without recording anything. */
export function credentialAvailable(kind: CredentialKind, supplied?: string | null): boolean {
  const given = typeof supplied === "string" ? supplied.trim() : "";
  const team = teamToken(kind);
  if (given && given !== team) return true;
  const owner = currentEgressOwner();
  const saved = savedTokenState(owner, kind);
  if (saved === "unreadable") return false;
  if (saved) return true;
  return Boolean(team) && sharedTokenFallback() !== "off" && teamShareLeft(kind, owner) > 0;
}

/**
 * Which kind of token a call for `kind` carrying `token` spends, for the key of work several callers share:
 * `none`, `team`, or `own:<owner>`. Callers on the team token share one run; a person's own token serves
 * only that person's requests (it is never spent on someone else's), so it is scoped to the owner. Never
 * the token, nor anything derived from it.
 */
export function credentialSourceTag(kind: CredentialKind, token: string | null | undefined): string {
  const given = typeof token === "string" ? token.trim() : "";
  if (!given) return "none";
  return given === teamToken(kind) ? "team" : `own:${currentEgressOwner()}`;
}

// ── Calls ───────────────────────────────────────────────────────────────────────────────────────

/** Opaque bucket ids for own tokens: random, keyed by a digest held only in this map (bounded, LRU). */
const ownBuckets = new Map<string, string>();
const MAX_OWN_BUCKETS = 1000;
/**
 * Distinct own tokens one owner may use per provider per hour, each with its own bucket. Past that, a
 * further token shares the provider's team bucket: inventing tokens must not multiply the server's slots.
 */
export const MAX_OWN_TOKENS_PER_OWNER = 3;
const ownTokensByOwner = new Map<string, Map<string, number>>();

function bucketFor(token: string): string {
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  let id = ownBuckets.get(digest);
  if (id) {
    // Refresh: least recently used goes first, so a token in use keeps its bucket (and its pause).
    ownBuckets.delete(digest);
  } else {
    if (ownBuckets.size >= MAX_OWN_BUCKETS) ownBuckets.delete(ownBuckets.keys().next().value as string);
    id = crypto.randomBytes(6).toString("hex");
  }
  ownBuckets.set(digest, id);
  return id;
}

/** The own bucket for this owner's token, or null when the owner has used too many distinct tokens. */
function ownBucketFor(kind: CredentialKind, token: string, owner: string, now = Date.now()): string | null {
  const id = bucketFor(token);
  const key = `${owner}\n${kind}`;
  const seen = ownTokensByOwner.get(key) ?? new Map<string, number>();
  for (const [bucket, at] of seen) if (now - at >= HOUR_MS) seen.delete(bucket);
  if (!seen.has(id) && seen.size >= MAX_OWN_TOKENS_PER_OWNER) {
    ownTokensByOwner.set(key, seen);
    return null;
  }
  seen.set(id, now);
  ownTokensByOwner.set(key, seen);
  if (ownTokensByOwner.size > SWEEP_ABOVE) {
    for (const [k, m] of ownTokensByOwner) if (![...m.values()].some(t => now - t < HOUR_MS)) ownTokensByOwner.delete(k);
  }
  return id;
}

/**
 * The governor's view of a call carrying `token` for `kind`: a person's own token gets its own bucket,
 * the team token the provider's shared one. When the call is sent, its use is recorded for the response
 * and, for the team token under `limited`, charged to the person's hourly share (`charge: false` for a
 * status poll or a connection test, which spend nothing worth rationing).
 */
export function credentialForCall(
  kind: CredentialKind,
  token: string,
  opts: { charge?: boolean } = {}
): GovernedCredential {
  const source: CredentialSource = token === teamToken(kind) ? "team" : "own";
  const owner = currentEgressOwner();
  return {
    bucket: source === "own" ? ownBucketFor(kind, token, owner) : null,
    onSend: () => {
      noteUse({ kind, source });
      if (source === "team" && opts.charge !== false) chargeTeamCall(kind, owner);
    },
  };
}

/**
 * Run `fn`, a call that reaches `kind`'s provider with `token`, as a governed call to that provider. For
 * calls that leave through the Python sidecar (ESM3, ESMC, ESMFold, ESM-2, SaProt): the request Node makes
 * is to loopback, but with a token the sidecar calls Biohub or Hugging Face, so that is what is counted.
 * Without a token the sidecar stays local and `fn` runs ungoverned; if that is because the team token was
 * refused, the refusal is reported (unless `noteRefusal: false`: the call would not have used a token).
 */
export async function governedForCredential<T>(
  kind: CredentialKind,
  token: string | null | undefined,
  fn: () => Promise<T>,
  opts: { charge?: boolean; lane?: string; deadlineAt?: number; signal?: AbortSignal | null; noteRefusal?: boolean } = {}
): Promise<T> {
  if (!token) {
    if (opts.noteRefusal !== false) noteRefusal(kind);
    return fn();
  }
  const credential = credentialForCall(kind, token, { charge: opts.charge });
  const host = CREDENTIAL_HOSTS[kind];
  await awaitProviderPause(pauseKeyFor(host, credential.bucket), {
    deadlineAt: opts.deadlineAt,
    signal: opts.signal,
    provider: CREDENTIAL_LABELS[kind],
  });
  return governed(host, fn, { lane: opts.lane, deadlineAt: opts.deadlineAt, signal: opts.signal, credential });
}

/** `/capabilities`: the policy and which team tokens exist. No tokens, no hashes, no per-person counts. */
export function credentialPolicyHealth(): {
  fallback: SharedTokenFallback;
  sharePerHour: number;
  teamTokens: Record<CredentialKind, boolean>;
} {
  return {
    fallback: sharedTokenFallback(),
    sharePerHour: teamSharePerHour(),
    teamTokens: {
      biohub: Boolean(teamToken("biohub")),
      huggingface: Boolean(teamToken("huggingface")),
      tamarind: Boolean(teamToken("tamarind")),
    },
  };
}

export function resetCredentialsForTests(): void {
  teamCalls.clear();
  ownBuckets.clear();
  ownTokensByOwner.clear();
  warnedFallback = "";
}
