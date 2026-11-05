import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";

/**
 * memo.ts — one memo for pure, expensive computations, keyed by their inputs.
 *
 * Two properties matter, and both are load-bearing here:
 *
 *  - The PROMISE is cached, not its value, so concurrent callers of the same question share one run.
 *    That is the case that actually costs CPU: the core run's burial reading and the ESM3 evaluation
 *    ask the same accessibility question about the same structure at the same moment, so a cache that
 *    only stored finished values would still run the tool twice.
 *  - An answer is the only thing remembered. A tool that could not start resolves to an error VALUE
 *    (not a rejection), so `keep` decides what counts as an answer; anything else is dropped at once,
 *    because a retry must be able to repair it. There is no negative caching anywhere in this app.
 *
 * Extracted from `evidence-context/hotspots.ts`, which had the only copy, so the accessibility runner
 * can use the same primitive instead of a second implementation that would drift.
 */

/** Pure functions of their inputs, so a memo cannot serve a stale answer. */
const computed = new LRUCache<string, Promise<unknown>>({ max: 200, ttl: 24 * 60 * 60 * 1000 });

export function memo<T>(
  kind: string,
  input: unknown,
  run: () => Promise<T>,
  keep: (value: T) => boolean = value => value !== null && value !== undefined
): Promise<T> {
  const key = `${kind}:${createHash("sha1").update(JSON.stringify(input)).digest("hex")}`;
  const hit = computed.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const value = run();
  computed.set(key, value);
  value.then(promised => {
    if (!keep(promised)) computed.delete(key);
  }, () => computed.delete(key));
  return value;
}

/** Test hook: module state, like the caches in `cache.ts`. */
export function clearMemoForTests(): void {
  computed.clear();
}
