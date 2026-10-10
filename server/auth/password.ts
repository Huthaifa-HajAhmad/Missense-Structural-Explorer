/**
 * auth/password.ts — scrypt password hashing (no dependency; `node:crypto`).
 *
 * Format: `scrypt$N$r$p$saltB64$hashB64`. The parameters travel with the hash, so they can be raised
 * later and old hashes still verify. N = 2^15, r = 8 uses 32 MiB and ~0.1 s per hash: affordable on
 * the 2-vCPU host for a small team, expensive for an offline guesser. Hashing runs on the libuv pool
 * (async `scrypt`), so a login never blocks the event loop.
 */
import crypto from "crypto";
import { PASSWORD_MAX_LENGTH } from "../../src/shared/accountPolicy.ts";

export { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, passwordProblem } from "../../src/shared/accountPolicy.ts";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAX_MEM = 64 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number, keyLen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLen, { N: n, r, p, maxmem: MAX_MEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P, KEY_LEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (typeof password !== "string" || password.length > PASSWORD_MAX_LENGTH) return false;
  const parts = stored?.split("$");
  if (!parts || parts.length !== 6 || parts[0] !== "scrypt") {
    // Spend the same time as a real check, so "no such user" and "wrong password" look the same.
    await scryptAsync(password, DUMMY_SALT, N, R, P, KEY_LEN);
    return false;
  }
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");
  const salt = Buffer.from(saltB64, "base64");
  const [cost, block, parallel] = [Number(n), Number(r), Number(p)];
  // FAIL CLOSED on a damaged row. An empty hash segment decodes to zero bytes, scrypt then returns a
  // zero-length key, and timingSafeEqual(empty, empty) is true — any password would verify.
  const wellFormed =
    expected.length >= MIN_STORED_KEY_BYTES &&
    salt.length >= MIN_STORED_SALT_BYTES &&
    Number.isInteger(cost) && cost >= 2 ** 14 && (cost & (cost - 1)) === 0 &&
    Number.isInteger(block) && block >= 1 && block <= 32 &&
    Number.isInteger(parallel) && parallel >= 1 && parallel <= 16;
  if (!wellFormed) {
    await scryptAsync(password, DUMMY_SALT, N, R, P, KEY_LEN);
    return false;
  }
  const actual = await scryptAsync(password, salt, cost, block, parallel, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

const DUMMY_SALT = crypto.randomBytes(16);
/** Below these a stored hash cannot be one this module wrote (64-byte key, 16-byte salt). */
const MIN_STORED_KEY_BYTES = 32;
const MIN_STORED_SALT_BYTES = 16;
