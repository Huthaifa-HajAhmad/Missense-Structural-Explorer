import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * First-use install for the gitignored GenCC and G2P snapshots.
 *
 * WHY: both are manual imports into `data/`, which is gitignored, so every other checkout, worktree
 * or fresh deployment silently reported "not installed" and the Gene–disease tab had no disease to
 * choose. A missing snapshot is now fetched once on first request.
 *
 * INVARIANTS
 *  - Lazy, never scheduled: nothing refreshes an installed snapshot (the owner's rule). Only a
 *    MISSING file triggers a download.
 *  - Single flight per target, so concurrent requests make one download (GenCC rate-limits).
 *  - A failed attempt is remembered for RETRY_AFTER_MS, measured from the moment the attempt
 *    fails, so a down source is not hammered; the caller reports the ordinary "not installed"
 *    state meanwhile.
 *  - The payload is fully validated by the caller's builder before it is written, and the write is
 *    atomic (temp file + rename), exactly like `npm run data:gencc` / `data:g2p`.
 *  - Off under test and when EVIDENCE_CONTEXT_AUTO_INSTALL=0 (air-gapped or read-only deployments).
 */
export const RETRY_AFTER_MS = 15 * 60 * 1000;
const flights = new Map<string, Promise<boolean>>();
const failedAt = new Map<string, number>();

export function autoInstallEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.EVIDENCE_CONTEXT_AUTO_INSTALL !== '0';
}

export async function writeSnapshotAtomically(target: string, snapshot: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try { await writeFile(temporary, JSON.stringify(snapshot) + '\n'); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
}

/** Resolves true when `build()` produced and wrote a snapshot at `target`. Never throws.
 *  `clock` is only injected by tests; production reads the wall clock. */
export function installOnce(target: string, build: () => Promise<unknown>, clock: () => number = Date.now): Promise<boolean> {
  if (!autoInstallEnabled()) return Promise.resolve(false);
  const running = flights.get(target); if (running) return running;
  // The retry window starts when the attempt fails, not when it starts: a slow failing build
  // must not shorten the backoff below RETRY_AFTER_MS.
  const failed = failedAt.get(target); if (failed !== undefined && clock() - failed < RETRY_AFTER_MS) return Promise.resolve(false);
  const flight = (async () => {
    try { await writeSnapshotAtomically(target, await build()); failedAt.delete(target); return true; }
    catch { failedAt.set(target, clock()); return false; }
  })().finally(() => { flights.delete(target); });
  flights.set(target, flight); return flight;
}
export function resetInstallState() { flights.clear(); failedAt.clear(); }
