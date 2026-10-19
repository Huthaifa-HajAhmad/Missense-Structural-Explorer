import os from "os";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GIVE_UP_COOLDOWN_MS,
  MAX_PREEMPTIONS,
  backgroundRepairEnabled,
  backgroundRepairSlot,
  backgroundRepairStatus,
  requestBackgroundRepair,
  resetBackgroundRepairForTests,
  type BackgroundRepairDeps
} from "./background-repair.ts";
import { backgroundFoldxRunning, preemptBackgroundFoldx, resetPreemptionForTests } from "./preemption.ts";
import { inflightRepair, resetInflightRepairsForTests } from "./inflight-repairs.ts";
import { currentJobMeter, runInJobMeter } from "../../infra/job-meter.ts";
import type { FoldxRepairDiagnostic } from "./failure.ts";

/**
 * Four residues, each with a CA only (so every one counts as incomplete). `marker` makes the structure unique
 * through its coordinates: `cleanPdbForFoldX` drops REMARK lines, so a marker there would not change the key.
 */
function structure(marker: string): string {
  const shift = [...marker].reduce((sum, c, i) => sum + c.charCodeAt(0) * (i + 1), 0) % 997 / 10;
  const rows = [["ALA", 3], ["GLY", 4], ["ALA", 5], ["SER", 6]] as const;
  const atoms = rows.map(([name, seq], i) =>
    "ATOM  " + String(i + 1).padStart(5) + "  CA  " + name + " A" + String(seq).padStart(4) + "    " +
    (seq * 1.1 + shift).toFixed(3).padStart(8) + (seq * 0.7).toFixed(3).padStart(8) + (seq * 0.3).toFixed(3).padStart(8) + "  1.00 20.00");
  return ["HEADER    EXPERIMENTAL STRUCTURE", `REMARK   99 ${marker}`, ...atoms, "TER", "END"].join("\n");
}

const COMPLETED: FoldxRepairDiagnostic = { outcome: "completed" };

interface Harness {
  deps: BackgroundRepairDeps;
  clock: { ms: number };
  repairCalls: number;
  idle: boolean | (() => boolean);
  cached: boolean;
  repairImpl: (signal: AbortSignal) => Promise<FoldxRepairDiagnostic>;
  sleeps: number;
  slots: string[];
}

function harness(): Harness {
  const h: Harness = {
    clock: { ms: 0 },
    repairCalls: 0,
    idle: true,
    cached: false,
    repairImpl: async () => COMPLETED,
    sleeps: 0,
    slots: [],
    deps: undefined as unknown as BackgroundRepairDeps
  };
  h.deps = {
    enabled: () => true,
    slot: () => "shared",
    isIdle: () => (typeof h.idle === "function" ? h.idle() : h.idle),
    repair: async (_pdb, _dir, _opts, _budget, run) => {
      h.repairCalls++;
      h.slots.push(run.slot);
      return h.repairImpl(run.signal ?? new AbortController().signal);
    },
    isCached: async () => h.cached,
    sleep: async ms => { h.sleeps++; h.clock.ms += ms; },
    now: () => h.clock.ms,
    tempRoot: () => os.tmpdir(),
    pollMs: 30_000,
    quietPolls: 2,
    maxWaitMs: 60 * 60 * 1000
  };
  return h;
}

async function scheduled(h: Harness, pdb: string) {
  const result = await requestBackgroundRepair({ wtPdb: pdb, label: "test" }, h.deps);
  if (result.status !== "scheduled") throw new Error(`not scheduled: ${result.status} (${result.reason})`);
  await result.finished;
}

beforeEach(() => {
  resetBackgroundRepairForTests();
  resetPreemptionForTests();
  resetInflightRepairsForTests();
});

describe("requestBackgroundRepair under concurrent requests", () => {
  it("starts one repair when two jobs on one structure ask at the same moment", async () => {
    const h = harness();
    // A slow cache check is where the two requests used to overlap: both passed the duplicate check.
    h.deps.isCached = () => new Promise(resolve => setTimeout(() => resolve(false), 5));
    const pdb = structure("simultaneous");
    const [a, b] = await Promise.all([requestBackgroundRepair({ wtPdb: pdb }, h.deps), requestBackgroundRepair({ wtPdb: pdb }, h.deps)]);
    expect([a.status, b.status].sort()).toEqual(["already-known", "scheduled"]);
    await Promise.all([a, b].map(r => (r.status === "scheduled" ? r.finished : undefined)));
    expect(h.repairCalls).toBe(1);
    expect(backgroundRepairStatus()).toHaveLength(1);
  });

  it("does not charge the repair to the job that asked for it", async () => {
    const h = harness();
    let meterDuringRepair: unknown = "unset";
    h.repairImpl = async () => {
      meterDuringRepair = currentJobMeter();
      return COMPLETED;
    };
    const sampler = { track() {}, untrack() {} } as unknown as Parameters<typeof runInJobMeter>[0];
    await runInJobMeter(sampler, async () => {
      expect(currentJobMeter()).toBe(sampler);
      await scheduled(h, structure("metered-job"));
    });
    expect(meterDuringRepair).toBeUndefined();
  });
});

