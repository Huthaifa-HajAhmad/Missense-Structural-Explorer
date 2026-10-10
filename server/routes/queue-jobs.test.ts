import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { apiRouter } from "../routes.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { closeAccountsDb, createUser } from "../auth/store.ts";
import { hashPassword } from "../auth/password.ts";
import { BiophysicalJobQueue } from "../services/infra/biophysical-queue.ts";

/**
 * WP-B over HTTP: `GET /my-jobs` and `POST /jobs/:id/cancel`. Who may cancel what is a security
 * rule, so it is asserted through the real router and the real session cookie, not the queue alone.
 */

const API_TOKEN = "test-token-fixed-length-32-chars-ok!";
const PASSWORD = "correct horse battery";

let server: Server;
let base: string;
let savedMode: string | undefined;

beforeAll(async () => {
  process.env.APP_API_TOKEN = API_TOKEN;
  process.env.APP_SESSION_SECRET = "test-session-secret-fixed-32-chars!";
  const app = express();
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
  savedMode = process.env.AUTH_MODE;
  delete process.env.AUTH_MODE;
  closeAccountsDb();
  BiophysicalJobQueue.resetForTesting();
});

afterEach(() => {
  BiophysicalJobQueue.resetForTesting();
  if (savedMode === undefined) delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = savedMode;
});

async function call(method: string, path: string, opts: { cookie?: string; token?: boolean; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  // The API refuses a POST without a JSON content type, exactly as it does for the browser client.
  const payload = opts.body === undefined && method === "POST" ? {} : opts.body;
  if (payload !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.token) headers.authorization = `Bearer ${API_TOKEN}`;
  const res = await fetch(`${base}${path}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, cookie: res.headers.getSetCookie().find((c) => c.startsWith("mse_session="))?.split(";")[0] ?? null };
}

async function person(email: string, role: "admin" | "member" = "member") {
  const user = await createUser({ email, displayName: email.split("@")[0], passwordHash: await hashPassword(PASSWORD), role, now: Date.now() });
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  expect(login.status).toBe(200);
  return { id: user.id, cookie: login.cookie as string };
}

/** A queue whose jobs never finish, so they stay observable as queued/running. */
function stuckQueue(concurrency = 1) {
  return BiophysicalJobQueue.initialize(concurrency, () => new Promise(() => {}));
}

describe("POST /jobs/:id/cancel", () => {
  it("is 403 for someone who neither owns nor joined the job, and the job keeps going", async () => {
    const queue = stuckQueue();
    const owner = await person("owner@lab.org");
    const other = await person("other@lab.org");
    const id = await queue.pushJob("foldx", { name: "j", mutation: "R175H" }, { ownerId: owner.id });

    const denied = await call("POST", `/jobs/${id}/cancel`, { cookie: other.cookie });
    expect(denied.status).toBe(403);
    expect((await queue.getJobStatus(id))?.status).not.toBe("failed");
  });

  it("with a second watcher the owner's cancel withdraws only their interest", async () => {
    const queue = stuckQueue();
    const owner = await person("owner@lab.org");
    const joiner = await person("joiner@lab.org");
    const id = await queue.pushJob("foldx", { name: "j" }, { ownerId: owner.id });
    queue.addWatcher(id, joiner.id);

    const first = await call("POST", `/jobs/${id}/cancel`, { cookie: owner.cookie });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ cancelled: false, stillRunningForOthers: true, remainingWatchers: 1 });
    expect((await queue.getJobStatus(id))?.status).not.toBe("failed");

    const last = await call("POST", `/jobs/${id}/cancel`, { cookie: joiner.cookie });
    expect(last.body).toMatchObject({ cancelled: true });
    expect((await queue.getJobStatus(id))?.status).toBe("failed");
  });

  it("an admin stops any job; an unknown job is 404; a finished one is 409", async () => {
    const queue = stuckQueue();
    const owner = await person("owner@lab.org");
    const admin = await person("admin@lab.org", "admin");
    const id = await queue.pushJob("foldx", { name: "j" }, { ownerId: owner.id });
    expect((await call("POST", `/jobs/${id}/cancel`, { cookie: admin.cookie })).body).toMatchObject({ cancelled: true });

    expect((await call("POST", "/jobs/not-a-job/cancel", { cookie: admin.cookie })).status).toBe(404);
    expect((await call("POST", `/jobs/${id}/cancel`, { cookie: admin.cookie })).status).toBe(409);
  });

  it("without accounts, the shared token may cancel unowned jobs but not a person's", async () => {
    const queue = stuckQueue();
    const owner = await person("owner@lab.org");
    const legacy = await queue.pushJob("foldx", { name: "old" });
    const theirs = await queue.pushJob("foldx", { name: "mine" }, { ownerId: owner.id });

    expect((await call("POST", `/jobs/${theirs}/cancel`, { token: true })).status).toBe(403);
    expect((await call("POST", `/jobs/${legacy}/cancel`, { token: true })).body).toMatchObject({ cancelled: true });
  });
});

describe("GET /my-jobs", () => {
  it("needs an account, and lists only that person's jobs with their place in the queue", async () => {
    const queue = stuckQueue();
    const a = await person("a@lab.org");
    const b = await person("b@lab.org");
    await queue.pushJob("foldx", { name: "a1", mutation: "R175H" }, { ownerId: a.id });
    await queue.pushJob("foldx", { name: "b1", mutation: "G12D" }, { ownerId: b.id });
    await new Promise((r) => setTimeout(r, 120));

    expect((await call("GET", "/my-jobs")).status).toBe(401);

    const mine = await call("GET", "/my-jobs", { cookie: b.cookie });
    expect(mine.status).toBe(200);
    expect(mine.body.jobs).toHaveLength(1);
    expect(mine.body.jobs[0]).toMatchObject({ label: "G12D", mine: true, status: "queued", queuedAhead: 1 });
  });
});

describe("disabling an account", () => {
  it("cancels that person's queued and running jobs, but not work someone else is also waiting on", async () => {
    const queue = stuckQueue();
    const admin = await person("admin@lab.org", "admin");
    const leaver = await person("leaver@lab.org");
    const stayer = await person("stayer@lab.org");
    const solo = await queue.pushJob("foldx", { name: "solo" }, { ownerId: leaver.id });
    const shared = await queue.pushJob("foldx", { name: "shared" }, { ownerId: leaver.id });
    queue.addWatcher(shared, stayer.id);

    const res = await call("PATCH", `/admin/users/${leaver.id}`, { cookie: admin.cookie, body: { status: "disabled" } });
    expect(res.status).toBe(200);
    expect(res.body.jobsCancelled).toBe(1);
    expect((await queue.getJobStatus(solo))?.status).toBe("failed");
    expect((await queue.getJobStatus(shared))?.status).not.toBe("failed");
  });
});

describe("/auth/me usage", () => {
  it("reports server seconds used, now that jobs have owners", async () => {
    stuckQueue();
    const me = await person("me@lab.org");
    const res = await call("GET", "/auth/me", { cookie: me.cookie });
    expect(res.status).toBe(200);
    expect(res.body.usage).toEqual({ todaySeconds: 0, weekSeconds: 0 });
    expect(res.body.quota).toMatchObject({ queuedPerUser: 25, serverSecondsPerDay: null });
  });
});
