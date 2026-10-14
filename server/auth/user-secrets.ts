/**
 * user-secrets.ts — a person's own provider tokens, saved to their account (doc/COMPUTE_ROUTING_PLAN.md WP-I4b).
 *
 * A token pasted into Settings → Connections lives in that browser tab only, so it had to be re-entered on
 * every device. A signed-in person may instead save it to their account: it is stored here, encrypted, and
 * used for their requests from any browser (`credentials.ts` reads it when the request brings no token).
 *
 * Encryption: AES-256-GCM. The key is derived with HKDF-SHA256 from `APP_SESSION_SECRET` under its own
 * label, so it is not the session-token key. The person's id and the token kind are bound as additional
 * authenticated data: a ciphertext copied to another person's row, or to another kind, fails to decrypt.
 * Without `APP_SESSION_SECRET` nothing can be saved, and a row that no longer decrypts (the secret was
 * rotated) reads as "saved but unreadable" so the person is asked to enter it again.
 *
 * Tokens are never logged and never returned: the API answers with the kind, the last four characters
 * (`hint`) and when it was saved.
 */
import crypto from "node:crypto";
import { accountsDb } from "./store.ts";
import { isCredentialKind, type CredentialKind } from "../../src/shared/credentials.ts";

export { isCredentialKind };

const FORMAT = "v1";
const MIN_TOKEN_LENGTH = 8;
const MAX_TOKEN_LENGTH = 512;
const MIN_HINT_LENGTH = 20;

export class UserSecretsUnavailableError extends Error {
  readonly code = "SECRETS_UNAVAILABLE";
  constructor() {
    super("Saving tokens to an account needs APP_SESSION_SECRET on the server.");
    this.name = "UserSecretsUnavailableError";
  }
}

let cachedKey: { secret: string; key: Buffer } | null = null;

function secretsKey(): Buffer {
  const secret = process.env.APP_SESSION_SECRET?.trim();
  if (!secret) throw new UserSecretsUnavailableError();
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = Buffer.from(crypto.hkdfSync("sha256", secret, "mse-user-secrets", FORMAT, 32));
  cachedKey = { secret, key };
  return key;
}

function aad(userId: string, kind: CredentialKind): Buffer {
  return Buffer.from(`${userId}\n${kind}`, "utf8");
}

/** A usable token: printable, no whitespace inside, within sane bounds. Null when it is not one. */
export function cleanToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  if (!/^[\x21-\x7e]+$/.test(token)) return null;
  return token;
}

export function encryptSecret(userId: string, kind: CredentialKind, token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretsKey(), iv);
  cipher.setAAD(aad(userId, kind));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [FORMAT, iv.toString("base64"), ciphertext.toString("base64"), cipher.getAuthTag().toString("base64")].join(":");
}

/** The token, or null when the row does not decrypt (wrong person, wrong kind, rotated secret, tampering). */
export function decryptSecret(userId: string, kind: CredentialKind, stored: string): string | null {
  try {
    const [format, ivB64, ctB64, tagB64] = stored.split(":");
    if (format !== FORMAT || !ivB64 || !ctB64 || !tagB64) return null;
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", secretsKey(), iv);
    decipher.setAAD(aad(userId, kind));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface SavedSecretSummary {
  kind: CredentialKind;
  /** The token's last four characters. */
  hint: string;
  updatedAt: number;
  /** False when the row no longer decrypts (the server's secret changed): enter the token again. */
  readable: boolean;
}

export function saveUserSecret(userId: string, kind: CredentialKind, token: string, now = Date.now()): SavedSecretSummary {
  const ciphertext = encryptSecret(userId, kind, token);
  // Four characters of a short token are a large part of it: a short token gets no hint.
  const hint = token.length >= MIN_HINT_LENGTH ? token.slice(-4) : "";
  accountsDb()
    .prepare(
      `INSERT INTO user_secrets (user_id, kind, ciphertext, hint, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, kind) DO UPDATE SET ciphertext = excluded.ciphertext, hint = excluded.hint, updated_at = excluded.updated_at`
    )
    .run(userId, kind, ciphertext, hint, now);
  return { kind, hint, updatedAt: now, readable: true };
}

export function deleteUserSecret(userId: string, kind: CredentialKind): boolean {
  const info = accountsDb().prepare("DELETE FROM user_secrets WHERE user_id = ? AND kind = ?").run(userId, kind);
  return Number(info.changes ?? 0) > 0;
}

export function listUserSecrets(userId: string): SavedSecretSummary[] {
  const rows = accountsDb()
    .prepare("SELECT kind, ciphertext, hint, updated_at FROM user_secrets WHERE user_id = ? ORDER BY kind")
    .all(userId) as { kind: string; ciphertext: string; hint: string; updated_at: number }[];
  let available = true;
  try {
    secretsKey();
  } catch {
    available = false;
  }
  return rows
    .filter(r => isCredentialKind(r.kind))
    .map(r => ({
      kind: r.kind as CredentialKind,
      hint: r.hint,
      updatedAt: Number(r.updated_at),
      readable: available && decryptSecret(userId, r.kind as CredentialKind, r.ciphertext) !== null,
    }));
}

/** Whether a token is saved for this person and kind, and whether it still decrypts. */
export function userSecretState(
  userId: string,
  kind: CredentialKind
): { state: "none" } | { state: "readable"; token: string } | { state: "unreadable" } {
  const row = accountsDb()
    .prepare("SELECT ciphertext FROM user_secrets WHERE user_id = ? AND kind = ?")
    .get(userId, kind) as { ciphertext: string } | undefined;
  if (!row) return { state: "none" };
  const token = decryptSecret(userId, kind, row.ciphertext);
  return token === null ? { state: "unreadable" } : { state: "readable", token };
}

/** The saved token for this person and kind, or null (none saved, or it no longer decrypts). */
export function getUserSecret(userId: string, kind: CredentialKind): string | null {
  const row = accountsDb()
    .prepare("SELECT ciphertext FROM user_secrets WHERE user_id = ? AND kind = ?")
    .get(userId, kind) as { ciphertext: string } | undefined;
  if (!row) return null;
  try {
    return decryptSecret(userId, kind, row.ciphertext);
  } catch {
    return null;
  }
}
