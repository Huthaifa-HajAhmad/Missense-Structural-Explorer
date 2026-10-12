import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import JSZip from "jszip";

// StabilityOracle is a sidecar call; the agent path runs it beside the computer's FoldX like the server does.
vi.mock("../services/biophysics.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/biophysics.ts")>();
  return { ...actual, runStabilityOracleAnalysis: vi.fn(async () => ({ ddG: 0.7 })) };
});

import { apiRouter } from "../routes.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { closeAccountsDb, createUser, updateUser } from "../auth/store.ts";
import { hashPassword } from "../auth/password.ts";
import { BiophysicalJobQueue } from "../services/infra/biophysical-queue.ts";
import { AGENT_PROTOCOL_VERSION, type AgentHostReport } from "../../src/shared/agentProtocol.ts";

/**
 * WP-F over HTTP, with a fake agent: pairing, the claim/lease/result protocol, the hand-back rules and the
 * team FoldX bundle. Who may be handed which job is a security rule, so it goes through the real router,
 * the real session cookie and the real agent token.
 */

const API_TOKEN = "test-token-fixed-length-32-chars-ok!";
const PASSWORD = "correct horse battery";

let server: Server;
let base: string;
let tmp: string;
const saved: Record<string, string | undefined> = {};

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
  for (const k of ["AUTH_MODE", "TOOL_BUNDLES_DIR", "FOLDX_CACHE_DIR", "AGENT_SHARE_RESULTS"]) saved[k] = process.env[k];
  delete process.env.AUTH_MODE;
  delete process.env.AGENT_SHARE_RESULTS; // sharing from computers is off unless the test turns it on
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mse-agent-"));
  process.env.TOOL_BUNDLES_DIR = path.join(tmp, "bundles");
  process.env.FOLDX_CACHE_DIR = path.join(tmp, "foldx-cache");
  closeAccountsDb();
  BiophysicalJobQueue.resetForTesting();
});

afterEach(() => {
  BiophysicalJobQueue.resetForTesting();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Opts = { cookie?: string; agent?: string; body?: unknown; raw?: Uint8Array; headers?: Record<string, string> };

async function call(method: string, p: string, opts: Opts = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.raw) {
    body = Buffer.from(opts.raw);
    headers["content-type"] ??= "application/zip";
  } else {
    const payload = opts.body === undefined && method === "POST" ? {} : opts.body;
    if (payload !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(payload);
    }
  }
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.agent) headers.authorization = `Bearer ${opts.agent}`;
  const res = await fetch(`${base}${p}`, { method, headers, body });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = buf.length ? JSON.parse(buf.toString("utf8")) : null; } catch { json = null; }
  return { status: res.status, body: json, bytes: buf, headers: res.headers, cookie: res.headers.getSetCookie().find((c) => c.startsWith("mse_session="))?.split(";")[0] ?? null };
}

async function person(email: string, role: "admin" | "member" = "member") {
  const user = await createUser({ email, displayName: email.split("@")[0], passwordHash: await hashPassword(PASSWORD), role, now: Date.now() });
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  expect(login.status).toBe(200);
  return { id: user.id, cookie: login.cookie as string };
}

/** A computer paired to `who`, through the real code exchange. Returns its token. */
async function pair(who: { cookie: string }, name = "Desk") {
  const code = await call("POST", "/agent/pair", { cookie: who.cookie });
  expect(code.status).toBe(201);
  const redeemed = await call("POST", "/agent/pair/redeem", { body: { code: code.body.code, name } });
  expect(redeemed.status).toBe(201);
  return redeemed.body as { agentId: string; token: string };
}

