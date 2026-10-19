/**
 * inflight-repairs.ts — background repairs that are running right now, so a job on the same structure can
 * wait for one instead of rebuilding the same side chains itself.
 *
 * `background-repair.ts` announces a repair it starts on a spare core, with when its envelope says it will
 * end; `runner.ts` looks it up when it would otherwise skip RepairPDB for its cost. A leaf module, like
 * `preemption.ts`, because `background-repair.ts` imports `runner.ts`.
 */

export interface InflightRepair {
  startedAt: number;
  /** When the repair envelope (`predictedRepairMs`) says it ends. The envelope over-predicts, so usually later than the truth. */
  expectedEndAt: number;
  /** Settles when the repair ends, however it ends. Never rejects. */
  done: Promise<void>;
}

const inflight = new Map<string, InflightRepair>();

/** Announce a running repair under its repair-cache key. Call the returned function when it ends. */
export function announceInflightRepair(key: string, startedAt: number, expectedEndAt: number): () => void {
  let settle!: () => void;
  const done = new Promise<void>(resolve => { settle = resolve; });
  const entry: InflightRepair = { startedAt, expectedEndAt, done };
  inflight.set(key, entry);
  return () => {
    if (inflight.get(key) === entry) inflight.delete(key);
    settle();
  };
}

export function inflightRepair(key: string): InflightRepair | null {
  return inflight.get(key) ?? null;
}

/** Grace past the envelope's end: the envelope is an upper bound, so this is only for a busier host than measured. */
export const JOIN_GRACE_MS = 30_000;

/**
 * How long a job should wait for an in-flight repair, or 0 when it should not wait.
 *
 * It waits only when the repair should end before the job could finish unrepaired (`unrepairedExtraMs`:
 * the side-chain completion a repaired template saves), and never longer than that saving, so a repair
 * that overruns costs the job at most what waiting could have saved. The wait also leaves the job the
 * time its unrepaired fallback needs (`jobRemainingMs - fallbackMs`).
 */
export function joinWaitMs(input: {
  now: number;
  expectedEndAt: number;
  unrepairedExtraMs: number;
  jobRemainingMs: number;
  fallbackMs: number;
}): number {
  const remaining = Math.max(0, input.expectedEndAt - input.now);
  if (remaining >= input.unrepairedExtraMs) return 0;
  const wait = Math.min(input.unrepairedExtraMs, remaining + JOIN_GRACE_MS, input.jobRemainingMs - input.fallbackMs);
  return wait > 0 ? Math.round(wait) : 0;
}

/** Forget every announcement: for test isolation, so a test that failed before settling cannot leak into the next. */
export function resetInflightRepairsForTests(): void {
  inflight.clear();
}
