import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { Server } from "http";
import type { AddressInfo } from "net";
import JSZip from "jszip";

// The tools themselves are not under test here (they have their own suites); the protocol and the loop are.
const runJobMock = vi.fn();
vi.mock("./runner.ts", async (importOriginal) => ({ ...(await importOriginal<typeof import("./runner.ts")>()), runJob: (...a: unknown[]) => runJobMock(...a) }));

import { apiRouter } from "../routes.ts";
import { requestLogger, validateContentType } from "../middleware.ts";
import { closeAccountsDb, createUser } from "../auth/store.ts";
import { hashPassword } from "../auth/password.ts";
import { BiophysicalJobQueue } from "../services/infra/biophysical-queue.ts";
import { AgentWorker, redact } from "./worker.ts";
import { gate, startSetupPage } from "./setup-page.ts";
import { safeJoin } from "./tools.ts";
import { checkFoldxArchive, executableKind, installFoldxArchive } from "../services/infra/foldx-archive.ts";

let server: Server;
let base: string;
let home: string;
const PASSWORD = "correct horse battery";

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
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mse-agent-home-"));
  process.env.AGENT_HOME = home;
  delete process.env.AGENT_TOKEN;
  delete process.env.AGENT_SERVER_URL;
  closeAccountsDb();
  BiophysicalJobQueue.resetForTesting();
  runJobMock.mockReset();
});

