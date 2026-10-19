/**
 * preemption.ts — background FoldX work that must give way to a person's job.
 *
 * FoldX runs one process at a time on the 2-vCPU server (`resolveFoldxConcurrency`), so background work
 * (`background-repair.ts`) holds the only slot while it runs. A job that arrives meanwhile would wait for
 * it, and waiting is not free: the semaphore wait is 120 s and a repair under Box64 runs 11 minutes. So
 * the interactive path calls {@link preemptBackgroundFoldx} before it waits, the background process is
 * killed through its abort signal, and the slot is free as soon as the child exits.
 *
 * Only the "shared" mode registers here. On a host with a spare core the repair runs beside jobs at nice 19
 * without the slot, and nothing needs preempting (`background-repair.ts`).
 *
 * A leaf module on purpose: `runner.ts` imports it, and `background-repair.ts` imports `runner.ts`.
 */

const running = new Map<symbol, { label: string; controller: AbortController }>();

export const PREEMPTED = "preempted by an interactive FoldX job";

/** Register one unit of background work. Call `release` when it ends, however it ends. */
export function registerPreemptible(label: string): { signal: AbortSignal; release: () => void } {
  const id = Symbol(label);
  const controller = new AbortController();
  running.set(id, { label, controller });
  return { signal: controller.signal, release: () => void running.delete(id) };
}

/** Ask every registered background task to stop; returns how many were asked. No-op when there are none. */
export function preemptBackgroundFoldx(): number {
  let asked = 0;
  for (const { label, controller } of running.values()) {
    if (controller.signal.aborted) continue;
    asked++;
    console.log(`[Background FoldX] Yielding the FoldX slot to an interactive job: stopping ${label}.`);
    controller.abort(new Error(PREEMPTED));
  }
  return asked;
}

export function backgroundFoldxRunning(): boolean {
  return running.size > 0;
}

/** Forget every registration: for test isolation, so a test that failed before `release` cannot leak into the next. */
export function resetPreemptionForTests(): void {
  running.clear();
}