describe("requestBackgroundRepair, shared slot (no spare core)", () => {
  it("repairs once the server has been idle for the quiet period, then records it as done", async () => {
    const h = harness();
    await scheduled(h, structure("done"));
    expect(h.repairCalls).toBe(1);
    expect(backgroundRepairStatus()[0]).toMatchObject({ state: "done", incompleteResidues: 4, residues: 4 });
    expect(backgroundFoldxRunning(), "the preemption registration must be released").toBe(false);
  });

  it("does not start while the FoldX slot is busy, and needs two idle polls in a row", async () => {
    const h = harness();
    let polls = 0;
    h.idle = () => ++polls > 3 && polls !== 5; // busy x3, idle, busy again, then idle x2
    await scheduled(h, structure("busy"));
    expect(h.repairCalls).toBe(1);
    expect(h.sleeps).toBe(7); // busy x3, idle, busy again (the quiet count resets), idle x2
  });

  it("gives up with a deadline rather than waiting forever on a server that is never idle", async () => {
    const h = harness();
    h.idle = false;
    await scheduled(h, structure("never-idle"));
    expect(h.repairCalls).toBe(0);
    expect(backgroundRepairStatus()[0]).toMatchObject({ state: "gave-up", detail: "no idle window before the deadline" });
  });

  it("yields to an interactive job, waits for the next idle window, and stops after MAX_PREEMPTIONS", async () => {
    const h = harness();
    h.repairImpl = async signal => {
      expect(backgroundFoldxRunning()).toBe(true);
      preemptBackgroundFoldx(); // what runner.ts does before an interactive job waits for the slot
      signal.throwIfAborted();
      return COMPLETED;
    };
    await scheduled(h, structure("preempted"));
    expect(h.repairCalls).toBe(MAX_PREEMPTIONS);
    expect(backgroundRepairStatus()[0]).toMatchObject({ state: "gave-up", preemptions: MAX_PREEMPTIONS });
  });

  it("finishes after a preemption when the next window is long enough", async () => {
    const h = harness();
    h.repairImpl = async signal => {
      if (h.repairCalls === 1) { preemptBackgroundFoldx(); signal.throwIfAborted(); }
      return COMPLETED;
    };
    await scheduled(h, structure("preempted-once"));
    expect(h.repairCalls).toBe(2);
    expect(backgroundRepairStatus()[0]).toMatchObject({ state: "done", preemptions: 1 });
  });

  it("does not retry a failed repair until the cooldown has passed", async () => {
    const h = harness();
    const pdb = structure("fails");
    h.repairImpl = async () => ({ outcome: "timed-out", budgetMs: 1, elapsedMs: 1 });
    await scheduled(h, pdb);
    expect(backgroundRepairStatus()[0]).toMatchObject({ state: "gave-up", detail: "RepairPDB timed-out" });

    const again = await requestBackgroundRepair({ wtPdb: pdb }, h.deps);
    expect(again.status).toBe("already-known");
    expect(h.repairCalls).toBe(1);

    h.clock.ms += GIVE_UP_COOLDOWN_MS + 1;
    h.repairImpl = async () => COMPLETED;
    await scheduled(h, pdb);
    expect(h.repairCalls).toBe(2);
    expect(backgroundRepairStatus()[0].state).toBe("done");
  });

  it("collapses repeated requests for one structure into one repair", async () => {
    const h = harness();
    const pdb = structure("dedupe");
    const first = await requestBackgroundRepair({ wtPdb: pdb }, h.deps);
    const second = await requestBackgroundRepair({ wtPdb: pdb }, h.deps);
    expect(first.status).toBe("scheduled");
    expect(second.status).toBe("already-known");
    if (first.status === "scheduled") await first.finished;
    expect(h.repairCalls).toBe(1);
  });

  it("treats the same structure under different conditions as a different repair", async () => {
    const h = harness();
    const pdb = structure("conditions");
    const a = await requestBackgroundRepair({ wtPdb: pdb, options: { pH: 7.4 } }, h.deps);
    const b = await requestBackgroundRepair({ wtPdb: pdb, options: { pH: 5 } }, h.deps);
    expect([a.status, b.status]).toEqual(["scheduled", "scheduled"]);
    await Promise.all([a, b].map(r => (r.status === "scheduled" ? r.finished : undefined)));
    expect(h.repairCalls).toBe(2);
  });

  it("does nothing when the repair is already cached, or when switched off", async () => {
    const h = harness();
    h.cached = true;
    expect((await requestBackgroundRepair({ wtPdb: structure("cached") }, h.deps)).status).toBe("cached");
    h.cached = false;
    h.deps.enabled = () => false;
    expect((await requestBackgroundRepair({ wtPdb: structure("off") }, h.deps)).status).toBe("disabled");
    expect(h.repairCalls).toBe(0);
  });

  it("is off in test environments unless asked for, and off with FOLDX_BACKGROUND_REPAIR=false", () => {
    expect(backgroundRepairEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(backgroundRepairEnabled({ NODE_ENV: "test", FOLDX_BACKGROUND_REPAIR: "true" })).toBe(true);
    expect(backgroundRepairEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(backgroundRepairEnabled({ NODE_ENV: "production", FOLDX_BACKGROUND_REPAIR: "false" })).toBe(false);
    expect(backgroundRepairEnabled({ NODE_ENV: "production", FOLDX_BACKGROUND_REPAIR: "0" })).toBe(false);
  });

  it("never throws to the job that asked, whatever the repairer does", async () => {
    const h = harness();
    h.deps.isCached = async () => { throw new Error("disk gone"); };
    const result = await requestBackgroundRepair({ wtPdb: structure("throws") }, h.deps);
    expect(result.status).toBe("ineligible");
  });
});

describe("requestBackgroundRepair, spare core", () => {
  it("is the mode on the OCI host (2 cores, 1 FoldX slot), and not where FoldX may use every core", () => {
    expect(backgroundRepairSlot(2, 1)).toBe("spare-core");
    expect(backgroundRepairSlot(2, 2)).toBe("shared");
    expect(backgroundRepairSlot(1, 1)).toBe("shared");
  });

  it("starts during continuous use: it does not wait for an idle FoldX slot", async () => {
    const h = harness();
    h.deps.slot = () => "spare-core";
    h.idle = false; // a job is always running
    await scheduled(h, structure("spare-busy"));
    expect(h.repairCalls).toBe(1);
    expect(h.sleeps).toBe(1);
    expect(h.slots).toEqual(["spare-core"]);
    expect(backgroundRepairStatus()[0]).toMatchObject({ state: "done", slot: "spare-core" });
  });

  it("is not stopped by an interactive job, because it does not hold the slot", async () => {
    const h = harness();
    h.deps.slot = () => "spare-core";
    h.repairImpl = async signal => {
      expect(backgroundFoldxRunning()).toBe(false);
      expect(preemptBackgroundFoldx()).toBe(0);
      expect(signal.aborted).toBe(false);
      return COMPLETED;
    };
    await scheduled(h, structure("spare-preempt"));
    expect(backgroundRepairStatus()[0]).toMatchObject({ state: "done", preemptions: 0 });
  });

  it("runs one background repair at a time, so a job never competes with two", async () => {
    const h = harness();
    h.deps.slot = () => "spare-core";
    // The second request waits behind the first in real event-loop turns, without a deadline to race.
    h.deps.maxWaitMs = Number.MAX_SAFE_INTEGER;
    h.deps.sleep = async ms => { h.sleeps++; h.clock.ms += ms; await new Promise(resolve => setImmediate(resolve)); };
    let release!: () => void;
    let concurrent = 0, peak = 0;
    h.repairImpl = async () => {
      peak = Math.max(peak, ++concurrent);
      if (h.repairCalls === 1) await new Promise<void>(resolve => { release = resolve; });
      concurrent--;
      return COMPLETED;
    };
    const a = await requestBackgroundRepair({ wtPdb: structure("spare-a") }, h.deps);
    const b = await requestBackgroundRepair({ wtPdb: structure("spare-b") }, h.deps);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(h.repairCalls).toBe(1);
    release();
    await Promise.all([a, b].map(r => (r.status === "scheduled" ? r.finished : undefined)));
    expect([a.status, b.status]).toEqual(["scheduled", "scheduled"]);
    expect(h.repairCalls).toBe(2);
    expect(peak).toBe(1);
  });
});

describe("announcing a running repair, so a job on the same structure can join it", () => {
  it("is announced only on a spare core, with the envelope's end, and cleared when it ends", async () => {
    for (const slot of ["spare-core", "shared"] as const) {
      resetBackgroundRepairForTests();
      const h = harness();
      h.deps.slot = () => slot;
      let seen: ReturnType<typeof inflightRepair> = null;
      h.repairImpl = async () => {
        seen = inflightRepair(backgroundRepairStatus()[0].key);
        return COMPLETED;
      };
      await scheduled(h, structure(`announce-${slot}`));
      const key = backgroundRepairStatus()[0].key;
      if (slot === "spare-core") {
        // 4 residues x 1.8 s + 4 incomplete x 5 s = 27.2 s past its start.
        expect(seen).toMatchObject({ expectedEndAt: (seen as any).startedAt + 27_200 });
      } else {
        expect(seen, "a shared-slot repair is preempted by a job, so a job must not wait for it").toBeNull();
      }
      expect(inflightRepair(key)).toBeNull();
    }
  });
});
