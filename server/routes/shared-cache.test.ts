import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { apiRouter } from "../routes.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { closeAccountsDb, createUser } from "../auth/store.ts";
import { hashPassword } from "../auth/password.ts";
import { BiophysicalJobQueue } from "../services/infra/biophysical-queue.ts";
import { pocketJobRegistry } from "../services/infra/foldx-job-registry.ts";
import { pocketCache, pocketResultCacheKey } from "../services/structure/pocket/runner.ts";
import { getFoldxCacheKey, getMutantFromCache, mutantCache, writeMutantToCache } from "../services/stability/foldx/cache.ts";
import { mayServe, mayServeToOthers, type ComputeProvenance } from "../../src/shared/computeProvenance.ts";

/**
 * WP-E acceptance (doc/COMPUTE_ROUTING_PLAN.md): two people asking for the same run share one job and
 * both get it; one person's cancel leaves the other's run going; a result from someone's own computer
 * that they chose not to share is not served to anyone else.
 */

const API_TOKEN = "test-token-fixed-length-32-chars-ok!";
const PASSWORD = "correct horse battery";

let server: Server;
let base: string;
let savedCacheDir: string | undefined;

beforeAll(async () => {
  process.env.APP_API_TOKEN = API_TOKEN;
  process.env.APP_SESSION_SECRET = "test-session-secret-fixed-32-chars!";
  savedCacheDir = process.env.FOLDX_CACHE_DIR;
  process.env.FOLDX_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mse-foldx-cache-"));
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
  if (savedCacheDir === undefined) delete process.env.FOLDX_CACHE_DIR;
  else process.env.FOLDX_CACHE_DIR = savedCacheDir;
});

beforeEach(() => {
  delete process.env.AUTH_MODE;
  closeAccountsDb();
  BiophysicalJobQueue.resetForTesting();
  pocketJobRegistry.reset();
  pocketCache.clear();
  mutantCache.clear();
});

afterEach(() => {
  BiophysicalJobQueue.resetForTesting();
  pocketJobRegistry.reset();
});

async function call(method: string, p: string, opts: { cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  const payload = opts.body === undefined && method === "POST" ? {} : opts.body;
  if (payload !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${base}${p}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, cookie: res.headers.getSetCookie().find((c) => c.startsWith("mse_session="))?.split(";")[0] ?? null };
}

async function person(email: string) {
  const user = await createUser({ email, displayName: email.split("@")[0], passwordHash: await hashPassword(PASSWORD), role: "member", now: Date.now() });
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  expect(login.status).toBe(200);
  return { id: user.id, cookie: login.cookie as string };
}

/** A five-residue chain A, enough for the route to find residue 3. */
function pdb(): string {
  const lines: string[] = [];
  let serial = 1;
  for (let i = 1; i <= 5; i++) {
    const num = String(i).padStart(4);
    for (const [atom, el, x] of [[" N  ", "N", 0], [" CA ", "C", 1.5], [" C  ", "C", 2.5]] as const) {
      lines.push(`ATOM  ${String(serial++).padStart(5)} ${atom} ALA A${num}    ${(x + i * 3.8).toFixed(3).padStart(8)}   0.000   0.000  1.00 20.00           ${el}`);
    }
  }
  return lines.join("\n") + "\nEND\n";
}

const pocketRequest = { pdbText: pdb(), targetIndex: 3, targetChain: "A" };

describe("P2Rank: one run for two people", () => {
  it("two people asking for the same pocket share one job, and one cancel leaves the other's running", async () => {
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {})); // never finishes
    const a = await person("a@lab.org");
    const b = await person("b@lab.org");

    const first = await call("POST", "/pocket-finder", { cookie: a.cookie, body: pocketRequest });
    const second = await call("POST", "/pocket-finder", { cookie: b.cookie, body: pocketRequest });
    expect(first.status).toBe(200);
    expect(second.body.pocketJobId).toBe(first.body.pocketJobId); // joined, not a second job
    const id = first.body.pocketJobId;
    expect(await queue.getQueueLength()).toBe(1);

    const cancelA = await call("POST", `/jobs/${id}/cancel`, { cookie: a.cookie });
    expect(cancelA.body).toMatchObject({ cancelled: false, stillRunningForOthers: true });
    expect((await queue.getJobStatus(id))?.status).not.toBe("failed");

    // Both see it in their own job list.
    expect((await call("GET", "/my-jobs", { cookie: b.cookie })).body.jobs.map((j: any) => j.id)).toContain(id);
  });

  it("a stored result is served at once as a completed job, without using a queue slot", async () => {
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    const a = await person("a@lab.org");
    const stored = { pocketResidues: [], pocketScore: 0.4, pocketVolume: 0, likelyCofactor: "none", status: "success" };
    pocketCache.set(pocketResultCacheKey(pocketRequest.pdbText, 3, "A"), stored);

    const res = await call("POST", "/pocket-finder", { cookie: a.cookie, body: pocketRequest });
    const poll = await call("GET", `/pocket-job/${res.body.pocketJobId}`, { cookie: a.cookie });
    expect(poll.body).toMatchObject({ status: "completed", result: { pocketScore: 0.4 } });
    expect(await queue.getQueueLength()).toBe(0);
  });

  it("an opted-out person's agent result is not served to anyone else, but is to them", async () => {
    BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    const owner = await person("owner@lab.org");
    const other = await person("other@lab.org");
    const provenance: ComputeProvenance = { computedOn: "agent", hostClass: "x64-native-8c-16g", toolVersion: "2.9", ownerId: owner.id, shared: false, validated: true };
    pocketCache.set(pocketResultCacheKey(pocketRequest.pdbText, 3, "A"), { status: "success", pocketScore: 0.9, computeProvenance: provenance });

    const mine = await call("POST", "/pocket-finder", { cookie: owner.cookie, body: pocketRequest });
    expect((await call("GET", `/pocket-job/${mine.body.pocketJobId}`)).body).toMatchObject({ status: "completed", result: { pocketScore: 0.9 } });

    const theirs = await call("POST", "/pocket-finder", { cookie: other.cookie, body: pocketRequest });
    // Computed afresh for them: a real job (waiting or already running), not the owner's stored answer.
    const theirPoll = (await call("GET", `/pocket-job/${theirs.body.pocketJobId}`)).body;
    expect(["queued", "running"]).toContain(theirPoll.status);
    expect(theirPoll.result?.pocketScore).not.toBe(0.9);
  });
});

