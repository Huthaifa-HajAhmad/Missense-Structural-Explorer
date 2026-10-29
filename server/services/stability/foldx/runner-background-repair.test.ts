import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * The process boundary is faked exactly as in runner-repair-cache.test.ts: only `execFile` is replaced, so
 * the runner's own sequencing, cache and semaphore logic is what runs.
 */
const foldxLog: string[] = [];
vi.mock("child_process", () => ({
  execFile: (
    _file: string,
    args: string[],
    options: { cwd?: string },
    callback: (err: Error | null, stdout: string, stderr: string) => void
  ) => {
    const command = (args.find(a => a.startsWith("--command=")) || "").split("=")[1] || "";
    const pdbArg = (args.find(a => a.startsWith("--pdb=")) || "").split("=")[1] || "wt.pdb";
    const cwd = options?.cwd || process.cwd();
    foldxLog.push(command);
    if (command === "RepairPDB") {
      fs.writeFileSync(path.join(cwd, "wt_Repair.pdb"), fs.readFileSync(path.join(cwd, pdbArg), "utf8") + "\nREMARK  99 REPAIRED\n");
    } else if (command === "BuildModel") {
      const base = path.basename(pdbArg, ".pdb");
      const text = fs.readFileSync(path.join(cwd, pdbArg), "utf8");
      for (let run = 0; run < 5; run++) {
        fs.writeFileSync(path.join(cwd, `${base}_1_${run}.pdb`), text + "\nREMARK  99 MUTANT\n");
        fs.writeFileSync(path.join(cwd, `WT_${base}_1_${run}.pdb`), text);
      }
      fs.writeFileSync(path.join(cwd, "Dif_wt.fxout"), makeDifFxout());
    }
    callback(null, `${command} done`, "");
  }
}));

/**
 * The repair gate only says no under Box64, which no test host runs; this switch makes the runner take
 * that branch (the one where it may join a background repair) without faking emulation.
 */
let repairFitsInJob = true;
vi.mock("./budget.ts", async importOriginal => {
  const original = await importOriginal<typeof import("./budget.ts")>();
  return { ...original, repairFitsBudget: (...args: Parameters<typeof original.repairFitsBudget>) => repairFitsInJob && original.repairFitsBudget(...args) };
});

const { generateMutantPdb, repairTemplateOnly, biophysicalSemaphore } = await import("./runner.ts");
const { announceInflightRepair, resetInflightRepairsForTests } = await import("./inflight-repairs.ts");
const { getRepairCacheKey, getRepairedStructureFromCache, repairedStructureCache, mutantCache } = await import("./cache.ts");
const { cleanPdbForFoldX } = await import("./pdb-utils.ts");
const { registerPreemptible, backgroundFoldxRunning, resetPreemptionForTests } = await import("./preemption.ts");
const crypto = await import("crypto");
const { requestBackgroundRepair, backgroundRepairStatus, resetBackgroundRepairForTests } = await import("./background-repair.ts");
const { resolveFoldxConcurrency } = await import("../../../config.ts");

function makeWildTypePdb(marker: string): string {
  const residues: Array<[string, number]> = [["ALA", 3], ["GLY", 4], ["ALA", 5], ["SER", 6]];
  const lines = ["HEADER    EXPERIMENTAL STRUCTURE", `REMARK   99 ${marker}`];
  let serial = 1;
  for (const [resName, resSeq] of residues) {
    lines.push(
      "ATOM  " + String(serial++).padStart(5) + " " + " CA " + " " + resName.padStart(3) + " " + "A" +
      String(resSeq).padStart(4) + "    " +
      (resSeq * 1.1).toFixed(3).padStart(8) + (resSeq * 0.7).toFixed(3).padStart(8) + (resSeq * 0.3).toFixed(3).padStart(8) +
      "  1.00 87.39"
    );
  }
  lines.push("TER", "END");
  return lines.join("\n");
}

function makeDifFxout(): string {
  const header = "Pdb\ttotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics\tSolvation Polar\tSolvation Hydrophobic\tVan der Waals clashes\tentropy sidechain\tentropy mainchain\tsloop_entropy\tmloop_entropy\tcis_bond\ttorsional clash\tbackbone clash\thelix dipole\twater bridge\tdisulfide\telectrostatic kon\tpartial covalent bonds\tenergy Ionisation\tEntropy Complex";
  const row = (n: number, e: string) => `wt_${n}.pdb\t${e}\t2.50\t8.00\t1.50\t2.00\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0`;
  return ["FoldX 5.1 (2011)", "by the FoldX Consortium", "------------------------------------------------------", "", "PDB file analysed: batch", "Output type: BuildModel", header, row(1, "13.50"), row(2, "12.50"), row(3, "14.50")].join("\n");
}

