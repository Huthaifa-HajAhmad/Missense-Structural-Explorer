/**
 * auth/throttle.ts — brute-force protection for sign-in and first-admin setup.
 *
 * Failures within 15 minutes lock a key for 15 minutes: 5 for one email, 20 for one address. Keys
 * are `ip:<address>` and `email:<lowercased>`, checked together: rotating addresses does not help
 * against one account, and one address cannot spray many accounts. The address limit is higher
 * because a lab shares one NAT address, and one person's typos must not lock out the whole team.
 * Unknown emails are counted exactly like known ones, so the lock reveals nothing about which
 * accounts exist.
 *
 * The address is `req.ip` with `trust proxy = 1` (`express-config.ts`): Caddy appends the real
 * client address as the LAST `X-Forwarded-For` entry and Express takes that one, so a forged header
 * only adds entries to the left and cannot change the key.
 */
import { clearAttempt, getAttempt, putAttempt } from "./store.ts";

export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

/** Milliseconds until the first locked key unlocks, or 0 when none is locked. */
export function lockedFor(keys: string[], now: number): number {
  let wait = 0;
  for (const key of keys) {
    const a = getAttempt(key);
    if (a?.locked_until && a.locked_until > now) wait = Math.max(wait, a.locked_until - now);
  }
  return wait;
}

export function recordFailure(keys: string[], now: number): void {
  for (const key of keys) {
    const a = getAttempt(key);
    const fresh = !a || now - a.first_at > WINDOW_MS;
    const count = fresh ? 1 : a.count + 1;
    // Only the shared-address key gets the team-sized limit; accounts and the setup secret get 5.
    const max = key.startsWith("ip:") ? MAX_FAILURES_PER_IP : MAX_FAILURES_PER_EMAIL;
    putAttempt(key, count, fresh ? now : a.first_at, count >= max ? now + LOCK_MS : null);
  }
}

/**
 * A success clears only the account's own counter. Clearing the address counter too would let anyone
 * holding one valid account reset it between guesses at other accounts.
 */
export function recordSuccess(keys: string[]): void {
  for (const key of keys) if (!key.startsWith("ip:")) clearAttempt(key);
}

export function throttleKeys(ip: string | undefined, email?: string): string[] {
  const keys = [`ip:${ip || "unknown"}`];
  if (email) keys.push(`email:${email.trim().toLowerCase()}`);
  return keys;
}