function report(over: Partial<AgentHostReport> = {}): AgentHostReport {
  return {
    agentVersion: "1.0.0",
    protocol: AGENT_PROTOCOL_VERSION,
    os: "win32",
    arch: "x64",
    cores: 8,
    totalRamBytes: 16 * 1024 ** 3,
    freeRamBytes: 10 * 1024 ** 3,
    paused: false,
    tools: {
      foldx: { state: "ready", version: "5.1", detail: null },
      p2rank: { state: "ready", version: "2.6-alpha", detail: null },
    },
    foldxSource: "team",
    foldxBundleVersion: null,
    ...over,
  };
}

/**
 * A queue whose single server slot is held by a job that never ends, so everything a person queues after it
 * stays queued: the state in which a paired computer takes its owner's backlog.
 */
async function busyServer() {
  const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
  await queue.pushJob("foldx", { name: "blocker" });
  await new Promise((r) => setTimeout(r, 120));
  return queue;
}

const claim = (token: string, over: Partial<AgentHostReport> = {}, waitSec = 0) =>
  call("POST", "/agent/claim", { agent: token, body: { report: report(over), waitSec } });

const POCKET = {
  pocketResidues: [{ index: 4, chain: "A", name: "LEU", distance: 3.2, score: 0.4, role: "hydrophobic", type: "aliphatic" }],
  pocketScore: 61,
  pocketVolume: 0,
  likelyCofactor: "None recorded in curated annotations",
  status: "success",
  pocketDistance: 3.2,
  cavityCentreDistance: 4.1,
  provenance: { engine: "p2rank", scoreSource: "probability", volumeSource: "unavailable", profile: "alphafold" },
};

function atom(serial: number, name: string, res: string, seq: number, x: number) {
  return `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${res} A${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}  1.00 50.00           ${name[0]}`;
}
const pdbOf = (residues: string[]) => residues.flatMap((r, i) => [atom(i * 2 + 1, "N", r, i + 1, i * 3.8), atom(i * 2 + 2, "CA", r, i + 1, i * 3.8 + 1.4)]).join("\n") + "\nEND\n";
const WT_PDB = pdbOf(["ALA", "VAL", "GLY", "LEU"]);

