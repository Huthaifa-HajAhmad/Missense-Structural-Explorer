import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { SQLiteQueue } from "./biophysical-queue.ts";
import { onAgent, random, tableProblems } from "./queue-invariants.fixture.ts";

/**
 * The job queue is a state machine (doc/STATE_MACHINES.md, section 1). This test drives it with random
 * operations from a fixed seed (submit, claim by a paired computer, finish, give back, cancel, expire a
 * lease, restart the process) and checks the rules that must hold after every step.
 */

const SEEDS = Number(process.env.QUEUE_INVARIANT_SEEDS) || 5;
const STEPS = 60;
const CONCURRENCY = 2;
const HOST = { peakRssBytes: null, toolVersion: "v", wallMs: 10, hostId: "agent:A1", hostClass: "agent/x" } as any;
/** How often each operation is tried. Submitting and claiming come up most, so the rules are met in busy states. */
const WEIGHTS: Record<string, number> = {
  add: 8, claim: 6, tick: 2, longWait: 1, finish: 2, crash: 1, renew: 2, agentDone: 3, agentFail: 3,
  disconnect: 1, cancel: 2, adminCancel: 1, cancelAll: 1, release: 1, restart: 1,
};

class Harness {
  q!: SQLiteQueue;
  pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  seen = new Map<string, string>();
  trail: string[] = [];
  private count = 0;
  constructor(readonly file: string, readonly rand: () => number) { this.boot(); }

  boot() {
    this.q = new SQLiteQueue(this.file, CONCURRENCY, (_t, data, signal) => new Promise((resolve, reject) => {
      this.pending.set(data.name, { resolve, reject });
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
  }
  get db(): any { return (this.q as any).db; }
  pick<T>(xs: T[]): T { return xs[Math.floor(this.rand() * xs.length)]; }
  nextOp(): string { return this.pick(Object.entries(WEIGHTS).flatMap(([name, n]) => Array<string>(n).fill(name))); }
  /** A job to act on: usually one a computer is running (so the agent steps do something), sometimes any, sometimes none. */
  jobId(): string {
    const mine = this.db.prepare("SELECT id FROM biophysical_jobs WHERE status = 'running' AND claimed_by = 'agent:A1'").all().map((r: any) => r.id);
    const all = this.db.prepare("SELECT id FROM biophysical_jobs").all().map((r: any) => r.id);
    return this.pick(mine.length > 0 && this.rand() < 0.7 ? mine : all.concat(["none"]));
  }

  problems(): string[] {
    const rows = this.db.prepare("SELECT * FROM biophysical_jobs").all() as any[];
    const problems = tableProblems(this.db, this.seen);
    const serverRunning = rows.filter((j) => j.status === "running" && !onAgent(j.claimed_by)).length;
    const internals = this.q as any;
    if (internals.runningCount !== internals.activeJobs.size) problems.push("runningCount differs from activeJobs");
    if (internals.runningCount > CONCURRENCY) problems.push(`${internals.runningCount} jobs running with a limit of ${CONCURRENCY}`);
    if (serverRunning !== internals.activeJobs.size) problems.push(`${serverRunning} server rows running but ${internals.activeJobs.size} active`);
    return problems;
  }

  /** Each entry is one operation; it returns a short description for the trail. */
  readonly ops: Record<string, () => Promise<string> | string> = {
    add: async () => {
      const id = `j${++this.count}`;
      const placement = this.rand() < 0.5 ? "agent:A1" : null;
      await this.q.addJob(id, this.pick(["foldx", "p2rank"] as const), { name: id }, { ownerId: this.rand() < 0.7 ? "U1" : "U2", placement });
      return `add ${id} ${placement}`;
    },
    tick: async () => { await vi.advanceTimersByTimeAsync(Math.floor(this.rand() * 40_000)); return "tick"; },
    longWait: async () => { await vi.advanceTimersByTimeAsync(Math.floor(this.rand() * 3_000_000)); return "longWait"; },
    finish: async () => this.settle("resolve"),
    crash: async () => this.settle("reject"),
    claim: () => `claim ${this.q.claimForAgent({ agentId: "A1", userId: "U1" }, ["foldx", "p2rank"], () => true, 60_000)?.id}`,
    renew: () => { const id = this.jobId(); this.q.renewAgentLease(id, "A1", this.rand() < 0.2 ? 900_000 : 60_000); return `renew ${id}`; },
    agentDone: () => { const id = this.jobId(); this.q.completeAgentJob(id, "A1", { status: "ok" }, HOST); return `agentDone ${id}`; },
    agentFail: () => {
      const id = this.jobId();
      this.q.requeueAgentJobToServer(id, "A1", { outcome: "requeued", telemetry: "failed", errorClass: "x", host: HOST });
      return `agentFail ${id}`;
    },
    disconnect: () => { this.q.reapAgentLeases(Date.now(), "A1"); return "disconnect"; },
    cancel: () => { const id = this.jobId(); this.q.cancelFor(id, this.pick(["U1", "U2"]), false); return `cancel ${id}`; },
    adminCancel: () => { const id = this.jobId(); this.q.cancelFor(id, "ADMIN", true); return `adminCancel ${id}`; },
    cancelAll: () => { this.q.cancelAllFor("U1"); return "cancelAll"; },
    release: () => { this.q.releasePlacementsOf(() => this.rand() < 0.5, 0); return "release"; },
    restart: () => { this.q.shutdown(); this.pending.clear(); this.boot(); return "restart"; },
  };

  private async settle(how: "resolve" | "reject"): Promise<string> {
    const name = this.pick([...this.pending.keys(), "none"]);
    const waiting = this.pending.get(name);
    if (waiting) {
      this.pending.delete(name);
      if (how === "resolve") waiting.resolve({ status: "ok" });
      else waiting.reject(new Error("boom"));
      await vi.advanceTimersByTimeAsync(5);
    }
    return `${how} ${name}`;
  }
}

describe("job queue invariants under random operations", () => {
  afterEach(() => vi.useRealTimers());

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))("seed %i keeps every rule after every step", async (seed) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-queue-invariants-"));
    const h = new Harness(path.join(dir, "jobs.sqlite"), random(seed));
    try {
      for (let step = 0; step < STEPS; step++) {
        h.trail.push(await h.ops[h.nextOp()]());
        await vi.advanceTimersByTimeAsync(60);
        expect(h.problems(), `after ${h.trail.slice(-8).join(" | ")}`).toEqual([]);
      }
    } finally {
      h.q.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
