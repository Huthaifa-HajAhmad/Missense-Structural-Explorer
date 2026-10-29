/**
 * background-repair.ts — repair a template in the idle time after a job that had to go without one.
 *
 * WHY. Under Box64 a RepairPDB takes minutes and is a function of the STRUCTURE (`cache.ts`), not of the
 * substitution. 6N7E (305 residues, 44 incomplete) needs 660 s against the interactive 420 s cap, so
 * `repairFitsBudget` skips it and every variant on that template pays BuildModel's own completion of the
 * 44 side chains (214 s). A repaired template makes the same BuildModel 7.5 s. Each later variant saves
 * about 206 s, so the 660 s repair is recovered after about four variants following the one that triggered
 * it (the fifth overall); this module spends it when the server would otherwise sit idle.
 *
 * WHEN. After a job reports `foldxRepairSkipped` (the worker calls
 * {@link requestBackgroundRepair}). That is demand-triggered: a structure nobody queried is never repaired,
 * including AlphaFold models and larger structures when the background budget permits.
 *
 * WHAT IT MUST NOT DO: slow or fail a person's job. How it avoids that depends on the host:
 *
 *   SPARE CORE (more cores than FoldX slots; the OCI host has 2 vCPU and 1 slot). FoldX is single-threaded,
 *   so one core is free while a job runs. The repair runs there at nice 19, outside the FoldX slot, and is
 *   not preempted: it does not wait for an idle server, so it also happens during continuous use.
 *   Measured on that host (2026-10-18, n = 3): interactive BuildModels 1.5-2.6% slower beside it, and the
 *   repair still got 96% of a core. Background repairs run one at a time, so a job never competes with two.
 *
 *   SHARED (no spare core). The repair would hold the only slot, so it starts only when the FoldX slot has
 *   been idle for `quietPolls` polls, and it registers as preemptible: the interactive path (`runner.ts`)
 *   stops it before a job would wait. After `MAX_PREEMPTIONS` it leaves the structure to a later request.
 *
 * Either way it runs in its own directory with its own cap (`backgroundRepairBudgetMs`), outside the 900 s
 * job cap and the nest ordering in `server/tests/foldx-timeout-budget.test.ts`; gives up after one failure
 * and does not retry for `GIVE_UP_COOLDOWN_MS`; never throws to its caller; and is off with
 * `FOLDX_BACKGROUND_REPAIR=false`.
 *
 * Its product is the same repair-cache entry an interactive repair writes (`repairTemplateOnly`), keyed by
 * structure and FoldX conditions, so conditions are taken from the job that asked: a different pH,
 * temperature or ionic strength is a different entry, as it must be.
 */
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { CONFIG, resolveFoldxConcurrency } from "../../../config.ts";
import { runOutsideJobMeter } from "../../infra/job-meter.ts";
import { parseResiduesFromPdbMaybeAsync } from "../../structure/pdb-parser.ts";
import { backgroundRepairBudgetMs, backgroundRepairEstimateMs } from "./budget.ts";
import { announceInflightRepair } from "./inflight-repairs.ts";
import { getRepairCacheKey, getRepairedStructureFromCache } from "./cache.ts";
import { cleanPdbForFoldX, countIncompleteResidues } from "./pdb-utils.ts";
import { foldxRunsEmulated } from "./estimate.ts";
import { PREEMPTED, registerPreemptible } from "./preemption.ts";
import { biophysicalSemaphore, repairTemplateOnly, type BackgroundRepairSlot, type FoldxOptions } from "./runner.ts";

export const BACKGROUND_REPAIR_ENV = "FOLDX_BACKGROUND_REPAIR";
/** After this many preemptions the structure is left to the next request: the server is too busy to finish it. */
export const MAX_PREEMPTIONS = 3;
/** After giving up (a failure, or too many preemptions) a structure is not tried again for this long. */
export const GIVE_UP_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_TRACKED = 200;

export type BackgroundRepairState = "waiting" | "running" | "done" | "gave-up";

