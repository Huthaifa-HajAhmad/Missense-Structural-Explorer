import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { apiRouter } from "../routes.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { closeAccountsDb, createUser, getUserCredentials, updateUser } from "../auth/store.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { authEnvironmentProblems } from "../auth/config.ts";

/**
 * WP-A acceptance (doc/COMPUTE_ROUTING_PLAN.md section 7): the password provider end to end, the
 * first-admin setup, throttling, AUTH_MODE gating, CSRF and the agent path, over real HTTP.
 */

const SETUP_SECRET = "setup-secret-for-tests-0123456789";
const API_TOKEN = "test-token-fixed-length-32-chars-ok!";
const PASSWORD = "correct horse battery";

let server: Server;
let base: string;
/** The only variables this suite changes; restored key by key rather than by swapping process.env. */
const MUTATED_ENV = ["AUTH_MODE", "AUTH_PROVIDER", "ADMIN_SETUP_SECRET", "SESSION_IDLE_HOURS", "SESSION_TTL_DAYS"] as const;
let savedEnv: Partial<Record<(typeof MUTATED_ENV)[number], string | undefined>>;

beforeAll(async () => {
  process.env.APP_API_TOKEN = API_TOKEN;
  process.env.APP_SESSION_SECRET = "test-session-secret-fixed-32-chars!";
  const app = express();
  // As in production behind Caddy: Express takes the LAST X-Forwarded-For entry.
  app.set("trust proxy", 1);
  app.use(requestLogger);
  app.use(validateContentType);
  app.use("/api/v1", apiRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  savedEnv = Object.fromEntries(MUTATED_ENV.map((k) => [k, process.env[k]]));
  closeAccountsDb(); // a fresh, empty in-memory workspace per test
  delete process.env.AUTH_MODE;
  delete process.env.ADMIN_SETUP_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of MUTATED_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

interface Call {
  status: number;
  body: any;
  cookie: string | null;
}

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string | null; headers?: Record<string, string> } = {}): Promise<Call> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const set = res.headers.getSetCookie().find((c) => c.startsWith("mse_session="));
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, cookie: set ? set.split(";")[0] : null };
}

async function seedUser(email: string, role: "admin" | "member" = "member") {
  return createUser({ email, displayName: email.split("@")[0], passwordHash: await hashPassword(PASSWORD), role, now: Date.now() });
}

async function signIn(email: string, password = PASSWORD): Promise<string> {
  const r = await call("POST", "/auth/login", { body: { email, password } });
  expect(r.status).toBe(200);
  expect(r.cookie).toBeTruthy();
  return r.cookie as string;
}

describe("first admin through /setup", () => {
  it("does not exist without ADMIN_SETUP_SECRET", async () => {
    expect((await call("GET", "/setup")).status).toBe(404);
  });

  it("creates exactly one admin with the right secret, then disappears for good", async () => {
    process.env.ADMIN_SETUP_SECRET = SETUP_SECRET;
    expect((await call("GET", "/setup")).body).toEqual({ needed: true });

    const wrong = await call("POST", "/setup", { body: { secret: "nope", email: "owner@lab.org", displayName: "Owner", password: PASSWORD } });
    expect(wrong.status).toBe(401);

    const ok = await call("POST", "/setup", { body: { secret: SETUP_SECRET, email: "Owner@Lab.org", displayName: "Owner", password: PASSWORD } });
    expect(ok.status).toBe(201);
    expect(ok.body.user).toMatchObject({ email: "owner@lab.org", role: "admin" });
    expect(ok.body.user.passwordHash).toBeUndefined();
    expect(ok.cookie).toBeTruthy();

    expect((await call("GET", "/setup")).status).toBe(404);
    const again = await call("POST", "/setup", { body: { secret: SETUP_SECRET, email: "x@lab.org", displayName: "X", password: PASSWORD } });
    expect(again.status).toBe(404);
  });

  it("throttles a guessed secret", async () => {
    process.env.ADMIN_SETUP_SECRET = SETUP_SECRET;
    for (let i = 0; i < 5; i++) {
      await call("POST", "/setup", { body: { secret: `guess-${i}`, email: "o@lab.org", displayName: "O", password: PASSWORD } });
    }
    const locked = await call("POST", "/setup", { body: { secret: SETUP_SECRET, email: "o@lab.org", displayName: "O", password: PASSWORD } });
    expect(locked.status).toBe(429);
  });
});

