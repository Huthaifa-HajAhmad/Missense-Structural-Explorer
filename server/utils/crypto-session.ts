import crypto from "crypto";

export interface SessionPayload {
  apiKey: string;
  expiresAt: number;
}

const pbkdf2KeyCache = new Map<string, Buffer>();

/**
 * NOTE: The PBKDF2 salt is deterministic (derived from the secret key) to allow caching
 * the resulting stretched key. If we used a random salt per session token, we could
 * not cache the key and would need to execute 100,000 PBKDF2 iterations on every single
 * incoming request, resulting in severe CPU overhead and susceptibility to Denial of Service (DoS).
 */
export function getDerivedSessionKey(secret: string): Buffer {
  let key = pbkdf2KeyCache.get(secret);
  if (!key) {
    const salt = crypto.createHmac("sha256", secret).update("missense-resolve-pbkdf2-salt").digest();
    key = crypto.pbkdf2Sync(secret, salt, 100000, 32, "sha256");
    pbkdf2KeyCache.set(secret, key);
  }
  return key;
}

/**
 * Encrypts a session payload into a stateless AES-256-GCM token.
 * Output format: "ivBase64:ciphertextBase64:tagBase64"
 */
export function encryptSession(payload: SessionPayload, secret: string): string {
  const key = getDerivedSessionKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${ciphertext.toString("base64")}:${tag.toString("base64")}`;
}

/**
 * Decrypts a stateless AES-256-GCM session token back into its payload.
 * Returns undefined if decryption or validation fails.
 */
export function decryptSession(token: string, secret: string): SessionPayload | undefined {
  try {
    const parts = token.split(":");
    if (parts.length !== 3) return undefined;
    const [ivB64, ciphertextB64, tagB64] = parts;

    const key = getDerivedSessionKey(secret);
    const iv = Buffer.from(ivB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const tag = Buffer.from(tagB64, "base64");

    if (iv.length !== 12 || tag.length !== 16) {
      return undefined;
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  } catch (_) {
    return undefined;
  }
}

export function getApiKeyFromSession(sessionId: string): string | undefined {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    throw new Error("APP_SESSION_SECRET is not configured in the environment.");
  }
  const payload = decryptSession(sessionId, secret);
  if (!payload) return undefined;
  if (Date.now() > payload.expiresAt) {
    return undefined;
  }
  return payload.apiKey;
}
