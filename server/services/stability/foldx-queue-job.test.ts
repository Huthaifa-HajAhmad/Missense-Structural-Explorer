import { beforeEach, describe, expect, it, vi } from "vitest";

const generateMutantPdb = vi.fn();
const requestBackgroundRepair = vi.fn();
const runStabilityOracleAnalysisDetailed = vi.fn<(...args: any[]) => Promise<any>>(async () => ({ kind: "unavailable", reason: "not running" }));
const runRaspLocal = vi.fn<(...args: any[]) => Promise<any>>(async () => null);
const RASP_STORE_UNAVAILABLE_REASON = "Pre-computed RaSP database unavailable";
const mutateJobData = vi.fn(async (_jobId: string, fn: (cur: any) => any) => {
  fn({ remoteJobs: {} });
});

vi.mock("../biophysics.ts", () => ({
  generateMutantPdb: (...args: unknown[]) => generateMutantPdb(...args),
  enrichBiophysicalResult: (foldx: unknown) => foldx,
  getRaspCoverage: () => null,
  runRaspLocal: (...args: any[]) => runRaspLocal(...args),
  RASP_STORE_UNAVAILABLE_REASON,
  runStabilityOracleAnalysisDetailed: (...args: any[]) => runStabilityOracleAnalysisDetailed(...args)
}));
vi.mock("../infra/biophysical-queue.ts", () => ({
  BiophysicalJobQueue: {
    getInstance: () => ({
      getJobData: async () => null,
      mutateJobData: (jobId: string, fn: (cur: any) => any) => mutateJobData(jobId, fn),
      updateJobPhase: async () => undefined
    })
  }
}));
vi.mock("../uniprot.ts", () => ({ fetchUniprotSequence: async () => "" }));
vi.mock("../external-api/protvar.ts", () => ({
  fetchProtVarFoldx: async () => null,
  protvarErrorFields: () => ({}),
  protvarJobFields: () => ({})
}));
vi.mock("./foldx/background-repair.ts", () => ({
  requestBackgroundRepair: (...args: unknown[]) => requestBackgroundRepair(...args)
}));

const { runFoldxQueueJobOnServer, foldxFailureResult } = await import("./foldx-queue-job.ts");

const data = { wtPdb: "PDB TEXT", mutation: "SA489C", uniprotId: "Q9H8M5", options: { pH: 7.4, temperature: 298.15, ionicStrength: 0.15 } };
const result = (energetics: Record<string, unknown>) => ({ pdb: "x", ddG: 0, status: "success", energetics: { foldxMean: 0, ...energetics } });

beforeEach(() => {
  generateMutantPdb.mockReset();
  requestBackgroundRepair.mockReset();
  runStabilityOracleAnalysisDetailed.mockReset().mockResolvedValue({ kind: "unavailable", reason: "not running" });
  runRaspLocal.mockReset().mockResolvedValue(null);
  requestBackgroundRepair.mockResolvedValue({ status: "scheduled", finished: Promise.resolve() });
});