describe("pairing", () => {
  it("a code works once, a wrong code is refused, and only the agent token opens /agent", async () => {
    const owner = await person("owner@lab.org");
    expect((await call("POST", "/agent/pair")).status).toBe(401); // signed out

    const code = await call("POST", "/agent/pair", { cookie: owner.cookie });
    expect(code.body.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect((await call("POST", "/agent/pair/redeem", { body: { code: "AAA-AAA", name: "x" } })).status).toBe(401);
    const ok = await call("POST", "/agent/pair/redeem", { body: { code: code.body.code.toLowerCase(), name: "Desk" } });
    expect(ok.status).toBe(201);
    expect(ok.body.token.length).toBeGreaterThan(30);
    expect((await call("POST", "/agent/pair/redeem", { body: { code: code.body.code, name: "Again" } })).status).toBe(401);

    await busyServer();
    expect((await call("POST", "/agent/register", { cookie: owner.cookie, body: { report: report() } })).status).toBe(401);
    expect((await call("POST", "/agent/register", { agent: ok.body.token, body: { report: report() } })).status).toBe(200);
  });

  it("disconnecting from the app, or disabling the account, stops the token at once", async () => {
    const owner = await person("owner@lab.org");
    await busyServer();
    const a = await pair(owner);
    const b = await pair(owner, "Laptop");
    const mine = await call("GET", "/me/agents", { cookie: owner.cookie });
    expect(mine.body.agents.map((x: any) => x.name).sort()).toEqual(["Desk", "Laptop"]);

    expect((await call("DELETE", `/me/agents/${a.agentId}`, { cookie: owner.cookie })).status).toBe(204);
    expect((await claim(a.token)).status).toBe(401);

    updateUser(owner.id, { status: "disabled" });
    expect((await claim(b.token)).status).toBe(401);
  });
});

describe("the job protocol", () => {
  it("offers only the owner's own jobs, and completes a valid result with agent provenance", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    const other = await person("other@lab.org");
    await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 2, targetChain: "A", jobDir: "/server/only/path" }, { ownerId: other.id });
    const mine = await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 2, targetChain: "A", jobDir: "/server/only/path" }, { ownerId: owner.id });
    const { token } = await pair(owner);
    expect((await call("POST", "/agent/register", { agent: token, body: { report: report() } })).body).toMatchObject({ leaseSec: 60, heartbeatSec: 20 });
    // The owner keeps the default (share their results) and the workspace allows serving them.
    process.env.AGENT_SHARE_RESULTS = "on";

    const got = await claim(token);
    expect(got.status).toBe(200);
    expect(got.body.job.id).toBe(mine);
    expect(got.body.job.payload).toEqual({ pdbText: WT_PDB, mutIndex: 2, targetChain: "A" }); // no server path
    expect((await claim(token)).body.job).toBeNull(); // the other person's job is never offered

    expect((await call("POST", `/agent/jobs/${mine}/heartbeat`, { agent: token, body: {} })).status).toBe(200);
    const done = await call("POST", `/agent/jobs/${mine}/result`, { agent: token, body: { result: POCKET, wallMs: 4200, peakRssBytes: 6e8, toolVersion: "2.6-alpha" } });
    expect(done.body).toEqual({ accepted: true });
    const status = await queue.getJobStatus(mine);
    expect(status?.status).toBe("completed");
    expect(status?.result.computeProvenance).toMatchObject({ computedOn: "agent", validated: true, shared: true, ownerId: owner.id, toolVersion: "2.6-alpha" });

    // A late duplicate is discarded.
    expect((await call("POST", `/agent/jobs/${mine}/result`, { agent: token, body: { result: POCKET, toolVersion: "2.6-alpha" } })).status).toBe(409);
  });

  it("two computers racing for one job: exactly one wins", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 2 }, { ownerId: owner.id });
    const a = await pair(owner, "A");
    const b = await pair(owner, "B");
    const results = await Promise.all([claim(a.token), claim(b.token), claim(a.token), claim(b.token)]);
    expect(results.filter((r) => r.body.job).length).toBe(1);
  });

  it("a lost lease hands the job to the server, which keeps it; the computer's late result is refused", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    const id = await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 2 }, { ownerId: owner.id });
    const { token } = await pair(owner);
    expect((await claim(token)).body.job.id).toBe(id);

    expect(queue.agentQueue()!.reapAgentLeases(Date.now() + 61_000)).toBe(1);
    expect((await queue.getJobStatus(id))?.status).toBe("queued");
    expect((await claim(token)).body.job).toBeNull(); // placed on the server now: not offered again
    expect((await call("POST", `/agent/jobs/${id}/heartbeat`, { agent: token, body: {} })).status).toBe(410);
    expect((await call("POST", `/agent/jobs/${id}/result`, { agent: token, body: { result: POCKET, toolVersion: "2.6-alpha" } })).status).toBe(409);
  });

  it("a cancelled job tells the computer to stop at its next heartbeat", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    const id = await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 2 }, { ownerId: owner.id });
    const { token } = await pair(owner);
    await claim(token);
    expect((await call("POST", `/jobs/${id}/cancel`, { cookie: owner.cookie })).body).toMatchObject({ cancelled: true });
    expect((await call("POST", `/agent/jobs/${id}/heartbeat`, { agent: token, body: {} })).status).toBe(410);
  });

  it("an invalid result, or a failure, gives the job to the server once", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    const a = await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 2 }, { ownerId: owner.id });
    const b = await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 3 }, { ownerId: owner.id });
    const { token } = await pair(owner);

    expect((await claim(token)).body.job.id).toBe(a);
    const bad = await call("POST", `/agent/jobs/${a}/result`, { agent: token, body: { result: { ...POCKET, pocketScore: Number.MAX_VALUE }, toolVersion: "2.6-alpha" } });
    expect(bad.body.accepted).toBe(false);
    expect(bad.body.reasons.length).toBeGreaterThan(0);
    expect((await queue.getJobStatus(a))?.status).toBe("queued");

    expect((await claim(token)).body.job.id).toBe(b);
    expect((await call("POST", `/agent/jobs/${b}/fail`, { agent: token, body: { errorClass: "oom", message: "Java ran out of memory" } })).status).toBe(200);
    expect((await queue.getJobStatus(b))?.status).toBe("queued");
    expect((await claim(token)).body.job).toBeNull(); // both now belong to the server
  });

  it("respects the owner's preference, pause, and a computer without the tool", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    await queue.pushJob("p2rank", { pdbText: WT_PDB, mutIndex: 2 }, { ownerId: owner.id });
    const { token } = await pair(owner);
    expect((await claim(token, { paused: true })).body.job).toBeNull();
    expect((await claim(token, { tools: { foldx: { state: "ready", version: "5.1", detail: null }, p2rank: { state: "missing", version: null, detail: null } } })).body.job).toBeNull();
    updateUser(owner.id, { placementPref: "server_only" });
    expect((await claim(token)).body.job).toBeNull();
    updateUser(owner.id, { placementPref: "auto" });
    expect((await claim(token)).body.job).not.toBeNull();
  });

  it("a paused standby refuses claims", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    const { token } = await pair(owner);
    queue.pauseProcessing();
    expect((await claim(token)).status).toBe(503);
  });

  it("a FoldX result is checked against the job, then finished like a server run", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    const id = await queue.pushJob("foldx", { wtPdb: WT_PDB, mutation: "VA2E", uniprotId: null, options: {}, remoteJobs: {} }, { ownerId: owner.id, residues: 4 });
    const { token } = await pair(owner);
    const got = await claim(token);
    expect(got.body.job.payload).toMatchObject({ wtPdb: WT_PDB, mutation: "VA2E" });

    const foldx = (pdb: string) => ({
      status: "success",
      pdb,
      ddG: 1.8,
      sd: 0.1,
      foldedResidueIndex: 2,
      resolvedChain: "A",
      energetics: { foldxMean: 1.8, foldxSd: 0.1, rawDdGs: [1.7, 1.8, 1.9], foldxRepairFailed: false, foldxRepairSkipped: true },
    });
    // The wrong residue at the site: refused, and the job goes to the server.
    const wrong = await call("POST", `/agent/jobs/${id}/result`, { agent: token, body: { result: foldx(pdbOf(["ALA", "VAL", "GLY", "LEU"])), toolVersion: "5.1" } });
    expect(wrong.body.accepted).toBe(false);
    expect(wrong.body.reasons.join(" ")).toMatch(/is VAL, not GLU/);
  });

  it("a correct FoldX result completes the job", async () => {
    const queue = await busyServer();
    const owner = await person("owner@lab.org");
    const id = await queue.pushJob("foldx", { wtPdb: WT_PDB, mutation: "VA2E", uniprotId: null, options: {}, remoteJobs: {} }, { ownerId: owner.id, residues: 4 });
    const { token } = await pair(owner);
    await claim(token);
    await call("POST", `/agent/jobs/${id}/heartbeat`, { agent: token, body: { phase: "modelling" } });
    expect((await queue.getJobData(id)).phase).toBe("modelling");
    const res = await call("POST", `/agent/jobs/${id}/result`, {
      agent: token,
      body: {
        result: { status: "success", pdb: pdbOf(["ALA", "GLU", "GLY", "LEU"]), ddG: 1.8, foldedResidueIndex: 2, resolvedChain: "A", energetics: { foldxMean: 1.8 } },
        wallMs: 3000,
        toolVersion: "5.1",
      },
    });
    expect(res.body).toEqual({ accepted: true });
    const status = await queue.getJobStatus(id);
    expect(status?.status).toBe("completed");
    expect(status?.result.computeProvenance).toMatchObject({ computedOn: "agent", validated: true });
    expect(status?.result.ddG).toBe(1.8);
    // The poll route says where it ran: the owner sees their own id, nobody else does.
    const polled = await call("GET", `/foldx-job/${id}`, { cookie: owner.cookie });
    expect(polled.body.result.computeProvenance).toMatchObject({ computedOn: "agent", ownerId: owner.id });
  });
});

