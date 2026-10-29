import { beforeEach, describe, expect, it, vi } from "vitest";

const generateMutantPdb = vi.fn();
const requestBackgroundRepair = vi.fn();

vi.mock("../biophysics.ts", () => ({
  generateMutantPdb: (...args: unknown[]) => generateMutantPdb(...args),
  enrichBiophysicalResult: (foldx: unknown) => foldx,
  getRaspCoverage: () => null,
  runRaspLocal: async () => null,
  runStabilityOracleAnalysis: async () => null
}));
vi.mock("../infra/biophysical-queue.ts", () => ({
  BiophysicalJobQueue: {
    getInstance: () => ({
      getJobData: async () => null,
      mutateJobData: async () => undefined,
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
});