describe("runFoldxQueueJobOnServer and the background repair", () => {
  it("asks for the template to be repaired in idle time when repair was skipped for its cost, with the job's own conditions", async () => {
    generateMutantPdb.mockResolvedValue(result({ foldxRepairSkipped: true, foldxRepairSkippedReason: "repair-exceeds-budget" }));
    await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(requestBackgroundRepair).toHaveBeenCalledTimes(1);
    expect(requestBackgroundRepair).toHaveBeenCalledWith({ wtPdb: "PDB TEXT", options: data.options, label: "Q9H8M5 SA489C" });
  });

  it.each(["alphafold-plddt", "large-structure"])("asks for a budgeted background repair for every skipped template (%s)", async reason => {
    generateMutantPdb.mockResolvedValue(result({ foldxRepairSkipped: true, foldxRepairSkippedReason: reason }));
    await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(requestBackgroundRepair).toHaveBeenCalledTimes(1);
  });

  it.each(["disabled", "ineligible", "already-known"])("does not arm client refresh for %s background work", async status => {
    generateMutantPdb.mockResolvedValue(result({ foldxRepairSkipped: true }));
    requestBackgroundRepair.mockResolvedValue({ status, reason: "gave up recently" });
    const out = await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(out.energetics.foldxRepairRefresh).toBeUndefined();
  });

  it("arms a bounded solver refresh only after repair admission", async () => {
    const now = Date.now();
    generateMutantPdb.mockResolvedValue(result({ foldxRepairSkipped: true }));
    const out = await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(out.energetics.foldxRepairRefresh.after).toBeGreaterThanOrEqual(now + 60_000);
    expect(out.energetics.foldxRepairRefresh.until).toBeGreaterThan(out.energetics.foldxRepairRefresh.after);
  });

  it("does not reschedule a repair whose cached coordinates were rejected", async () => {
    generateMutantPdb.mockResolvedValue(result({ foldxRepairSkipped: true, foldxRepairSkippedReason: "cached-repair-rejected" }));
    await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(requestBackgroundRepair).not.toHaveBeenCalled();
  });

  it("does not ask when the template was repaired or the repair was reused", async () => {
    generateMutantPdb.mockResolvedValue(result({ foldxRepairCached: true }));
    await runFoldxQueueJobOnServer(data, undefined, undefined);
    generateMutantPdb.mockResolvedValue(result({}));
    await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(requestBackgroundRepair).not.toHaveBeenCalled();
  });

  it("does not ask after a failure that says nothing about the repair, and the failure still reaches the reader", async () => {
    generateMutantPdb.mockRejectedValue(new Error("FoldX BuildModel exceeded its execution budget"));
    const out = await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(requestBackgroundRepair).not.toHaveBeenCalled();
    expect(out.status).toBe("failed");
  });

  it("asks after a BuildModel failure that followed a repair skipped for its cost", async () => {
    const err = Object.assign(new Error("FoldX BuildModel exceeded its execution budget (...; RepairPDB skipped (repair-exceeds-budget))"), {
      foldxRepair: { failed: false, skipped: true, skippedReason: "repair-exceeds-budget" },
    });
    generateMutantPdb.mockRejectedValue(err);
    const out = await runFoldxQueueJobOnServer(data, undefined, undefined);
    expect(requestBackgroundRepair).toHaveBeenCalledTimes(1);
    expect(out.status).toBe("failed");
  });

  it("does not report a skipped or completed repair as failed just because the message names RepairPDB", () => {
    const skipped = foldxFailureResult(Object.assign(new Error("... RepairPDB skipped (repair-exceeds-budget)): x"), {
      foldxRepair: { failed: false, skipped: true, skippedReason: "repair-exceeds-budget" },
    }));
    const completed = foldxFailureResult(Object.assign(new Error("... RepairPDB completed in 205 s): x"), {
      foldxRepair: { failed: false, skipped: false },
    }));
    const failed = foldxFailureResult(Object.assign(new Error("FoldX BuildModel failed (RepairPDB previously failed): x"), {
      foldxRepair: { failed: true, skipped: false },
    }));
    expect(skipped.energetics.foldxRepairFailed).toBe(false);
    expect(skipped.energetics.foldxRepairSkippedReason).toBe("repair-exceeds-budget");
    expect(completed.energetics.foldxRepairFailed).toBe(false);
    expect(failed.energetics.foldxRepairFailed).toBe(true);
  });

  it("returns the job's result unchanged, however the request goes", async () => {
    const foldx = result({ foldxRepairSkipped: true, foldxRepairSkippedReason: "repair-exceeds-budget" });
    generateMutantPdb.mockResolvedValue(foldx);
    requestBackgroundRepair.mockRejectedValue(new Error("disk gone"));
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);
    const out = await runFoldxQueueJobOnServer(data, undefined, undefined);
    await new Promise(resolve => setImmediate(resolve));
    expect(out).toBe(foldx);
    expect(unhandled, "a failed request must not become an unhandled rejection").not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });

  it("publishes the three StabilityOracle outcomes apart: unavailable, a sidecar rejection, and a score", async () => {
    const publishedRemote: Record<string, unknown>[] = [];
    mutateJobData.mockImplementation(async (_jobId: string, fn: (cur: any) => any) => {
      const next = fn({ remoteJobs: {} });
      if (next?.remoteJobs) publishedRemote.push(next.remoteJobs);
    });
    generateMutantPdb.mockResolvedValue(result({}));

    runStabilityOracleAnalysisDetailed.mockResolvedValueOnce({ kind: "unavailable", reason: "sidecar not reachable" });
    await runFoldxQueueJobOnServer(data, undefined, "job-unavailable");
    expect(publishedRemote.some(r => r.stabilityoracleStatus === "unavailable" && r.stabilityoracleVal === null)).toBe(true);

    publishedRemote.length = 0;
    runStabilityOracleAnalysisDetailed.mockResolvedValueOnce({ kind: "error", message: "Wild-type residue mismatch at position 489" });
    await runFoldxQueueJobOnServer(data, undefined, "job-error");
    expect(publishedRemote.some(r => r.stabilityoracleStatus === "error" && (r.stabilityoracleError as string).includes("Wild-type residue mismatch"))).toBe(true);

    publishedRemote.length = 0;
    runStabilityOracleAnalysisDetailed.mockResolvedValueOnce({
      kind: "value",
      result: { ddG: 1.85, isStabilizing: false, contactsAnalyzed: 40, provenance: "StabilityOracle" },
    });
    await runFoldxQueueJobOnServer(data, undefined, "job-done");
    expect(publishedRemote.some(r => r.stabilityoracleStatus === "done" && r.stabilityoracleVal === 1.85)).toBe(true);
  });

  it("never submits StabilityOracle without the template it scores; it reports unavailability instead", async () => {
    const publishedRemote: Record<string, unknown>[] = [];
    mutateJobData.mockImplementation(async (_jobId: string, fn: (cur: any) => any) => {
      const next = fn({ remoteJobs: {} });
      if (next?.remoteJobs) publishedRemote.push(next.remoteJobs);
    });
    generateMutantPdb.mockResolvedValue(result({}));
    await runFoldxQueueJobOnServer({ ...data, wtPdb: undefined, uniprotId: "Q9H8M5" }, undefined, "job-no-template");
    expect(runStabilityOracleAnalysisDetailed).not.toHaveBeenCalled();
    expect(publishedRemote.some(r => r.stabilityoracleStatus === "unavailable")).toBe(true);
  });

  it("keeps the RaSP status contract honest: a usable index is done, a store fault is unavailable, and nothing consulted is unavailable too", async () => {
    const publishedRemote: Record<string, unknown>[] = [];
    mutateJobData.mockImplementation(async (_jobId: string, fn: (cur: any) => any) => {
      const next = fn({ remoteJobs: {} });
      if (next?.remoteJobs) publishedRemote.push(next.remoteJobs);
    });
    generateMutantPdb.mockResolvedValue(result({}));

    runRaspLocal.mockResolvedValueOnce({ score: 0.42, reason: null, source: "alphafold" } as any);
    await runFoldxQueueJobOnServer(data, undefined, "job-rasp-done");
    expect(publishedRemote.some(r => r.raspStatus === "done" && r.raspVal === 0.42)).toBe(true);

    publishedRemote.length = 0;
    runRaspLocal.mockResolvedValueOnce({ score: null, reason: RASP_STORE_UNAVAILABLE_REASON } as any);
    await runFoldxQueueJobOnServer(data, undefined, "job-rasp-store");
    expect(publishedRemote.some(r => r.raspStatus === "unavailable" && r.raspReason === RASP_STORE_UNAVAILABLE_REASON)).toBe(true);

    publishedRemote.length = 0;
    runRaspLocal.mockResolvedValueOnce({ score: null, reason: "Residue position is not present in the pre-computed database", source: "alphafold" } as any);
    await runFoldxQueueJobOnServer(data, undefined, "job-rasp-miss");
    // A genuine coverage miss stays a completed lookup with the miss sentence attached.
    expect(publishedRemote.some(r => r.raspStatus === "done" && r.raspVal === null && (r.raspReason as string).includes("not present"))).toBe(true);

    publishedRemote.length = 0;
    await runFoldxQueueJobOnServer({ ...data, uniprotId: undefined }, undefined, "job-no-uniprot");
    expect(publishedRemote.some(r => r.raspStatus === "unavailable")).toBe(true);
    expect(publishedRemote.some(r => r.protvarStatus === "unavailable")).toBe(true);
  });
});