afterEach(() => {
  BiophysicalJobQueue.resetForTesting();
  delete process.env.AGENT_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

async function signedIn(email: string) {
  const user = await createUser({ email, displayName: "Owner", passwordHash: await hashPassword(PASSWORD), role: "member", now: Date.now() });
  const res = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("mse_session="))!.split(";")[0];
  return { id: user.id, cookie };
}

async function pairingCode(cookie: string): Promise<string> {
  const res = await fetch(`${base}/api/v1/agent/pair`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" });
  return (await res.json()).code;
}

const POCKET = {
  pocketResidues: [],
  pocketScore: 0,
  pocketVolume: 0,
  likelyCofactor: "None recorded in curated annotations",
  status: "none_detected",
  pocketDistance: null,
};

async function until(cond: () => Promise<boolean> | boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
}

function readyWorker(): AgentWorker {
  const w = new AgentWorker();
  w.tools.status = { foldx: { state: "missing", version: null, detail: null }, p2rank: { state: "ready", version: "2.6-alpha", detail: null } };
  return w;
}

describe("the agent, end to end against the real server", () => {
  it("pairs with a code, takes its owner's job, and delivers the result", async () => {
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    await queue.pushJob("foldx", { name: "blocker" });
    const owner = await signedIn("owner@lab.org");
    const id = await queue.pushJob("p2rank", { pdbText: "X".repeat(100), mutIndex: 5, targetChain: "A" }, { ownerId: owner.id });
    runJobMock.mockResolvedValue({ kind: "result", result: POCKET, wallMs: 900, peakRssBytes: 1e8 });

    const worker = readyWorker();
    expect(await worker.pair(base, "WRONG1", "Desk")).toMatch(/not valid/);
    expect(await worker.pair(base, await pairingCode(owner.cookie), "Desk")).toBeNull();
    const saved = JSON.parse(fs.readFileSync(path.join(home, "agent.json"), "utf8"));
    expect(saved.token.length).toBeGreaterThan(30);
    if (process.platform !== "win32") expect(fs.statSync(path.join(home, "agent.json")).mode & 0o077).toBe(0);

    void worker.run();
    await until(async () => (await queue.getJobStatus(id))?.status === "completed");
    expect(runJobMock.mock.calls[0][0]).toMatchObject({ id, type: "p2rank", payload: { mutIndex: 5 } });
    expect((await queue.getJobStatus(id))?.result.computeProvenance.computedOn).toBe("agent");
    expect(worker.connection).toBe("connected");
    worker.stop();
  });

  it("a computer that dies mid-job leaves nothing stuck: the job goes back to the server", async () => {
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    await queue.pushJob("foldx", { name: "blocker" });
    const owner = await signedIn("owner@lab.org");
    const id = await queue.pushJob("p2rank", { pdbText: "X".repeat(100), mutIndex: 5 }, { ownerId: owner.id });
    runJobMock.mockImplementation(() => new Promise(() => {})); // hangs: the computer "dies" here

    const worker = readyWorker();
    expect(await worker.pair(base, await pairingCode(owner.cookie), "Desk")).toBeNull();
    void worker.run();
    await until(async () => (await queue.getJobStatus(id))?.status === "running");
    worker.stop();

    // The lease runs out (simulated clock): the job is queued again, on the server's side of the queue.
    expect(queue.agentQueue()!.reapAgentLeases(Date.now() + 120_000)).toBe(1);
    expect((await queue.getJobStatus(id))?.status).toBe("queued");
  });

  it("a revoked token stops the loop and says so", async () => {
    const queue = BiophysicalJobQueue.initialize(1, () => new Promise(() => {}));
    const owner = await signedIn("owner@lab.org");
    const worker = readyWorker();
    await worker.pair(base, await pairingCode(owner.cookie), "Desk");
    const list = await (await fetch(`${base}/api/v1/me/agents`, { headers: { cookie: owner.cookie } })).json();
    await fetch(`${base}/api/v1/me/agents/${list.agents[0].id}`, { method: "DELETE", headers: { cookie: owner.cookie } });
    void worker.run();
    await until(() => worker.connection === "revoked");
    expect(worker.lastError).toMatch(/disconnected/);
    worker.stop();
    void queue;
  });
});

describe("the setup page", () => {
  it("refuses requests without its token, from another Host name, and serves with both", async () => {
    const worker = readyWorker();
    const page = await startSetupPage(worker, 0);
    try {
      const token = new URL(page.url).searchParams.get("t")!;
      const get = (p: string, headers: Record<string, string> = {}) =>
        new Promise<number>((resolve) => {
          http.get({ host: "127.0.0.1", port: page.port, path: p, headers }, (res) => { res.resume(); resolve(res.statusCode!); });
        });
      expect(await get("/")).toBe(403);
      expect(await get(`/?t=${token}`)).toBe(200);
      expect(await get("/api/state")).toBe(403);
      expect(await get("/api/state", { "x-setup-token": token })).toBe(200);
      // DNS rebinding: a hostile name resolved to 127.0.0.1 still carries its own Host header.
      expect(await get(`/?t=${token}`, { host: `evil.example:${page.port}` })).toBe(403);
    } finally {
      await page.close();
    }
  });

  it("the gate refuses a connection that is not from this machine", () => {
    const req = { socket: { remoteAddress: "192.168.1.20" }, headers: { host: "127.0.0.1:5000" }, url: "/?t=abc" } as any;
    expect(gate(req, 5000, "abc")).toBe("forbidden");
    expect(gate({ ...req, socket: { remoteAddress: "127.0.0.1" } }, 5000, "abc")).toBe("ok");
  });
});

describe("FoldX archives (team upload and the guided drop)", () => {
  async function zipOf(files: Record<string, Uint8Array | string>) {
    const z = new JSZip();
    for (const [n, c] of Object.entries(files)) z.file(n, c);
    return z.generateAsync({ type: "uint8array" });
  }
  const PE = new Uint8Array([0x4d, 0x5a, 0, 0, 9, 9]);
  const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 9, 9]);

  it("recognises programs by their header, not their name", () => {
    expect(executableKind(PE)).toBe("win32");
    expect(executableKind(ELF)).toBe("linux");
    expect(executableKind(new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]))).toBe("darwin");
    expect(executableKind(new Uint8Array([1, 2, 3, 4]))).toBe("unknown");
  });

  it("gives the specific reason for each wrong archive, and accepts a correct one", async () => {
    const full = { "foldx5/molecules/ALA.json": "{}", "foldx5/rotabase.txt": "r" };
    expect((await checkFoldxArchive(new Uint8Array([1, 2, 3, 4, 5]), "win32")).ok).toBe(false);
    expect(await checkFoldxArchive(await zipOf({ "readme.txt": "hi", "photo.jpg": "x" }), "win32")).toMatchObject({ problem: expect.stringMatching(/does not contain the FoldX program/) });
    expect(await checkFoldxArchive(await zipOf({ "foldx5/foldx_20991231": ELF, ...full }), "win32")).toMatchObject({ problem: expect.stringMatching(/Linux build of FoldX; this computer needs the Windows one/) });
    expect(await checkFoldxArchive(await zipOf({ "foldx_20991231.exe": PE, "rotabase.txt": "r" }), "win32")).toMatchObject({ problem: expect.stringMatching(/molecules folder/) });
    expect(await checkFoldxArchive(await zipOf({ "foldx_20991231.exe": PE, "molecules/A.json": "{}" }), "win32")).toMatchObject({ problem: expect.stringMatching(/rotabase\.txt/) });
    expect(await checkFoldxArchive(await zipOf({ "foldx_20200101.exe": PE, ...full }), "win32")).toMatchObject({ problem: expect.stringMatching(/stopped working on 2020-01-01/) });

    const good = await checkFoldxArchive(await zipOf({ "foldx5/foldx_20991231.exe": PE, ...full, "foldx5/molecules/../../../evil.json": "x" }), "win32");
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const dest = path.join(home, "tools", "foldx");
    const bin = await installFoldxArchive(good, dest);
    expect(path.basename(bin)).toBe("foldx_20991231.exe");
    expect(fs.readdirSync(path.join(dest, "molecules"))).toEqual(["ALA.json"]);
    expect(fs.existsSync(path.join(dest, "rotabase.txt"))).toBe(true);
    expect(fs.existsSync(path.join(home, "evil.json"))).toBe(false);
  });

  it("refuses to unpack outside the target folder", () => {
    const dir = path.join(home, "x");
    expect(safeJoin(dir, "a/b.txt")).toBe(path.join(dir, "a", "b.txt"));
    expect(safeJoin(dir, "../b.txt")).toBeNull();
    expect(safeJoin(dir, "/etc/passwd")).toBeNull();
    expect(safeJoin(dir, "C:/Windows/x")).toBeNull();
  });
});

describe("logs", () => {
  it("never carry a token", () => {
    const token = "Q2xhdWRlIGRvZXMgbm90IGxvZyB0b2tlbnMgZXZlcg_abcdef";
    expect(redact(`Authorization: Bearer ${token}`)).not.toContain(token);
    expect(redact(`saved ${token}`)).not.toContain(token);
  });
});
