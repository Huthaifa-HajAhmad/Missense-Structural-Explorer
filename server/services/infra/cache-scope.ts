/**
 * cache-scope.ts — what happened to a piece of work's outbound calls (doc/COMPUTE_ROUTING_PLAN.md WP-I2).
 *
 * Two facts travel up from deep inside a fetch to the code that decides what to cache and what to tell
 * the reader:
 *
 *   - a provider limited requests (a 429, a 503 with Retry-After, a team pause refusal), or a call's
 *     turn at a busy provider did not come before its deadline (the governor; the provider itself did
 *     not refuse). `getCachedOrFetch` uses either to serve an expired entry instead of failing, even
 *     when the fetcher swallowed the error and returned null;
 *   - an expired entry was served. A result built from it must not be cached as fresh, and the response
 *     says so (`X-MSE-Stale`, read by the client).
 *
 * Scopes nest: the API router opens one per request, and every cache fill opens one for its fetcher.
 * A note is added to the current scope and every scope above it. Work shared by several callers
 * (single-flight) runs in a scope of its own ({@link startShared}), and each caller copies its notes
 * into theirs ({@link joinShared}).
 *
 * No dependencies on other server modules, so `provider-pause.ts` and `http-client.ts` can import it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** One expired entry served in place of a fresh answer. */
export interface StaleServe {
  /** The cache's `source` label (for example `UniProt FASTA`): which data is out of date. */
  source: string;
  /** The hostnames that caused it: the rate-limited ones, else the busy ones. */
  hosts: string[];
  /** True when no provider refused: the calls only waited too long for their turn (governor). */
  busy: boolean;
  /** Age of the served value in seconds, from when it was fetched. */
  ageSec: number;
}

export interface CacheScope {
  readonly parent: CacheScope | null;
  readonly rateLimitedHosts: Set<string>;
  /** Hosts at which a call's turn did not come before its deadline. */
  readonly busyHosts: Set<string>;
  readonly stale: StaleServe[];
}

const current = new AsyncLocalStorage<CacheScope>();

export function newCacheScope(parent: CacheScope | null = null): CacheScope {
  return { parent, rateLimitedHosts: new Set(), busyHosts: new Set(), stale: [] };
}

export function currentCacheScope(): CacheScope | null {
  return current.getStore() ?? null;
}

/** Run `fn` inside `scope`. */
export function runInCacheScope<T>(scope: CacheScope, fn: () => T): T {
  return current.run(scope, fn);
}

function eachUp(scope: CacheScope | null, visit: (s: CacheScope) => void): void {
  for (let s = scope; s; s = s.parent) visit(s);
}

/** A provider limited a call made in the current scope. */
export function noteRateLimited(hostname: string): void {
  eachUp(currentCacheScope(), s => s.rateLimitedHosts.add(hostname));
}

/** A call in the current scope gave up waiting for its turn at a busy provider. */
export function noteBusy(hostname: string): void {
  eachUp(currentCacheScope(), s => s.busyHosts.add(hostname));
}

/** An expired entry was served in the current scope. */
export function noteStaleServed(serve: StaleServe): void {
  eachUp(currentCacheScope(), s => s.stale.push(serve));
}

/** Copy what `from` saw into the current scope (a caller joining a shared cache fill). */
export function mergeIntoCurrentScope(from: Pick<CacheScope, "rateLimitedHosts" | "busyHosts" | "stale">): void {
  for (const host of from.rateLimitedHosts) noteRateLimited(host);
  for (const host of from.busyHosts) noteBusy(host);
  for (const serve of from.stale) noteStaleServed(serve);
}

/** Work several callers share, with the scope its own fetches noted into. */
export interface SharedRun<T> {
  readonly promise: Promise<T>;
  readonly scope: CacheScope;
}

/**
 * Start work that several callers will share, in a scope of its own: not the first caller's, whose
 * request is just one of the requests it serves. Each caller then takes the result through
 * {@link joinShared}, which copies the scope's notes into that caller's own scope.
 */
export function startShared<T>(fn: () => Promise<T>): SharedRun<T> {
  const scope = newCacheScope();
  return { promise: runInCacheScope(scope, fn), scope };
}

/**
 * The shared result for the current caller. The notes are copied when it settles, in the caller's own
 * async context (a `.then` callback runs in the context it was registered in), success or failure.
 */
export function joinShared<T>(run: SharedRun<T>): Promise<T> {
  return run.promise.then(
    value => {
      mergeIntoCurrentScope(run.scope);
      return value;
    },
    error => {
      mergeIntoCurrentScope(run.scope);
      throw error;
    }
  );
}