export interface BackgroundRepairEntry {
  key: string;
  label: string;
  state: BackgroundRepairState;
  /** How it gets CPU (see the module comment). */
  slot: BackgroundRepairSlot;
  emulated: boolean;
  residues: number;
  incompleteResidues: number;
  budgetMs: number;
  requestedAt: number;
  preemptions: number;
  /** Why it is in this state, for the log and for whoever asks. */
  detail?: string;
  /** When a "gave-up" entry may be requested again. */
  retryAfter?: number;
}

export type BackgroundRepairRequestResult =
  | { status: "scheduled"; finished: Promise<void> }
  | { status: "disabled" | "ineligible" | "cached" | "already-known"; reason: string };

export interface BackgroundRepairRequest {
  wtPdb: string;
  /** The conditions of the job that asked (they are part of the repair-cache key). */
  options?: FoldxOptions;
  /** What the log calls it, e.g. "CNNM2 p.Ser489Cys". */
  label?: string;
}

export interface BackgroundRepairDeps {
  enabled(): boolean;
  emulated(): boolean;
  /** "spare-core" when the host has more cores than FoldX slots (see the module comment). */
  slot(): BackgroundRepairSlot;
  isIdle(): boolean;
  repair: typeof repairTemplateOnly;
  isCached(key: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
  tempRoot(): string;
  pollMs: number;
  quietPolls: number;
  /** How long a request waits for an idle server before it gives up. */
  maxWaitMs: number;
}

export function backgroundRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env[BACKGROUND_REPAIR_ENV] ?? "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  // Test environments never start FoldX unprompted, as with the speculative pre-warm.
  return flag === "true" || env.NODE_ENV !== "test";
}

export const BACKGROUND_REPAIR_SLOT_ENV = "FOLDX_BACKGROUND_REPAIR_SLOT";

/**
 * More cores than FoldX processes allowed at once: a core is free beside every job. The core count is the
 * runtime's view of the host, which may not honour a container CPU quota, so `FOLDX_BACKGROUND_REPAIR_SLOT`
 * (`spare-core` | `shared`) overrides the inference when the operator knows better.
 */
export function backgroundRepairSlot(
  cores = os.availableParallelism?.() ?? os.cpus().length,
  foldxSlots = resolveFoldxConcurrency(),
  env: NodeJS.ProcessEnv = process.env
): BackgroundRepairSlot {
  const forced = (env[BACKGROUND_REPAIR_SLOT_ENV] ?? "").trim().toLowerCase();
  if (forced === "spare-core" || forced === "shared") return forced;
  return cores > foldxSlots ? "spare-core" : "shared";
}

const defaultDeps: BackgroundRepairDeps = {
  enabled: () => backgroundRepairEnabled(),
  emulated: () => foldxRunsEmulated(),
  slot: () => backgroundRepairSlot(),
  isIdle: () => biophysicalSemaphore.isIdle(),
  repair: repairTemplateOnly,
  isCached: async key => Boolean(await getRepairedStructureFromCache(key)),
  sleep: ms => new Promise<void>(resolve => setTimeout(resolve, ms).unref?.()),
  now: () => Date.now(),
  tempRoot: () => path.join(process.cwd(), "temp_jobs"),
  pollMs: 30_000,
  quietPolls: 2,
  maxWaitMs: 6 * 60 * 60 * 1000
};

const entries = new Map<string, BackgroundRepairEntry>();
/**
 * Keys whose request is between its duplicate check and `remember`. Taken synchronously, before the first
 * await, so two jobs on one structure finishing together cannot both pass the check and start two repairs.
 */
const deciding = new Set<string>();

/** What the background repairer knows, newest last. For diagnostics and tests. */
export function backgroundRepairStatus(): BackgroundRepairEntry[] {
  return [...entries.values()].map(entry => ({ ...entry }));
}

export function resetBackgroundRepairForTests(): void {
  entries.clear();
  deciding.clear();
}

