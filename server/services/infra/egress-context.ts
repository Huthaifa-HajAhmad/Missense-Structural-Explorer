/**
 * egress-context.ts — whose request an outbound call is made for (doc/COMPUTE_ROUTING_PLAN.md WP-I1).
 *
 * The egress governor shares each remote provider fairly between people, so it has to know who a call
 * is for. Threading a user id through 55 call sites would touch every service signature; instead the
 * API router runs each request inside {@link runWithEgressOwner} (after `authCheck` has resolved the
 * principal), and the queue runs each job inside it with the job's owner. AsyncLocalStorage carries
 * the owner through every await in between, the same way `job-meter.ts` carries a job's sampler.
 *
 * `system` (prewarm and other unrequested work) is served last. A call made outside any context (a
 * start-up task, a timer) is `unattributed`: served like a person, never starved behind `system`.
 *
 * No dependencies on other server modules, so `http-client.ts` can import it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The queue's owner for unrequested work (`queue-owners.ts` SYSTEM_OWNER); served last. */
export const EGRESS_SYSTEM_OWNER = "system";
/** Owner of a call made outside any request or job. */
export const EGRESS_UNATTRIBUTED = "unattributed";

const current = new AsyncLocalStorage<string>();

/** Run `fn` with `owner` as the person every outbound call inside it is made for. */
export function runWithEgressOwner<T>(owner: string, fn: () => T): T {
  return current.run(owner || EGRESS_UNATTRIBUTED, fn);
}

export function currentEgressOwner(): string {
  return current.getStore() ?? EGRESS_UNATTRIBUTED;
}
