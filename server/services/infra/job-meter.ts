/**
 * job-meter.ts — which queue job a tool process belongs to, so its memory lands on that job's
 * telemetry row (doc/COMPUTE_ROUTING_PLAN.md 5.3).
 *
 * The queue runs each job inside `runInJobMeter`; the runners that start FoldX and P2Rank call
 * `meterChildProcess(child)`. AsyncLocalStorage carries the job's sampler through every await in
 * between, so nothing is threaded through the worker's signature. Outside a queue job (a script, a
 * test, a direct call) `meterChildProcess` does nothing.
 *
 * The queue reads `sampler.peakBytes` when the job ends, however it ends: an out-of-memory death or
 * a timeout is exactly the job whose memory most needs recording.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildProcess } from "node:child_process";
import type { ProcessTreeSampler } from "./process-sampler.ts";

const current = new AsyncLocalStorage<ProcessTreeSampler>();

/** Run `fn` with `sampler` as the current job's meter. */
export function runInJobMeter<T>(sampler: ProcessTreeSampler, fn: () => Promise<T>): Promise<T> {
  return current.run(sampler, fn);
}

/**
 * The meter of the job `fn` is running in, or undefined outside a job. For tests and the queue's own
 * bookkeeping (so a caller can settle the peak before it stops the sampler).
 */
export function currentJobMeter(): ProcessTreeSampler | undefined {
  return current.getStore();
}

/**
 * Run `fn`, and everything it schedules, outside any job's meter. For work a job starts but does not own
 * (a background repair outlives the job that asked for it): without this, AsyncLocalStorage would carry
 * the finished job's sampler into that work's timers and child processes, charging them to the wrong
 * row and keeping the sampler alive for as long as the work runs.
 */
export function runOutsideJobMeter<T>(fn: () => T): T {
  return current.exit(fn);
}

/** Count `child` (and everything it starts) toward the current job's memory, until it exits. */
export function meterChildProcess(child: ChildProcess | undefined): void {
  const sampler = current.getStore();
  if (!sampler || !child?.pid) return;
  const pid = child.pid;
  sampler.track(pid);
  // `exit` and `error` can both fire; untracking twice is harmless.
  const done = () => sampler.untrack(pid);
  child.once("exit", done);
  child.once("error", done);
}
