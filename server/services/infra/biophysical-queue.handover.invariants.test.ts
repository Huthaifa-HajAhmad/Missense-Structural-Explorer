import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ENDED_ELSEWHERE_CHECK_MS, SQLiteQueue } from "./biophysical-queue.ts";
import { onAgent, random, tableProblems } from "./queue-invariants.fixture.ts";

/**
 * Two server processes share one queue file during a blue/green deploy (doc/STATE_MACHINES.md,
 * section 10). This test follows the rollout's rules (`deploy/rollout.py`): only one process is active;
 * a handover pauses the active one, waits until it has no running job, then resumes the other; a
 * rollback does the same the other way. Between those steps it submits through either process, finishes
 * and fails jobs, cancels them, and lets a paired computer claim and finish its owner's jobs. After
 * every step the table rules hold, and no job is ever running in both processes at once.
 */

const SEEDS = Number(process.env.QUEUE_INVARIANT_SEEDS) || 5;
const STEPS = 60;
const CONCURRENCY = 2;
const HOST = { peakRssBytes: null, toolVersion: "v", wallMs: 10, hostId: "agent:A1", hostClass: "agent/x" } as any;
const WEIGHTS: Record<string, number> = { add: 8, tick: 3, finish: 4, crash: 1, cancel: 2, claim: 3, agentDone: 2, handover: 2 };

class TwoProcesses {
  readonly queues: SQLiteQueue[];
  /** Which process is serving; the other is paused (or draining before it hands over). */
  active = 0;
  /** Set while the active process is paused and draining; the switch happens once it is empty. */
  draining = false;
  readonly executing = new Map<string, number>();
  readonly settle = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  readonly seen = new Map<string, string>();
  readonly overlaps: string[] = [];
  readonly trail: string[] = [];
  private count = 0;

  constructor(file: string, readonly rand: () => number) {
    this.queues = [this.make(file, 0, false), this.make(file, 1, true)];
  }

  private make(file: string, index: number, paused: boolean): SQLiteQueue {
    return new SQLiteQueue(file, CONCURRENCY, (_t, data, signal) => new Promise((resolve, reject) => {
      const other = this.executing.get(data.name);
      if (other !== undefined) this.overlaps.push(`${data.name} started in process ${index} while running in process ${other}`);
      this.executing.set(data.name, index);
      const done = () => this.executing.delete(data.name);
      this.settle.set(data.name, { resolve: (v) => { done(); resolve(v); }, reject: (e) => { done(); reject(e); } });
      signal?.addEventListener("abort", () => { done(); reject(new Error("aborted")); }, { once: true });
    }), paused);
  }

  pick<T>(xs: T[]): T { return xs[Math.floor(this.rand() * xs.length)]; }
  nextOp(): string { return this.pick(Object.entries(WEIGHTS).flatMap(([name, n]) => Array<string>(n).fill(name))); }
  get db(): any { return (this.queues[0] as any).db; }
  jobId(): string { return this.pick(this.db.prepare("SELECT id FROM biophysical_jobs").all().map((r: any) => r.id).concat(["none"])); }

  readonly ops: Record<string, () => Promise<string> | string> = {
    add: async () => {
      const id = `j${++this.count}`;
      const via = this.pick([0, 1]);
      await this.queues[via].addJob(id, "foldx", { name: id }, { ownerId: this.pick(["U1", "U2"]), placement: this.rand() < 0.3 ? "agent:A1" : null });
      return `add ${id} via ${via}`;
    },
    tick: async () => { await vi.advanceTimersByTimeAsync(Math.floor(this.rand() * 40_000)); return "tick"; },
    finish: () => this.end("resolve"),
    crash: () => this.end("reject"),
    cancel: () => { const id = this.jobId(); this.pick(this.queues).cancelFor(id, "ADMIN", true); return `cancel ${id}`; },
    claim: () => `claim ${this.pick(this.queues).claimForAgent({ agentId: "A1", userId: "U1" }, ["foldx"], () => true, 60_000)?.id}`,
    agentDone: () => {
      const row = this.db.prepare("SELECT id FROM biophysical_jobs WHERE status = 'running' AND claimed_by = 'agent:A1' LIMIT 1").get();
      if (row) this.pick(this.queues).completeAgentJob(row.id, "A1", { status: "ok" }, HOST);
      return `agentDone ${row?.id}`;
    },
    handover: () => this.handover(),
  };

  /** One step of the rollout: start draining the active process, or switch once it has drained. */
  private handover(): string {
    const from = this.queues[this.active];
    if (!this.draining) {
      from.pauseProcessing();
      this.draining = true;
      return `pause ${this.active}`;
    }
    if (from.activeCount > 0) return `still draining ${this.active}`;
    this.active = 1 - this.active;
    this.queues[this.active].resumeProcessing();
    this.draining = false;
    return `resume ${this.active}`;
  }

  private async end(how: "resolve" | "reject"): Promise<string> {
    const name = this.pick([...this.settle.keys(), "none"]);
    const waiting = this.settle.get(name);
    if (waiting) {
      this.settle.delete(name);
      if (how === "resolve") waiting.resolve({ status: "ok" });
      else waiting.reject(new Error("boom"));
      await vi.advanceTimersByTimeAsync(5);
    }
    return `${how} ${name}`;
  }

  problems(): string[] {
    const problems = [...tableProblems(this.db, this.seen), ...this.overlaps];
    const rows = this.db.prepare("SELECT * FROM biophysical_jobs WHERE status = 'running'").all() as any[];
    const serverRunning = rows.filter((j) => !onAgent(j.claimed_by)).length;
    const active = this.queues.reduce((n, q) => n + q.activeCount, 0);
    if (serverRunning !== active) problems.push(`${serverRunning} server rows running but ${active} active across both processes`);
    const paused = this.queues.filter((q) => !q.paused).length;
    if (paused > 1) problems.push("both processes are serving at once");
    return problems;
  }
}

describe("job queue invariants across a blue/green handover", () => {
  afterEach(() => vi.useRealTimers());

  it.each(Array.from({ length: SEEDS }, (_, i) => i + 1))("seed %i keeps every rule with two processes", async (seed) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-queue-handover-"));
    const h = new TwoProcesses(path.join(dir, "jobs.sqlite"), random(seed));
    try {
      for (let step = 0; step < STEPS; step++) {
        h.trail.push(await h.ops[h.nextOp()]());
        await vi.advanceTimersByTimeAsync(60);
        // A cancel that reached the other process is honoured within one check by the running process.
        if (h.problems().length > 0) await vi.advanceTimersByTimeAsync(ENDED_ELSEWHERE_CHECK_MS + 100);
        expect(h.problems(), `after ${h.trail.slice(-8).join(" | ")}`).toEqual([]);
      }
    } finally {
      h.queues.forEach((q) => q.shutdown());
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