function remember(entry: BackgroundRepairEntry): void {
  entries.delete(entry.key);
  entries.set(entry.key, entry);
  for (const [key, old] of entries) {
    if (entries.size <= MAX_TRACKED) break;
    // Only finished entries are forgotten: dropping a waiting or running one would let the next request
    // for that structure start a second repair beside it.
    if (old.state === "done" || old.state === "gave-up") entries.delete(key);
  }
}

function anotherIsRunning(self: BackgroundRepairEntry): boolean {
  for (const entry of entries.values()) if (entry !== self && entry.state === "running") return true;
  return false;
}

/**
 * Ask for a template to be repaired when the server is idle. Returns at once; the work is `finished` later.
 * Never throws: a request is a hint, and the job that made it has already succeeded without it.
 */
export async function requestBackgroundRepair(
  request: BackgroundRepairRequest,
  deps: BackgroundRepairDeps = defaultDeps
): Promise<BackgroundRepairRequestResult> {
  try {
    if (!deps.enabled()) return { status: "disabled", reason: `${BACKGROUND_REPAIR_ENV} is off` };

    const cleaned = cleanPdbForFoldX(request.wtPdb);
    const key = getRepairCacheKey(crypto.createHash("sha256").update(cleaned).digest("hex"), request.options);

    const known = entries.get(key);
    if (known && (known.state === "waiting" || known.state === "running")) return { status: "already-known", reason: known.state };
    if (known?.state === "gave-up" && deps.now() < (known.retryAfter ?? 0)) return { status: "already-known", reason: known.detail ?? "gave up recently" };
    if (deciding.has(key)) return { status: "already-known", reason: "another request for this structure is being decided" };
    deciding.add(key);
    try {
      return await decide(key, cleaned, request, deps);
    } finally {
      deciding.delete(key);
    }
  } catch (err: any) {
    console.warn("[Background Repair] Request ignored:", err?.message ?? err);
    return { status: "ineligible", reason: err?.message ?? "request failed" };
  }
}

/** The part of a request that awaits: cache, size and budget checks, then the entry. Runs under `deciding`. */
async function decide(
  key: string,
  cleaned: string,
  request: BackgroundRepairRequest,
  deps: BackgroundRepairDeps
): Promise<BackgroundRepairRequestResult> {
  if (await deps.isCached(key)) return { status: "cached", reason: "the repaired template is already cached" };

  const residues = (await parseResiduesFromPdbMaybeAsync(request.wtPdb)).length;
  const incompleteResidues = countIncompleteResidues(cleaned);
  if (residues === 0) {
    return { status: "ineligible", reason: `no residues to repair` };
  }
  const emulated = deps.emulated();
  const budgetMs = backgroundRepairBudgetMs({ residueCount: residues, incompleteResidues, emulated });
  if (budgetMs === null) {
    return { status: "ineligible", reason: `${residues} residues with ${incompleteResidues} incomplete would outlast ${CONFIG.timeouts.foldxBackgroundRepairMaxMs / 1000} s` };
  }

  const entry: BackgroundRepairEntry = {
    key, label: request.label ?? key.slice(0, 24), state: "waiting", slot: deps.slot(), emulated, residues, incompleteResidues, budgetMs,
    requestedAt: deps.now(), preemptions: 0
  };
  remember(entry);
  console.log(`[Background Repair] ${entry.label}: queued (${entry.slot === "spare-core" ? "spare core, nice 19" : "waits for an idle FoldX slot"}; ${residues} residues, ${incompleteResidues} incomplete, up to ${(budgetMs / 1000).toFixed(0)} s).`);
  // The job that asked is finishing; the repair is not its work (see runOutsideJobMeter).
  return { status: "scheduled", finished: runOutsideJobMeter(() => drive(entry, request, deps)) };
}

function giveUp(entry: BackgroundRepairEntry, detail: string, deps: BackgroundRepairDeps): void {
  entry.state = "gave-up";
  entry.detail = detail;
  entry.retryAfter = deps.now() + GIVE_UP_COOLDOWN_MS;
  console.warn(`[Background Repair] ${entry.label}: giving up (${detail}).`);
}

