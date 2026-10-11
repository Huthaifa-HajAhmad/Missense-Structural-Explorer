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
