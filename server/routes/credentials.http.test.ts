/**
 * WP-I4 / I4b over real HTTP: saving a provider token to the account, using it from a request that brings
 * none, reporting whose token a call used, and never echoing a token back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { apiRouter } from "../routes.ts";
import { jsonErrorHandler } from "../express-config.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { accountsDb, closeAccountsDb, createUser } from "../auth/store.ts";
import { hashPassword } from "../auth/password.ts";
import { decryptSecret, encryptSecret, getUserSecret, saveUserSecret } from "../auth/user-secrets.ts";
import { resetCredentialsForTests } from "../services/infra/credentials.ts";
import { CREDENTIALS_HEADER, parseCredentialUse } from "../../src/shared/credentials.ts";

const PASSWORD = "correct horse battery";
const OWN_HF = "hf_own_token_for_tests_123456";
const TEAM_HF = "hf_team_token_for_tests_9876";
const ENV = ["AUTH_MODE", "APP_SESSION_SECRET", "APP_API_TOKEN", "HF_TOKEN", "SHARED_TOKEN_FALLBACK"] as const;
let saved: Record<string, string | undefined>;
let server: Server;
let base: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(requestLogger);
  app.use(validateContentType);
  app.use("/api/v1", apiRouter);
  app.use(jsonErrorHandler);
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]));
  process.env.AUTH_MODE = "accounts";
  process.env.APP_SESSION_SECRET = "test-session-secret-fixed-32-chars!";
  process.env.APP_API_TOKEN = "test-token-fixed-length-32-chars-ok!";
  process.env.HF_TOKEN = TEAM_HF;
  delete process.env.SHARED_TOKEN_FALLBACK;
  closeAccountsDb();
  resetCredentialsForTests();
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await realFetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const cookie = res.headers.getSetCookie().find(c => c.startsWith("mse_session="))?.split(";")[0] ?? null;
  return { status: res.status, body, text, cookie, headers: res.headers };
}

async function signedIn(): Promise<{ cookie: string; userId: string }> {
  const email = `p${Math.random().toString(36).slice(2)}@lab.org`;
  const user = createUser({ email, displayName: "P", passwordHash: await hashPassword(PASSWORD), role: "member", now: Date.now() });
  const r = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  expect(r.status).toBe(200);
  return { cookie: r.cookie as string, userId: user.id };
}

/** Intercepts calls to Hugging Face only; the test's own calls to the local server go through. */
function stubHuggingFace() {
  const seen: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("huggingface.co")) {
      seen.push(String(new Headers(init?.headers).get("authorization")));
      return new Response(JSON.stringify({ name: "someone", type: "user" }), { status: 200 });
    }
    return realFetch(input, init);
  });
  return seen;
}

describe("/me/secrets", () => {
  it("saves, lists without the token, and removes", async () => {
    const { cookie } = await signedIn();
    const put = await call("PUT", "/me/secrets/huggingface", { cookie, body: { token: OWN_HF } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ kind: "huggingface", hint: OWN_HF.slice(-4), readable: true });
    expect(put.text).not.toContain(OWN_HF);

    const list = await call("GET", "/me/secrets", { cookie });
    expect(list.body.available).toBe(true);
    expect(list.body.secrets).toEqual([expect.objectContaining({ kind: "huggingface", hint: OWN_HF.slice(-4), readable: true })]);
    expect(list.text).not.toContain(OWN_HF);
    expect(list.headers.get("cache-control")).toBe("no-store");

    expect((await call("DELETE", "/me/secrets/huggingface", { cookie })).status).toBe(204);
    expect((await call("DELETE", "/me/secrets/huggingface", { cookie })).status).toBe(404);
  });

  it("refuses an unknown kind, a bad token, and a caller who is not signed in", async () => {
    const { cookie } = await signedIn();
    expect((await call("PUT", "/me/secrets/openai", { cookie, body: { token: OWN_HF } })).status).toBe(400);
    expect((await call("PUT", "/me/secrets/huggingface", { cookie, body: { token: "short" } })).status).toBe(400);
    expect((await call("PUT", "/me/secrets/huggingface", { cookie, body: { token: "has a space inside it" } })).status).toBe(400);
    expect((await call("GET", "/me/secrets")).status).toBe(401);
  });

  it("drops the raw body and never logs a token on malformed JSON", async () => {
    const { cookie } = await signedIn();
    const errors: any[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => void errors.push(args));
    const token = "hf_MALFORMED_LEAK_TEST_TOKEN";
    const res = await realFetch(`${base}/me/secrets/huggingface`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: `{"token": "${token}"`
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe("Request body is not valid JSON.");
    expect(JSON.stringify(errors)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(token);
    spy.mockRestore();
  });

  it("answers 503 when the server cannot encrypt", async () => {
    const { cookie } = await signedIn();
    delete process.env.APP_SESSION_SECRET;
    const r = await call("PUT", "/me/secrets/huggingface", { cookie, body: { token: OWN_HF } });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("SECRETS_UNAVAILABLE");
  });
});

describe("a saved token is used by the person's requests", () => {
  it("Test connection uses the saved token, reports 'own', and never the team token", async () => {
    const { cookie, userId } = await signedIn();
    const seen = stubHuggingFace();

    // Nothing saved, nothing sent: the team token is not tested on the person's behalf.
    const none = await call("POST", "/test-hf-connection", { cookie, body: {} });
    expect(none.body).toMatchObject({ valid: false });
    expect(seen).toEqual([]);

    saveUserSecret(userId, "huggingface", OWN_HF);
    const r = await call("POST", "/test-hf-connection", { cookie, body: {} });
    expect(r.body).toMatchObject({ valid: true });
    expect(seen).toEqual([`Bearer ${OWN_HF}`]);
    expect(parseCredentialUse(r.headers.get(CREDENTIALS_HEADER))).toEqual([{ kind: "huggingface", source: "own" }]);
  });
});

describe("encryption", () => {
  it("binds a ciphertext to its person and kind", () => {
    process.env.APP_SESSION_SECRET = "test-session-secret-fixed-32-chars!";
    const blob = encryptSecret("user-a", "biohub", OWN_HF);
    expect(blob).not.toContain(OWN_HF);
    expect(decryptSecret("user-a", "biohub", blob)).toBe(OWN_HF);
    expect(decryptSecret("user-b", "biohub", blob)).toBeNull();
    expect(decryptSecret("user-a", "tamarind", blob)).toBeNull();
    // One flipped ciphertext character fails authentication.
    const [v, iv, ct, tag] = blob.split(":");
    const flipped = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
    expect(decryptSecret("user-a", "biohub", [v, iv, flipped, tag].join(":"))).toBeNull();
  });

  it("stores only ciphertext, and a rotated server secret reads as unreadable rather than wrong", () => {
    const id = createUser({ email: "rot@lab.org", displayName: "R", passwordHash: null, role: "member", now: Date.now() }).id;
    saveUserSecret(id, "biohub", OWN_HF);
    const row = accountsDb().prepare("SELECT * FROM user_secrets").get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(OWN_HF);
    process.env.APP_SESSION_SECRET = "a-different-secret-after-rotation-32!";
    expect(getUserSecret(id, "biohub")).toBeNull();
  });
});
