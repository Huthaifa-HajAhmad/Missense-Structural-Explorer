import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";

import { apiRouter } from "../routes.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { closeAccountsDb, createUser, updateAgentReport } from "../auth/store.ts";
import { hashPassword } from "../auth/password.ts";
import { BiophysicalJobQueue, SQLiteQueue } from "../services/infra/biophysical-queue.ts";
import { _resetHostProbe } from "../services/infra/host-probe.ts";
import { releaseStrandedPlacements } from "./agent.ts";
import { AGENT_PROTOCOL_VERSION, type AgentHostReport } from "../../src/shared/agentProtocol.ts";

/**
 * WP-G2 acceptance, through the real router: with `COMPUTE_ROUTING=on`, a job from a person whose computer
 * is online is placed on that computer and runs there; with the computer gone it falls back to the server;
 * a person without a computer is unaffected; and nobody else's job ever goes to (or learns about) it.
 */

const PASSWORD = "correct horse battery";
const BOTH_TOOLS = [
  { name: "foldx", version: "unknown", verified: true },
  { name: "p2rank", version: "unknown", verified: true },
];

let server: Server;
let base: string;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  process.env.APP_API_TOKEN = "test-token-fixed-length-32-chars-ok!";
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
  for (const k of ["AUTH_MODE", "COMPUTE_ROUTING", "AGENT_SHARE_RESULTS"]) saved[k] = process.env[k];
  delete process.env.AUTH_MODE;
  delete process.env.AGENT_SHARE_RESULTS;
  process.env.COMPUTE_ROUTING = "on";
  _resetHostProbe(BOTH_TOOLS); // the server's tools are pinned, whatever this machine has installed
  closeAccountsDb();
  BiophysicalJobQueue.resetForTesting();
});

