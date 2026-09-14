import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PrewarmManager, type PrewarmParams } from "./prewarm-manager.ts";
import { activeBackgroundTasks, inFlightPrewarms } from "../../routes/state.ts";

const mockFetchPdbFromRcsb = vi.fn();
const mockPushJob = vi.fn();
const mockGetJobStatus = vi.fn();
const mockAbortJob = vi.fn();

vi.mock("../structure/index.ts", () => ({
  fetchPdbFromRcsb: (...args: any[]) => mockFetchPdbFromRcsb(...args)
}));

vi.mock("./biophysical-queue.ts", () => ({
  BiophysicalJobQueue: {
    getInstance: () => ({
      pushJob: (...args: any[]) => mockPushJob(...args),
      getJobStatus: (...args: any[]) => mockGetJobStatus(...args),
      abortJob: (...args: any[]) => mockAbortJob(...args)
    })
  }
}));

describe("PrewarmManager", () => {
  const originalEnv = process.env.NODE_ENV;
  const dummyParams: PrewarmParams = {
    gene: "BRAF",
    variant: "V600E",
    uniprotId: "P15056",
    pos: 600,
    wt1Letter: "V",
    mutant: "E",
    pdbMapping: {
      pdbId: "4MNE",
      chainId: "A",
      unpStart: 448,
      structStart: 448
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    await inFlightPrewarms.delete("BRAF_V600E");
    activeBackgroundTasks.length = 0;
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
    await inFlightPrewarms.delete("BRAF_V600E");
  });

  it("maintains a singleton instance", () => {
    const instance1 = PrewarmManager.getInstance();
    const instance2 = PrewarmManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("skips prewarm execution when NODE_ENV is test", async () => {
    process.env.NODE_ENV = "test";
    const manager = PrewarmManager.getInstance();
    await manager.triggerPrewarm(dummyParams);
    expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
    expect(activeBackgroundTasks.length).toBe(0);
  });

  it("dispatches background job and cleans up on completion", async () => {
    process.env.NODE_ENV = "development";
    let resolvePdb: (val: string) => void;
    const pdbDeferred = new Promise<string>((resolve) => {
      resolvePdb = resolve;
    });

    mockFetchPdbFromRcsb.mockImplementation(() => pdbDeferred);
    mockPushJob.mockResolvedValue("job-123");
    mockGetJobStatus.mockResolvedValue({ status: "completed" });

    const manager = PrewarmManager.getInstance();
    await manager.triggerPrewarm(dummyParams);

    expect(activeBackgroundTasks.length).toBe(1);
    expect(await inFlightPrewarms.has("BRAF_V600E")).toBe(true);

    // Now resolve the PDB fetch and wait for background task promise
    const task = activeBackgroundTasks[0];
    resolvePdb!("ATOM 1 N VAL A 600 ... END");
    await task.promise;

    expect(mockFetchPdbFromRcsb).toHaveBeenCalledWith(
      "4MNE",
      "A",
      448,
      448,
      expect.objectContaining({ uniprotId: "P15056", pos: 600, expectedWt1: "V" })
    );
    expect(mockPushJob).toHaveBeenCalledWith(
      "foldx",
      expect.objectContaining({
        mutation: "VA600E",
        uniprotId: "P15056"
      })
    );
    expect(activeBackgroundTasks.length).toBe(0);
    expect(await inFlightPrewarms.has("BRAF_V600E")).toBe(false);
  });

  it("handles duplicate in-flight requests by skipping", async () => {
    process.env.NODE_ENV = "development";
    await inFlightPrewarms.add("BRAF_V600E");

    const manager = PrewarmManager.getInstance();
    await manager.triggerPrewarm(dummyParams);

    expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
    expect(activeBackgroundTasks.length).toBe(0);
  });

  it("handles failed prewarm jobs gracefully without throwing", async () => {
    process.env.NODE_ENV = "development";
    let resolvePdb: (val: string) => void;
    const pdbDeferred = new Promise<string>((resolve) => {
      resolvePdb = resolve;
    });

    mockFetchPdbFromRcsb.mockImplementation(() => pdbDeferred);
    mockPushJob.mockResolvedValue("job-failed");
    mockGetJobStatus.mockResolvedValue({ status: "failed", error: "FoldX binary crashed" });

    const manager = PrewarmManager.getInstance();
    await manager.triggerPrewarm(dummyParams);

    expect(activeBackgroundTasks.length).toBe(1);
    const task = activeBackgroundTasks[0];
    resolvePdb!("ATOM ... END");
    await task.promise;

    expect(activeBackgroundTasks.length).toBe(0);
    expect(await inFlightPrewarms.has("BRAF_V600E")).toBe(false);
  });
});