async function foldxZip(kind: "win32" | "linux", opts: { molecules?: boolean; rotabase?: boolean } = {}) {
  const zip = new JSZip();
  const head = kind === "win32" ? [0x4d, 0x5a, 0x90, 0x00] : [0x7f, 0x45, 0x4c, 0x46];
  zip.file(kind === "win32" ? "foldx5/foldx_20991231.exe" : "foldx5/foldx_20991231", new Uint8Array([...head, 1, 2, 3, 4]));
  if (opts.molecules !== false) zip.file("foldx5/molecules/ALA.json", "{}");
  if (opts.rotabase !== false) zip.file("foldx5/rotabase.txt", "rotabase");
  return zip.generateAsync({ type: "uint8array" });
}

describe("the team FoldX bundle", () => {
  it("upload needs the licence tick and a real FoldX for that platform; agents download it; revoke removes it", async () => {
    await busyServer();
    const admin = await person("admin@lab.org", "admin");
    const member = await person("member@lab.org");
    const licence = { "x-foldx-licence-confirmed": "yes" };
    const win = await foldxZip("win32");

    expect((await call("PUT", "/admin/tools/foldx/win32", { cookie: member.cookie, raw: win, headers: licence })).status).toBe(403);
    expect((await call("PUT", "/admin/tools/foldx/win32", { cookie: admin.cookie, raw: win })).status).toBe(400);
    const linuxOnWindows = await call("PUT", "/admin/tools/foldx/win32", { cookie: admin.cookie, raw: await foldxZip("linux"), headers: licence });
    expect(linuxOnWindows.status).toBe(422);
    expect(linuxOnWindows.body.error.message).toMatch(/Linux build/);
    const noMolecules = await call("PUT", "/admin/tools/foldx/win32", { cookie: admin.cookie, raw: await foldxZip("win32", { molecules: false }), headers: licence });
    expect(noMolecules.body.error.message).toMatch(/molecules/);

    const up = await call("PUT", "/admin/tools/foldx/win32", { cookie: admin.cookie, raw: win, headers: licence });
    expect(up.status).toBe(201);
    expect(up.body.bundle).toMatchObject({ platform: "win32", binaryName: "foldx_20991231.exe", expiry: "2099-12-31" });

    const { token } = await pair(member);
    expect((await claim(token)).body.foldxBundleVersion).toBe(up.body.bundle.version);
    expect((await call("GET", "/agent/tools/foldx?platform=win32")).status).toBe(401);
    expect((await call("GET", "/agent/tools/foldx?platform=../../etc", { agent: token })).status).toBe(400);
    const dl = await call("GET", "/agent/tools/foldx?platform=win32", { agent: token });
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.bytes, Buffer.from(win))).toBe(0);
    expect(dl.headers.get("x-bundle-sha256")).toBe(up.body.bundle.sha256);
    const again = await call("GET", "/agent/tools/foldx?platform=win32", { agent: token, headers: { "if-none-match": `"${up.body.bundle.sha256}"` } });
    expect(again.status).toBe(304);
    expect((await call("GET", "/agent/tools/foldx?platform=linux", { agent: token })).status).toBe(404);

    expect((await call("DELETE", "/admin/tools/foldx", { cookie: admin.cookie })).status).toBe(204);
    expect((await call("GET", "/agent/tools/foldx?platform=win32", { agent: token })).status).toBe(404);
    expect((await claim(token)).body.foldxBundleVersion).toBeNull();
  });
});