describe("FoldX shared cache", () => {
  const key = getFoldxCacheKey("hash", "VA600E");
  const result = (p?: ComputeProvenance) => ({ status: "success", ddG: 1.2, computeProvenance: p });

  it("serves a server result to anyone, and stamps provenance when it is stored", async () => {
    writeMutantToCache(key, { status: "success", ddG: 1.2 });
    const got = await getMutantFromCache(key, "anyone");
    expect(got.computeProvenance).toMatchObject({ computedOn: "server", ownerId: null });
  });

  it("keeps an unshared or unvalidated agent result to its owner", async () => {
    mutantCache.set(key, result({ computedOn: "agent", hostClass: null, toolVersion: "5.1", ownerId: "u1", shared: false, validated: true }));
    expect(await getMutantFromCache(key, "u1")).not.toBeNull();
    expect(await getMutantFromCache(key, "u2")).toBeNull();
    expect(await getMutantFromCache(key)).toBeNull();

    mutantCache.set(key, result({ computedOn: "agent", hostClass: null, toolVersion: "5.1", ownerId: "u1", shared: true, validated: false }));
    expect(await getMutantFromCache(key, "u2")).toBeNull();

    mutantCache.set(key, result({ computedOn: "agent", hostClass: null, toolVersion: "5.1", ownerId: "u1", shared: true, validated: true }));
    expect(await getMutantFromCache(key, "u2")).not.toBeNull();
  });

  it("a tool version separates results only when it is known, so existing entries stay valid", () => {
    expect(getFoldxCacheKey("h", "VA600E")).toBe("h_VA600E_pH:7_temp:298_ion:0.05_seed:12345_version:v4");
    expect(getFoldxCacheKey("h", "VA600E", { toolVersion: "5.1" })).not.toBe(getFoldxCacheKey("h", "VA600E"));
    expect(pocketResultCacheKey(pdb(), 3, "A", "2.5")).not.toBe(pocketResultCacheKey(pdb(), 3, "A"));
  });

  it("a result with no provenance predates it and is the server's", () => {
    expect(mayServe({ status: "success" }, null)).toBe(true);
    expect(mayServeToOthers(null)).toBe(true);
  });
});

describe("provenance on the job's own result", () => {
  it("records that the server computed it, for whom", async () => {
    const queue = BiophysicalJobQueue.initialize(1, async () => ({ status: "success" }));
    const id = await queue.pushJob("p2rank", {}, { ownerId: "u1" });
    await new Promise((r) => setTimeout(r, 200));
    expect((await queue.getJobStatus(id))?.result.computeProvenance).toMatchObject({ computedOn: "server", ownerId: "u1" });
  });
});