describe("invite → accept → sign in → me → sign out", () => {
  it("round-trips, and the invite works once", async () => {
    await seedUser("admin@lab.org", "admin");
    const admin = await signIn("admin@lab.org");

    const invite = await call("POST", "/admin/invites", { cookie: admin, body: { email: "new@lab.org" } });
    expect(invite.status).toBe(201);
    expect(invite.body.inviteUrl).toMatch(/\/#invite=[A-Za-z0-9_-]{43}$/);
    const token = invite.body.inviteUrl.split("#invite=")[1];

    expect((await call("POST", "/auth/invite-info", { body: { token } })).body).toEqual({ email: "new@lab.org", role: "member" });

    const short = await call("POST", "/auth/accept-invite", { body: { token, password: "short", displayName: "New" } });
    expect(short.status).toBe(400);
    expect(short.body.error.message).toMatch(/at least 12/);

    const accepted = await call("POST", "/auth/accept-invite", { body: { token, password: PASSWORD, displayName: "New Person" } });
    expect(accepted.status).toBe(201);
    expect(accepted.body.user).toMatchObject({ email: "new@lab.org", displayName: "New Person", role: "member" });
    expect((await call("POST", "/auth/accept-invite", { body: { token, password: PASSWORD, displayName: "Again" } })).status).toBe(404);

    const cookie = await signIn("new@lab.org");
    const me = await call("GET", "/auth/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { email: "new@lab.org" }, mode: "legacy", quota: { queuedPerUser: 25, serverSecondsPerDay: null } });

    expect((await call("POST", "/auth/logout", { cookie, body: {} })).status).toBe(204);
    expect((await call("GET", "/auth/me", { cookie })).status).toBe(401);
  });

  it("refuses an invite for an existing account without burning it", async () => {
    await seedUser("admin@lab.org", "admin");
    const admin = await signIn("admin@lab.org");
    expect((await call("POST", "/admin/invites", { cookie: admin, body: { email: "admin@lab.org" } })).status).toBe(409);
  });
});

describe("sign-in protection", () => {
  it("an unknown email is indistinguishable from a wrong password", async () => {
    await seedUser("real@lab.org");
    const wrong = await call("POST", "/auth/login", { body: { email: "real@lab.org", password: "wrong password!!" } });
    const unknown = await call("POST", "/auth/login", { body: { email: "ghost@lab.org", password: "wrong password!!" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it("locks an account after 5 failures, even for the right password", async () => {
    await seedUser("real@lab.org");
    for (let i = 0; i < 5; i++) await call("POST", "/auth/login", { body: { email: "real@lab.org", password: `wrong-password-${i}` } });
    const locked = await call("POST", "/auth/login", { body: { email: "real@lab.org", password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toMatch(/Try again in 15 minutes/);
  }, 20_000);

  it("a forged X-Forwarded-For cannot dodge the address limit", async () => {
    // Caddy appends the real address last; the attacker controls only the entries before it.
    for (let i = 0; i < 20; i++) {
      await call("POST", "/auth/login", {
        body: { email: `target${i}@lab.org`, password: "guess-guess-guess" },
        headers: { "x-forwarded-for": `10.0.0.${i}, 203.0.113.7` },
      });
    }
    const next = await call("POST", "/auth/login", {
      body: { email: "fresh@lab.org", password: "guess-guess-guess" },
      headers: { "x-forwarded-for": "198.51.100.99, 203.0.113.7" },
    });
    expect(next.status).toBe(429);
  }, 30_000);

  it("never logs a password", async () => {
    await seedUser("real@lab.org");
    const log = vi.spyOn(console, "log");
    const secret = "do-not-log-this-password";
    await call("POST", "/auth/login", { body: { email: "real@lab.org", password: secret } });
    await signIn("real@lab.org");
    const printed = log.mock.calls.flat().join(" ");
    log.mockRestore();
    expect(printed).not.toContain(secret);
    expect(printed).not.toContain(PASSWORD);
  });
});

describe("admin controls", () => {
  it("a disabled user's cookie stops working on the next request", async () => {
    await seedUser("admin@lab.org", "admin");
    const member = await seedUser("m@lab.org");
    const admin = await signIn("admin@lab.org");
    const cookie = await signIn("m@lab.org");
    expect((await call("GET", "/auth/me", { cookie })).status).toBe(200);
    expect((await call("PATCH", `/admin/users/${member.id}`, { cookie: admin, body: { status: "disabled" } })).status).toBe(200);
    expect((await call("GET", "/auth/me", { cookie })).status).toBe(401);
    expect((await call("POST", "/auth/login", { body: { email: "m@lab.org", password: PASSWORD } })).status).toBe(401);
  });

  it("a reset link works once and signs out the user's other sessions", async () => {
    await seedUser("admin@lab.org", "admin");
    const member = await seedUser("m@lab.org");
    const admin = await signIn("admin@lab.org");
    const oldSession = await signIn("m@lab.org");

    const link = await call("POST", `/admin/users/${member.id}/reset-link`, { cookie: admin, body: {} });
    expect(link.status).toBe(201);
    const token = link.body.resetUrl.split("#reset=")[1];

    const reset = await call("POST", "/auth/reset", { body: { token, password: "a brand new password" } });
    expect(reset.status).toBe(200);
    expect(reset.cookie).toBeTruthy();
    expect((await call("GET", "/auth/me", { cookie: oldSession })).status).toBe(401);
    expect((await call("POST", "/auth/reset", { body: { token, password: "another new password" } })).status).toBe(404);
    expect((await call("POST", "/auth/login", { body: { email: "m@lab.org", password: "a brand new password" } })).status).toBe(200);
  });

  it("an expired reset link is refused", async () => {
    await seedUser("admin@lab.org", "admin");
    const member = await seedUser("m@lab.org");
    const admin = await signIn("admin@lab.org");
    const link = await call("POST", `/admin/users/${member.id}/reset-link`, { cookie: admin, body: {} });
    const token = link.body.resetUrl.split("#reset=")[1];
    vi.useFakeTimers({ now: Date.now() + 24 * 60 * 60 * 1000 + 1000, toFake: ["Date"] });
    try {
      expect((await call("POST", "/auth/reset", { body: { token, password: "a brand new password" } })).status).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the last active admin cannot be demoted or disabled", async () => {
    const owner = await seedUser("admin@lab.org", "admin");
    const admin = await signIn("admin@lab.org");
    const r = await call("PATCH", `/admin/users/${owner.id}`, { cookie: admin, body: { role: "member" } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("LAST_ADMIN");
  });

  it("a member cannot use admin routes; a signed-out visitor is told to sign in", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    expect((await call("GET", "/admin/users", { cookie })).status).toBe(403);
    expect((await call("GET", "/admin/users")).status).toBe(401);
  });

  it("preferences round-trip and reject unknown fields", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    expect((await call("PUT", "/me/preferences", { cookie, body: { placementPref: "my_machine", shareResults: false } })).body).toEqual({
      placementPref: "my_machine",
      shareResults: false,
    });
    expect((await call("PUT", "/me/preferences", { cookie, body: { role: "admin" } })).status).toBe(400);
    expect(getUserCredentials("m@lab.org")?.user.role).toBe("member");
  });
});

describe("AUTH_MODE gating", () => {
  // A cheap write behind the shared-token layer today: it answers 400 for an empty body once past auth.
  const WRITE = "/session/refresh";

  it("legacy (default): behaviour is unchanged", async () => {
    expect((await call("POST", WRITE, { body: {} })).status).toBe(400);
    expect((await call("GET", "/health")).status).not.toBe(401);
  });

  it("hybrid: a write needs a user or the legacy token", async () => {
    process.env.AUTH_MODE = "hybrid";
    expect((await call("POST", WRITE, { body: {} })).body.error.code).toBe("SIGN_IN_REQUIRED");
    expect((await call("POST", WRITE, { body: {}, headers: { authorization: `Bearer ${API_TOKEN}` } })).status).toBe(400);
  });

  it("accounts: anonymous and legacy-token writes are refused; reads and health still work", async () => {
    process.env.AUTH_MODE = "accounts";
    await seedUser("m@lab.org");
    expect((await call("POST", WRITE, { body: {} })).status).toBe(401);
    expect((await call("POST", "/generate-mutant", { body: {} })).body.error.code).toBe("SIGN_IN_REQUIRED");
    expect((await call("POST", WRITE, { body: {}, headers: { authorization: `Bearer ${API_TOKEN}` } })).status).toBe(401);
    expect((await call("GET", "/health")).status).not.toBe(401);
    const cookie = await signIn("m@lab.org");
    expect((await call("POST", WRITE, { body: {}, cookie })).status).toBe(400);
  });

  it("a cookie-authenticated write from another site is refused", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    const r = await call("POST", WRITE, { body: {}, cookie, headers: { origin: "https://evil.duckdns.org" } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("CROSS_SITE_REQUEST");
  });

  it("/agent/* accepts only an agent token: a user cookie is neither required nor sufficient", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    expect((await call("POST", "/agent/claim", { body: {}, cookie })).body.error.code).toBe("AGENT_TOKEN_REQUIRED");
    expect((await call("POST", "/agent/claim", { body: {}, headers: { authorization: `Bearer ${API_TOKEN}` } })).status).toBe(401);
  });
});

describe("what the browser reads at start-up, and pending invites", () => {
  it("/auth/session never 401s: it reports the mode, setup availability and who is signed in", async () => {
    process.env.ADMIN_SETUP_SECRET = SETUP_SECRET;
    process.env.AUTH_MODE = "accounts";
    expect((await call("GET", "/auth/session")).body).toEqual({ mode: "accounts", provider: "password", user: null, setupAvailable: true, accountsExist: false });
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    const s = await call("GET", "/auth/session", { cookie });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ setupAvailable: false, accountsExist: true, user: { email: "m@lab.org" } });
  });

  it("accepting an invite counts as signing in", async () => {
    await seedUser("admin@lab.org", "admin");
    const admin = await signIn("admin@lab.org");
    const token = (await call("POST", "/admin/invites", { cookie: admin, body: { email: "n@lab.org" } })).body.inviteUrl.split("#invite=")[1];
    const accepted = await call("POST", "/auth/accept-invite", { body: { token, password: PASSWORD, displayName: "N" } });
    expect(accepted.body.user.lastLoginAt).toEqual(expect.any(Number));
  });

  it("lists pending invites, replaces an older one for the same address, and withdraws", async () => {
    await seedUser("admin@lab.org", "admin");
    const admin = await signIn("admin@lab.org");
    const first = (await call("POST", "/admin/invites", { cookie: admin, body: { email: "p@lab.org" } })).body.inviteUrl.split("#invite=")[1];
    await call("POST", "/admin/invites", { cookie: admin, body: { email: "p@lab.org", role: "admin" } });
    const list = await call("GET", "/admin/invites", { cookie: admin });
    expect(list.body.invites).toHaveLength(1);
    expect(list.body.invites[0]).toMatchObject({ email: "p@lab.org", role: "admin" });
    // Only the newest link works.
    expect((await call("POST", "/auth/invite-info", { body: { token: first } })).status).toBe(404);
    expect((await call("DELETE", `/admin/invites/${list.body.invites[0].id}`, { cookie: admin })).status).toBe(204);
    expect((await call("GET", "/admin/invites", { cookie: admin })).body.invites).toEqual([]);
    expect((await call("DELETE", `/admin/invites/${list.body.invites[0].id}`, { cookie: admin })).status).toBe(404);
  });
});

describe("sessions end when they should", () => {

  it("an idle session ends after SESSION_IDLE_HOURS, an active one does not", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    const start = Date.now();
    vi.useFakeTimers({ now: start + 23 * 3_600_000, toFake: ["Date"] });
    expect((await call("GET", "/auth/me", { cookie })).status).toBe(200); // also refreshes last_seen
    vi.useFakeTimers({ now: start + 23 * 3_600_000 + 25 * 3_600_000, toFake: ["Date"] });
    expect((await call("GET", "/auth/me", { cookie })).status).toBe(401);
  });

  it("a session ends after SESSION_TTL_DAYS even when used every day", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    const start = Date.now();
    // Used every 12 hours: never idle, so only the 14-day absolute limit can end it.
    for (let half = 1; half <= 27; half++) {
      vi.useFakeTimers({ now: start + half * 43_200_000, toFake: ["Date"] });
      expect((await call("GET", "/auth/me", { cookie })).status).toBe(200);
    }
    vi.useFakeTimers({ now: start + 14 * 86_400_000 + 60_000, toFake: ["Date"] });
    expect((await call("GET", "/auth/me", { cookie })).status).toBe(401);
  }, 20_000);

  it("a disabled account's session stops working even if its row was not deleted", async () => {
    const member = await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    updateUser(member.id, { status: "disabled" }); // store-level: sessions left in place on purpose
    expect((await call("GET", "/auth/me", { cookie })).status).toBe(401);
  });

});

describe("change password", () => {
  it("keeps this browser signed in, signs out the others, and refuses a wrong or weak password", async () => {
    await seedUser("m@lab.org");
    const here = await signIn("m@lab.org");
    const elsewhere = await signIn("m@lab.org");
    expect((await call("POST", "/auth/change-password", { cookie: here, body: { current: "wrong password!!", next: "a new long password" } })).status).toBe(401);
    expect((await call("POST", "/auth/change-password", { cookie: here, body: { current: PASSWORD, next: "short" } })).status).toBe(400);
    expect((await call("POST", "/auth/change-password", { cookie: here, body: { current: PASSWORD, next: "a new long password" } })).status).toBe(204);
    expect((await call("GET", "/auth/me", { cookie: here })).status).toBe(200);
    expect((await call("GET", "/auth/me", { cookie: elsewhere })).status).toBe(401);
    expect((await call("POST", "/auth/login", { body: { email: "m@lab.org", password: "a new long password" } })).status).toBe(200);
  });

  it("throttles guesses at the current password, like sign-in", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    for (let i = 0; i < 5; i++) {
      await call("POST", "/auth/change-password", { cookie, body: { current: `guess-number-${i}`, next: "a new long password" } });
    }
    const locked = await call("POST", "/auth/change-password", { cookie, body: { current: PASSWORD, next: "a new long password" } });
    expect(locked.status).toBe(429);
  }, 20_000);
});

describe("fixes from review", () => {
  it("a stored hash that is damaged never verifies (fail closed)", async () => {
    for (const bad of ["scrypt$32768$8$1$c2FsdA==$", "scrypt$32768$8$1$c2FsdA==$!!!!", "scrypt$0$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA", "", "bcrypt$x"]) {
      expect(await verifyPassword("literally anything", bad)).toBe(false);
    }
    expect(await verifyPassword(PASSWORD, await hashPassword(PASSWORD))).toBe(true);
  });

  it("a reset link lifts a sign-in lockout", async () => {
    await seedUser("admin@lab.org", "admin");
    const member = await seedUser("m@lab.org");
    const admin = await signIn("admin@lab.org");
    for (let i = 0; i < 5; i++) await call("POST", "/auth/login", { body: { email: "m@lab.org", password: `wrong-password-${i}` } });
    expect((await call("POST", "/auth/login", { body: { email: "m@lab.org", password: PASSWORD } })).status).toBe(429);
    const token = (await call("POST", `/admin/users/${member.id}/reset-link`, { cookie: admin, body: {} })).body.resetUrl.split("#reset=")[1];
    expect((await call("POST", "/auth/reset", { body: { token, password: "a brand new password" } })).status).toBe(200);
    expect((await call("POST", "/auth/login", { body: { email: "m@lab.org", password: "a brand new password" } })).status).toBe(200);
  }, 20_000);

  it("path case does not loosen the agent rule: /Agent/claim is agent-only too", async () => {
    process.env.AUTH_MODE = "accounts";
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    expect((await call("POST", "/Agent/claim", { body: {}, cookie })).body.error.code).toBe("AGENT_TOKEN_REQUIRED");
    expect((await call("POST", "/AGENT/claim", { body: {}, headers: { authorization: `Bearer ${API_TOKEN}` } })).body.error.code).toBe("AGENT_TOKEN_REQUIRED");
  });

  it("pairing (/agent/pair) is a signed-in person's request, not an agent's", async () => {
    await seedUser("m@lab.org");
    const cookie = await signIn("m@lab.org");
    // The agent-only rule lets the signed-in person through, and the route hands them a pairing code.
    expect((await call("POST", "/agent/pair", { body: {}, cookie })).status).toBe(201);
  });
});

describe("startup validation", () => {
  it("refuses an unknown mode and the unbuilt Cloudflare provider", () => {
    process.env.AUTH_MODE = "open";
    process.env.AUTH_PROVIDER = "cloudflare-access";
    const problems = authEnvironmentProblems();
    expect(problems.some((p) => p.includes("AUTH_MODE"))).toBe(true);
    expect(problems.some((p) => p.includes("not implemented"))).toBe(true);
    process.env.AUTH_MODE = "legacy";
    process.env.AUTH_PROVIDER = "password";
    expect(authEnvironmentProblems()).toEqual([]);
  });
});
