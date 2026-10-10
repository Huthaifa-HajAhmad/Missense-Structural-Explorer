/**
 * auth/providers/password.ts — the app's own sign-in (the production provider, AUTH_PROVIDER=password).
 *
 * Every failure looks the same from outside: unknown email, wrong password and disabled account all
 * return `invalid` after the same scrypt work, and all count against the same throttle keys.
 */
import { verifyPassword } from "../password.ts";
import { getUserCredentials, touchLastLogin, type User } from "../store.ts";
import { lockedFor, recordFailure, recordSuccess, throttleKeys } from "../throttle.ts";

export type SignInResult = { kind: "ok"; user: User } | { kind: "invalid" } | { kind: "locked"; retryAfterMs: number };

export async function signInWithPassword(email: unknown, password: unknown, ip: string | undefined, now: number): Promise<SignInResult> {
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase().slice(0, 320) : "";
  const keys = throttleKeys(ip, cleanEmail || undefined);

  const wait = lockedFor(keys, now);
  if (wait > 0) return { kind: "locked", retryAfterMs: wait };

  const found = cleanEmail ? getUserCredentials(cleanEmail) : null;
  const ok = await verifyPassword(typeof password === "string" ? password : "", found?.passwordHash ?? null);

  if (!ok || !found || found.user.status !== "active") {
    recordFailure(keys, now);
    return { kind: "invalid" };
  }
  recordSuccess(keys);
  touchLastLogin(found.user.id, now);
  return { kind: "ok", user: { ...found.user, lastLoginAt: now } };
}