afterEach(() => {
  BiophysicalJobQueue.resetForTesting();
  _resetHostProbe();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function call(method: string, p: string, opts: { cookie?: string; agent?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  const payload = opts.body === undefined && method === "POST" ? {} : opts.body;
  if (payload !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.agent) headers.authorization = `Bearer ${opts.agent}`;
  const res = await fetch(`${base}${p}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json, cookie: res.headers.getSetCookie().find((c) => c.startsWith("mse_session="))?.split(";")[0] ?? null };
}

async function person(email: string) {
  const user = await createUser({ email, displayName: email.split("@")[0], passwordHash: await hashPassword(PASSWORD), role: "member", now: Date.now() });
  const login = await call("POST", "/auth/login", { body: { email, password: PASSWORD } });
  expect(login.status).toBe(200);
  return { id: user.id, cookie: login.cookie as string };
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
    foldxSource: "guided",
    foldxBundleVersion: null,
    ...over,
  };
}

/** A computer paired to `who` and checked in (online), through the real code exchange. */
async function onlineComputer(who: { cookie: string }, name = "Desk", over: Partial<AgentHostReport> = {}) {
  const code = await call("POST", "/agent/pair", { cookie: who.cookie });
  const redeemed = await call("POST", "/agent/pair/redeem", { body: { code: code.body.code, name } });
  expect(redeemed.status).toBe(201);
  const { agentId, token } = redeemed.body as { agentId: string; token: string };
  expect((await call("POST", "/agent/register", { agent: token, body: { report: report(over) } })).status).toBe(200);
  return { agentId, token };
}

const claim = (token: string, over: Partial<AgentHostReport> = {}) =>
  call("POST", "/agent/claim", { agent: token, body: { report: report(over), waitSec: 0 } });

const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * Two server slots, one held by a long job, so the server has a FREE slot: a job the engine places on a
 * computer must wait for that computer even so, and a job it keeps (or releases) to the server starts at once.
 */
async function halfBusyServer() {
  const queue = BiophysicalJobQueue.initialize(2, (_type, data) => (data?.blocker ? new Promise(() => {}) : Promise.resolve({ ranOn: "server" })));
  await queue.pushJob("foldx", { blocker: true }, { costEstimateMs: 10 * 60_000 });
  await tick(120);
  return queue;
}

function atom(serial: number, name: string, res: string, seq: number, x: number) {
  return `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${res} A${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}  1.00 50.00           ${name[0]}`;
}
const WT_PDB = ["ALA", "VAL", "GLY", "LEU"].flatMap((r, i) => [atom(i * 2 + 1, "N", r, i + 1, i * 3.8), atom(i * 2 + 2, "CA", r, i + 1, i * 3.8 + 1.4)]).join("\n") + "\nEND\n";
const pocketJob = { pdbText: WT_PDB, mutIndex: 2, targetChain: "A" };
const foldxJob = { wtPdb: WT_PDB, mutation: "VA2A", uniprotId: null, options: {} };

const sqlite = (q: BiophysicalJobQueue) => q.agentQueue() as SQLiteQueue;

describe("live routing (WP-G2)", () => {
  it("places a job on the owner's online computer, which runs it, and tells the owner where and why", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { agentId, token } = await onlineComputer(owner);

    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    await tick();
    const job = await sqlite(queue).getJob(id);
    expect(job?.placement).toBe(`agent:${agentId}`);
    expect(job?.status).toBe("queued"); // the server's free slot does not take it

    const waiting = queue.runsOn(id, owner.id)!;
    expect(waiting).toMatchObject({ where: "your_computer", computerName: "Desk", started: false });
    expect(waiting.reasons.join(" ")).toContain("Desk");
    const mine = await call("GET", "/my-jobs", { cookie: owner.cookie });
    const listed = mine.body.jobs.find((j: any) => j.id === id);
    expect(listed.runsOn).toMatchObject({ where: "your_computer", computerName: "Desk" });
    expect(listed.queuedAhead).toBe(0); // first in its computer's line, not unknown
    expect((await call("GET", `/pocket-job/${id}`, { cookie: owner.cookie })).body.runsOn.where).toBe("your_computer");

    const got = await claim(token);
    expect(got.body.job.id).toBe(id);
    expect(queue.runsOn(id, owner.id)).toMatchObject({ where: "your_computer", started: true });
  });

  it("falls back to the server when the computer goes offline before it starts the job", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { agentId } = await onlineComputer(owner);
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect((await sqlite(queue).getJob(id))?.placement).toBe(`agent:${agentId}`);

    expect(releaseStrandedPlacements()).toBe(0); // still online: it keeps the job
    updateAgentReport(agentId, { now: Date.now() - 5 * 60_000 }); // silent for five minutes: offline
    expect(releaseStrandedPlacements()).toBe(1);
    await tick();

    const status = await queue.getJobStatus(id);
    expect(status?.status).toBe("completed");
    expect(status?.result).toMatchObject({ ranOn: "server", computeProvenance: { computedOn: "server" } });
    const ranOn = queue.runsOn(id, owner.id)!;
    expect(ranOn.where).toBe("server");
    expect(ranOn.reasons[0]).toContain("did not pick it up");
  });

  it("falls back to the server when the computer is paused or no longer has the tool", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { agentId, token } = await onlineComputer(owner);
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect((await sqlite(queue).getJob(id))?.placement).toBe(`agent:${agentId}`);

    // Paused on the computer itself: its next check-in says so, and the job goes to the server.
    expect((await claim(token, { paused: true })).body.job).toBeNull();
    expect(releaseStrandedPlacements()).toBe(1);
    await tick();
    expect((await queue.getJobStatus(id))?.status).toBe("completed");
  });

  it("gives a placed job to the server when an idle computer has not claimed it for too long", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { agentId } = await onlineComputer(owner);
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect(sqlite(queue).releasePlacementsOf(() => true)).toBe(0); // within its patience
    expect(sqlite(queue).releasePlacementsOf(() => true, 60_000, Date.now() + 61_000)).toBe(1);
    expect((await sqlite(queue).getJob(id))?.placement ?? null).toBeNull();
    expect(agentId).toBeTruthy();
  });

  it("a computer that gives the job back leaves it with the server, and the owner is told", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { token } = await onlineComputer(owner);
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect((await claim(token)).body.job.id).toBe(id);
    expect((await call("POST", `/agent/jobs/${id}/fail`, { agent: token, body: { errorClass: "tool_failed", message: "java died" } })).status).toBe(200);
    await tick();
    expect((await queue.getJobStatus(id))?.status).toBe("completed");
    const ranOn = queue.runsOn(id, owner.id)!;
    expect(ranOn.where).toBe("server");
    expect(ranOn.reasons[0]).toContain("could not finish");
  });

  it("a person without a computer is unaffected: nothing is placed and nothing new is shown", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    await onlineComputer(owner);
    const other = await person("other@lab.org");

    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: other.id, residues: 4 });
    await tick();
    expect((await sqlite(queue).getJob(id))?.routing ?? null).toBeNull();
    expect((await queue.getJobStatus(id))?.status).toBe("completed");
    expect(queue.runsOn(id, other.id)).toBeNull();
    const theirs = await call("GET", "/my-jobs", { cookie: other.cookie });
    expect(theirs.body.jobs[0].runsOn).toBeNull();
  });

  it("another person never sees, joins or reaches the first person's computer", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { agentId } = await onlineComputer(owner, "Huthaifa's desktop");
    const other = await person("other@lab.org");
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect((await sqlite(queue).getJob(id))?.placement).toBe(`agent:${agentId}`);

    // A private computer result is never handed to someone else: joining a job that WAITS for one is refused too.
    expect(sqlite(queue).mayJoin(id, other.id, () => false)).toBe(false);
    expect(sqlite(queue).mayJoin(id, owner.id, () => false)).toBe(true);

    // With sharing on, someone who joins is told only that a teammate's computer runs it: no name, no reasons.
    queue.addWatcher(id, other.id);
    const seen = queue.runsOn(id, other.id)!;
    expect(seen).toMatchObject({ where: "teammate_computer", computerName: null, reasons: [] });
    expect(JSON.stringify((await call("GET", "/my-jobs", { cookie: other.cookie })).body)).not.toContain("desktop");
    expect(queue.runsOn(id, null)?.computerName ?? null).toBeNull();
  });

  it("shadow mode only logs: the job is not placed on the computer", async () => {
    process.env.COMPUTE_ROUTING = "shadow";
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    await onlineComputer(owner);
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect((await sqlite(queue).getJob(id))?.placement ?? null).toBeNull();
  });

  it("a computer's wait estimate counts what is already placed on it, and its load steers the next job", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { agentId } = await onlineComputer(owner);

    const first = await queue.pushJob("foldx", foldxJob, { ownerId: owner.id, residues: 4 });
    const second = await queue.pushJob("foldx", { ...foldxJob, mutation: "GA3A" }, { ownerId: owner.id, residues: 4 });
    const q = sqlite(queue);
    expect((await q.getJob(first))?.placement).toBe(`agent:${agentId}`);
    expect((await q.getJob(second))?.placement).toBe(`agent:${agentId}`);

    const firstMs = (await q.getJob(first))!.routing!.expectedMs!.p50;
    expect(q.getQueuePosition(second)).toBe(1);
    expect(q.getEta(second)?.waitMs).toBe(firstMs);
    expect(q.agentLoad(agentId).queuedCostMs).toBe(firstMs * 2);
    const routing = (await q.getJob(first))!.routing!;
    expect(routing.basis).toBe("prior");
    expect(routing.reasons.some((r) => r.includes("Expected run time"))).toBe(true);
  });

  it("shows a computer's own speed to its owner", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { token } = await onlineComputer(owner);
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect((await claim(token)).body.job.id).toBe(id);
    const POCKET = {
      pocketResidues: [{ index: 4, chain: "A", name: "LEU", distance: 3.2, score: 0.4, role: "hydrophobic", type: "aliphatic" }],
      pocketScore: 61, pocketVolume: 0, likelyCofactor: "None recorded in curated annotations", status: "success",
      pocketDistance: 3.2, cavityCentreDistance: 4.1,
      provenance: { engine: "p2rank", scoreSource: "probability", volumeSource: "unavailable", profile: "alphafold" },
    };
    const done = await call("POST", `/agent/jobs/${id}/result`, { agent: token, body: { result: POCKET, wallMs: 4200, toolVersion: "2.6-alpha" } });
    expect(done.body).toEqual({ accepted: true });
    expect(queue.runsOn(id, owner.id)).toMatchObject({ where: "your_computer", started: true });

    const agents = await call("GET", "/me/agents", { cookie: owner.cookie });
    const recent = agents.body.agents[0].recent;
    expect(recent).toMatchObject({ days: 30, completed: 1, handedBack: 0, foldx: null, p2rank: { jobs: 1, medianResidues: 4 } });
    // The computer's own time, bounded by how long the job was really out (it cannot claim longer).
    expect(recent.p2rank.medianMs).toBeGreaterThan(0);
    expect(recent.p2rank.medianMs).toBeLessThanOrEqual(4200);
  });
});

describe("live routing (WP-G2), after review", () => {
  /** One server slot, held: the owner's backlog stays queued, so a computer may take it. */
  async function fullServer() {
    const queue = BiophysicalJobQueue.initialize(1, (_type, data) => (data?.blocker ? new Promise(() => {}) : Promise.resolve({ ranOn: "server" })));
    await queue.pushJob("foldx", { blocker: true }, { costEstimateMs: 10 * 60_000 });
    await tick(120);
    return queue;
  }

  it("a computer takes the job placed on it before older backlog, as its queue position promised", async () => {
    const queue = await fullServer();
    const owner = await person("owner@lab.org");
    const { agentId, token } = await onlineComputer(owner);
    process.env.COMPUTE_ROUTING = "shadow";
    const backlog = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    process.env.COMPUTE_ROUTING = "on";
    const placed = await queue.pushJob("p2rank", { ...pocketJob, mutIndex: 3 }, { ownerId: owner.id, residues: 4 });
    expect((await sqlite(queue).getJob(backlog))?.placement ?? null).toBeNull();
    expect((await sqlite(queue).getJob(placed))?.placement).toBe(`agent:${agentId}`);
    expect(sqlite(queue).getQueuePosition(placed)).toBe(0);
    expect((await claim(token)).body.job.id).toBe(placed);
  });

  it("jobs waiting for a computer do not fill the server's own queue limit", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    await onlineComputer(owner);
    await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
    expect(sqlite(queue).getJobCount()).toBe(1); // the blocker only
  });

  it("never writes a computer's name into the routing log", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { agentId } = await onlineComputer(owner, "Alice's MacBook Pro");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4 });
      const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[routing:on]"));
      expect(line).toBeTruthy();
      expect(line).not.toContain("Alice");
      expect(line).toContain(`agent:${agentId}`);
    } finally {
      log.mockRestore();
    }
    // The owner still reads the name, from the stored record.
    expect(JSON.stringify(sqlite(queue).listFor(owner.id))).toContain("Alice's MacBook Pro");
  });

  it("'Shared server only' keeps every job on the server, computer or not", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    await onlineComputer(owner);
    expect((await call("PUT", "/me/preferences", { cookie: owner.cookie, body: { placementPref: "server_only" } })).status).toBe(200);
    // The submit routes read the preference from the signed-in person; the queue receives it as an option.
    const id = await queue.pushJob("p2rank", pocketJob, { ownerId: owner.id, residues: 4, placementPref: "server_only" });
    expect((await sqlite(queue).getJob(id))?.placement ?? null).toBeNull();
    await tick();
    expect((await queue.getJobStatus(id))?.status).toBe("completed");
  });

  it("the FoldX poll route tells the owner where and why, and anyone else only where", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    await onlineComputer(owner);
    const id = await queue.pushJob("foldx", foldxJob, { ownerId: owner.id, residues: 4 });
    const mine = await call("GET", `/foldx-job/${id}`, { cookie: owner.cookie });
    expect(mine.status).toBe(200);
    expect(mine.body.runsOn).toMatchObject({ where: "your_computer", computerName: "Desk", basis: "prior" });
    expect(mine.body.runsOn.expectedMs.p50).toBeGreaterThan(0);
    expect(mine.body.queuedAhead).toBe(0);
    const anyone = await call("GET", `/foldx-job/${id}`);
    expect(anyone.body.runsOn).toEqual({ where: "teammate_computer", computerName: null, started: false, expectedMs: null, basis: null, samples: null, reasons: [] });
  });

  it("a FoldX job placed on a computer whose team FoldX copy went out of date goes to the server", async () => {
    const queue = await halfBusyServer();
    const owner = await person("owner@lab.org");
    const { token } = await onlineComputer(owner);
    const id = await queue.pushJob("foldx", foldxJob, { ownerId: owner.id, residues: 4 });
    expect((await sqlite(queue).getJob(id))?.placement).toMatch(/^agent:/);
    // Its next check-in reports a team copy (version 7) the workspace no longer has: no FoldX is offered.
    expect((await claim(token, { foldxSource: "team", foldxBundleVersion: "7" })).body.job).toBeNull();
    expect(releaseStrandedPlacements()).toBe(1);
  });

  it("a restart keeps a waiting placement and its reasons; the sweep decides what happens to it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-routing-"));
    const file = path.join(dir, "queue.sqlite");
    try {
      const routing = { host: "agent:a1", computerName: "Desk", expectedMs: { p50: 3000, p90: 6000 }, basis: "prior" as const, samples: 0, reasons: ["Because."], decidedAt: Date.now(), note: null };
      const first = new SQLiteQueue(file, 1, async () => "ran", true);
      return first.addJob("j1", "p2rank", pocketJob, { ownerId: "u1", placement: "agent:a1", routing }).then(async () => {
        first.shutdown();
        const second = new SQLiteQueue(file, 1, async () => "ran", true); // paused: nothing starts by itself
        try {
          expect((await second.getJob("j1"))).toMatchObject({ status: "queued", placement: "agent:a1", routing });
          expect(second.releasePlacementsOf(() => false)).toBe(1);
          expect((await second.getJob("j1"))?.routing?.note).toBe("released");
        } finally {
          second.shutdown();
        }
      });
    } finally {
      setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 500).unref?.();
    }
  });
});