async function drive(entry: BackgroundRepairEntry, request: BackgroundRepairRequest, deps: BackgroundRepairDeps): Promise<void> {
  try {
    const deadline = deps.now() + deps.maxWaitMs;
    let quiet = 0;
    while (deps.now() < deadline) {
      await deps.sleep(deps.pollMs);
      if (await deps.isCached(entry.key)) {
        entry.state = "done";
        entry.detail = "cached by another job";
        return;
      }
      if (!deps.enabled()) return giveUp(entry, `${BACKGROUND_REPAIR_ENV} turned off`, deps);
      if (anotherIsRunning(entry)) { quiet = 0; continue; }
      if (entry.slot === "shared") {
        if (!deps.isIdle()) { quiet = 0; continue; }
        if (++quiet < deps.quietPolls) continue;
        quiet = 0;
      }
      if (await runOnce(entry, request, deps)) return;
    }
    giveUp(entry, "no idle window before the deadline", deps);
  } catch (err: any) {
    giveUp(entry, `unexpected error: ${err?.message ?? err}`, deps);
  }
}

/** One attempt. True when the entry has reached a final state; false to keep waiting for another idle window. */
async function runOnce(entry: BackgroundRepairEntry, request: BackgroundRepairRequest, deps: BackgroundRepairDeps): Promise<boolean> {
  // Only work that holds the FoldX slot yields it; on a spare core there is nothing to give back.
  const handle = entry.slot === "shared" ? registerPreemptible(`background repair of ${entry.label}`) : null;
  const signal = handle?.signal;
  const jobDir = path.join(deps.tempRoot(), `bg-repair-${crypto.randomUUID()}`);
  entry.state = "running";
  const startedAt = deps.now();
  // On a spare core, a job on this structure may wait for this repair rather than rebuild the side chains
  // itself (runner.ts, joinInflightRepair). Settled after the repaired template is in the cache.
  const settleInflight = entry.slot === "spare-core"
    ? announceInflightRepair(entry.key, startedAt, startedAt + backgroundRepairEstimateMs({ residueCount: entry.residues, incompleteResidues: entry.incompleteResidues, emulated: entry.emulated }))
    : null;
  try {
    console.log(`[Background Repair] ${entry.label}: starting RepairPDB (${entry.slot === "spare-core" ? "spare core, nice 19" : "FoldX slot idle"}).`);
    const diagnostic = await deps.repair(request.wtPdb, jobDir, request.options, entry.budgetMs, { slot: entry.slot, signal });
    if (diagnostic.outcome === "completed" || diagnostic.outcome === "reused") {
      entry.state = "done";
      entry.detail = `${diagnostic.outcome} in ${((deps.now() - startedAt) / 1000).toFixed(0)} s`;
      console.log(`[Background Repair] ${entry.label}: ${entry.detail}; later runs on this structure skip RepairPDB.`);
      return true;
    }
    console.error("[Background Repair Failure Context]:", JSON.stringify({ label: entry.label, ...diagnostic }));
    giveUp(entry, `RepairPDB ${diagnostic.outcome}`, deps);
    return true;
  } catch (err: any) {
    if (handle?.signal.aborted) {
      entry.preemptions++;
      console.log(`[Background Repair] ${entry.label}: ${PREEMPTED} after ${((deps.now() - startedAt) / 1000).toFixed(0)} s (${entry.preemptions}/${MAX_PREEMPTIONS}).`);
      if (entry.preemptions >= MAX_PREEMPTIONS) { giveUp(entry, "preempted too often to finish", deps); return true; }
      entry.state = "waiting";
      return false;
    }
    if (/Timeout acquiring|Concurrency limit/i.test(err?.message ?? "")) { entry.state = "waiting"; return false; }
    giveUp(entry, `error: ${err?.message ?? err}`, deps);
    return true;
  } finally {
    handle?.release();
    settleInflight?.();
    fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