let workspace: string;
let foldxHome: string;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-bg-"));
  foldxHome = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-bg-home-"));
  for (const key of ["FOLDX_BINARY", "FOLDX_CACHE_DIR"]) originalEnv[key] = process.env[key];
  const fakeBin = path.join(foldxHome, "foldx-fake.bin");
  fs.writeFileSync(fakeBin, "");
  fs.mkdirSync(path.join(foldxHome, "molecules"), { recursive: true });
  fs.writeFileSync(path.join(foldxHome, "molecules", "placeholder.json"), "{}");
  fs.writeFileSync(path.join(foldxHome, "rotabase.txt"), "");
  process.env.FOLDX_BINARY = fakeBin;
  process.env.FOLDX_CACHE_DIR = path.join(foldxHome, "foldx_cache");
  foldxLog.length = 0;
  repairFitsInJob = true;
  repairedStructureCache.clear();
  mutantCache.clear();
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  repairedStructureCache.clear();
  mutantCache.clear();
  resetPreemptionForTests();
  resetInflightRepairsForTests();
  resetBackgroundRepairForTests();
  fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  fs.rmSync(foldxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const keyFor = (pdb: string, options?: { pH?: number }) =>
  getRepairCacheKey(crypto.createHash("sha256").update(cleanPdbForFoldX(pdb)).digest("hex"), options);

describe("background RepairPDB through the real runner", () => {
  it("runs RepairPDB alone, fills the repair cache, and the next variant skips the repair", async () => {
    const pdb = makeWildTypePdb("BG-ONE");
    const diagnostic = await repairTemplateOnly(pdb, path.join(workspace, "bg"), { seed: 12345 }, 60_000, { slot: "spare-core" });

    expect(diagnostic.outcome).toBe("completed");
    expect(foldxLog).toEqual(["RepairPDB"]); // no BuildModel: nothing was asked about a substitution
    expect((await getRepairedStructureFromCache(keyFor(pdb)))?.pdb).toContain("REPAIRED");

    foldxLog.length = 0;
    const phases: string[] = [];
    const result = await generateMutantPdb(pdb, "AA5W", "P00439", path.join(workspace, "job"), undefined, { seed: 12345 }, p => { phases.push(p); });
    expect(result.status).toBe("success");
    expect(result.energetics.foldxRepairCached).toBe(true);
    expect(phases, "the cached repair must not be announced as a fresh one").toEqual(["modelling", "finalizing"]);
    expect(foldxLog).toEqual(["BuildModel"]);
  });

  it("schedules a real repair and reuses its exact cleaned-structure/options key in the mutant runner", async () => {
    const pdb = makeWildTypePdb("SCHEDULER-KEY");
    const options = { pH: 6.5, temperature: 310, ionicStrength: 0.2, seed: 77 };
    let now = 0;
    const request = await requestBackgroundRepair({ wtPdb: pdb, options }, {
      enabled: () => true, emulated: () => false, slot: () => "spare-core", isIdle: () => true,
      repair: repairTemplateOnly, isCached: async key => Boolean(await getRepairedStructureFromCache(key)),
      sleep: async ms => { now += ms; }, now: () => now, tempRoot: () => workspace,
      pollMs: 1, quietPolls: 1, maxWaitMs: 100
    });
    expect(request.status).toBe("scheduled");
    if (request.status !== "scheduled") throw new Error("repair was not admitted");
    await request.finished;
    const result = await generateMutantPdb(pdb, "AA5W", "P00439", path.join(workspace, "scheduled-mutant"), undefined, options);
    expect(result.energetics.foldxRepairCached).toBe(true);
    expect(result.energetics.foldxRepairCacheKey).toBe(backgroundRepairStatus()[0].key);
    expect(result.wtReferencePdb).toContain("REPAIRED");
    expect(foldxLog).toEqual(["RepairPDB", "BuildModel"]);
  });

  it("does nothing when the repair is already cached", async () => {
    const pdb = makeWildTypePdb("BG-CACHED");
    await repairTemplateOnly(pdb, path.join(workspace, "bg1"), undefined, 60_000, { slot: "spare-core" });
    foldxLog.length = 0;
    expect((await repairTemplateOnly(pdb, path.join(workspace, "bg2"), undefined, 60_000, { slot: "spare-core" })).outcome).toBe("reused");
    expect(foldxLog).toEqual([]);
  });

  it("in shared mode, does not queue behind a busy FoldX slot", async () => {
    const slots = resolveFoldxConcurrency();
    for (let i = 0; i < slots; i++) await biophysicalSemaphore.acquire(1000);
    try {
      await expect(repairTemplateOnly(makeWildTypePdb("BG-BUSY"), path.join(workspace, "bg"), undefined, 60_000, { slot: "shared", slotWaitMs: 20 }))
        .rejects.toThrow(/Timeout acquiring/);
      expect(foldxLog).toEqual([]);
    } finally {
      for (let i = 0; i < slots; i++) biophysicalSemaphore.release();
    }
  });

  it("on a spare core, runs while every FoldX slot is taken", async () => {
    const slots = resolveFoldxConcurrency();
    for (let i = 0; i < slots; i++) await biophysicalSemaphore.acquire(1000);
    try {
      const diagnostic = await repairTemplateOnly(makeWildTypePdb("BG-SPARE"), path.join(workspace, "bg"), undefined, 60_000, { slot: "spare-core" });
      expect(diagnostic.outcome).toBe("completed");
      expect(foldxLog).toEqual(["RepairPDB"]);
    } finally {
      for (let i = 0; i < slots; i++) biophysicalSemaphore.release();
    }
  });

  it("does not stop background work for a request that cannot run", async () => {
    const handle = registerPreemptible("test background repair");
    try {
      await expect(generateMutantPdb(makeWildTypePdb("BG-INVALID"), "AA99W", "P00439", path.join(workspace, "job"), undefined, { seed: 12345 }))
        .rejects.toThrow(/not found in the PDB structure/);
      await expect(generateMutantPdb(makeWildTypePdb("BG-MISMATCH"), "GA5W", "P00439", path.join(workspace, "job2"), undefined, { seed: 12345 }))
        .rejects.toThrow(/Mutation mismatch/);
      expect(handle.signal.aborted, "a request that never reaches FoldX must not kill a background repair").toBe(false);
      expect(foldxLog).toEqual([]);
    } finally {
      handle.release();
    }
  });

  it("asks background work to stop before an interactive job waits for the slot", async () => {
    const handle = registerPreemptible("test background repair");
    expect(backgroundFoldxRunning()).toBe(true);
    try {
      const result = await generateMutantPdb(makeWildTypePdb("BG-PREEMPT"), "AA5W", "P00439", path.join(workspace, "job"), undefined, { seed: 12345 });
      expect(result.status).toBe("success");
      expect(handle.signal.aborted, "the interactive job did not preempt the background repair").toBe(true);
    } finally {
      handle.release();
    }
    expect(backgroundFoldxRunning()).toBe(false);
  });
});

describe("a job joining the background repair of its structure", () => {
  async function runSkippingRepair(pdb: string, phases: string[]) {
    repairFitsInJob = false;
    return generateMutantPdb(pdb, "AA5W", "P00439", path.join(workspace, "job"), undefined, { seed: 12345 }, p => { phases.push(p); });
  }

  it("waits for a repair that is nearly done and models on the repaired template", async () => {
    const pdb = makeWildTypePdb("JOIN-NEAR");
    const key = keyFor(pdb);
    const settle = announceInflightRepair(key, Date.now() - 600_000, Date.now() + 1_000);
    // Publish only after the runner actually joins; a wall-clock timer could fire before cache lookup
    // on a busy host and accidentally exercise the direct-cache path instead.
    repairFitsInJob = false;
    const phases: string[] = [];
    const result = await generateMutantPdb(pdb, "AA5W", "P00439", path.join(workspace, "job"), undefined, { seed: 12345 }, async phase => {
      phases.push(phase);
      if (phase === "repairing") {
        const { writeRepairedStructureToCache } = await import("./cache.ts");
        await writeRepairedStructureToCache(key, cleanPdbForFoldX(pdb) + "\nREMARK  99 REPAIRED\n");
        settle();
      }
    });
    expect(result.energetics.foldxRepairCached).toBe(true);
    expect(result.energetics.foldxRepairSkipped).toBe(false);
    expect(result.energetics.foldxRepairSkippedReason).toBeUndefined();
    expect(phases, "the wait is reported as the repair it is").toEqual(["repairing", "modelling", "finalizing"]);
    expect(foldxLog).toEqual(["BuildModel"]);
  });

  it("does not wait for a repair that would end after an unrepaired BuildModel", async () => {
    const pdb = makeWildTypePdb("JOIN-FAR");
    const settle = announceInflightRepair(keyFor(pdb), Date.now(), Date.now() + 60 * 60 * 1000);
    try {
      const phases: string[] = [];
      const started = Date.now();
      const result = await runSkippingRepair(pdb, phases);
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(result.energetics.foldxRepairSkippedReason).toBe("repair-exceeds-budget");
      expect(phases).toEqual(["modelling", "finalizing"]);
    } finally {
      settle();
    }
  });

  it("goes on unrepaired when the repair ends without a template", async () => {
    const pdb = makeWildTypePdb("JOIN-FAILED");
    const settle = announceInflightRepair(keyFor(pdb), Date.now(), Date.now() + 1_000);
    setTimeout(settle, 20); // ended (failed, preempted): nothing in the cache
    const result = await runSkippingRepair(pdb, []);
    expect(result.status).toBe("success");
    expect(result.energetics.foldxRepairSkippedReason).toBe("repair-exceeds-budget");
    expect(foldxLog).toEqual(["BuildModel"]);
  });

  it("with no repair in flight, skips exactly as before", async () => {
    const result = await runSkippingRepair(makeWildTypePdb("JOIN-NONE"), []);
    expect(result.energetics.foldxRepairSkippedReason).toBe("repair-exceeds-budget");
    expect(foldxLog).toEqual(["BuildModel"]);
  });
});
