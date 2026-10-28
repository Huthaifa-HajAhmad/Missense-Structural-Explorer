import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  PrewarmManager,
  DEFAULT_FOLDX_CONDITIONS,
  PREWARM_CAPABILITY,
  PREWARM_OPT_IN_ENV,
  buildPrewarmKey,
  decidePrewarm,
  declaresDefaultConditions,
  isPrewarmEnabled,
  type PrewarmParams,
} from "./prewarm-manager.ts";
import { activeBackgroundTasks, inFlightPrewarms, PREWARM_CLAIM_TTL_MS } from "../../routes/state.ts";
import { CONFIG } from "../../config.ts";
import { getFoldxCacheKey } from "../stability/foldx/cache.ts";
import {
  activeFoldxJobs,
  buildFoldxCacheKey,
  getActiveFoldxJobId,
  registerActiveFoldxJob,
  resetActiveFoldxJobs,
} from "./foldx-job-registry.ts";
import { EGRESS_SYSTEM_OWNER, currentEgressOwner, runWithEgressOwner } from "./egress-context.ts";

const mockFetchPdbFromRcsb = vi.fn();
const mockResolveStructure = vi.fn();
const mockPushJob = vi.fn();
const mockGetJobStatus = vi.fn();
const mockGetJobData = vi.fn();
const mockAbortJob = vi.fn();
const mockGetMutantFromCache = vi.fn();
const egressOwnerAtFetch: string[] = [];

vi.mock("../stability/foldx/cache.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../stability/foldx/cache.ts")>()),
  // The real lookup reads files; under fake timers that I/O races the clock the tests advance.
  getMutantFromCache: (...args: any[]) => mockGetMutantFromCache(...args),
}));

vi.mock("../structure/index.ts", () => ({
  fetchPdbFromRcsb: (...args: any[]) => mockFetchPdbFromRcsb(...args),
  resolveStructure: (...args: any[]) => mockResolveStructure(...args)
}));

vi.mock("./biophysical-queue.ts", () => ({
  BiophysicalJobQueue: {
    getInstance: () => ({
      pushJob: (...args: any[]) => mockPushJob(...args),
      getJobStatus: (...args: any[]) => mockGetJobStatus(...args),
      getJobData: (...args: any[]) => mockGetJobData(...args),
      abortJob: (...args: any[]) => mockAbortJob(...args)
    })
  }
}));

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-warming is a CAPABILITY, and every test here is about whether it may run
 * ─────────────────────────────────────────────────────────────────────────────
 * The manager used to dispatch unconditionally (outside `NODE_ENV=test`) with a 240 s absolute
 * timer that aborted the job it was waiting on. This suite pins the four properties that replace
 * that behaviour:
 *
 *   1. DEFAULT IS OFF. No opt-in ⇒ nothing is fetched, nothing is queued, no background task and no
 *      registry entry — asserted directly, because "disabled" is the configuration most deployments
 *      will run.
 *   2. ONE ATOMIC CLAIM. `has()` then `add()` let two concurrent requests for one variant both
 *      dispatch; only `add()`'s own return value may decide.
 *   3. PHASE-AWARE BUDGETS. A job may wait in the queue and then execute; the wait is budgeted
 *      against the queue's own leases, so the prewarm never gives up on work the queue still
 *      considers live (the old 240 s timer always did).
 *   4. NO SILENT INTERPRETATION. Unverified numbering, or declared non-default FoldX conditions,
 *      refuse the prewarm instead of computing under conditions the reader's own submit may not use.
 */
describe("PrewarmManager", () => {
  const originalEnv = { NODE_ENV: process.env.NODE_ENV, optIn: process.env[PREWARM_OPT_IN_ENV] };
  const KEY = "P15056_V600E";
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

  /** Opt in for one test, exactly as a deployment would. */
  function optIn(): void {
    process.env.NODE_ENV = "development";
    process.env[PREWARM_OPT_IN_ENV] = "true";
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    /**
     * Bridge the new resolution path: the manager now asks `resolveStructure` for the gated
     * template, so each test's existing `mockFetchPdbFromRcsb` value becomes the resolved text.
     * Provenance says experimental so the mutation keeps the mapping's chain (A).
     */
    mockResolveStructure.mockImplementation(async () => ({
      pdbText: await mockFetchPdbFromRcsb(),
      provenance: { source: "experimental", pdbId: "4MNE", chainId: "A" },
    }));
    mockGetMutantFromCache.mockResolvedValue(null);
    egressOwnerAtFetch.length = 0;
    await inFlightPrewarms.delete(KEY);
    await inFlightPrewarms.delete("BRAF_V600E");
    activeBackgroundTasks.length = 0;
    resetActiveFoldxJobs();
    delete process.env[PREWARM_OPT_IN_ENV];
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.optIn === undefined) delete process.env[PREWARM_OPT_IN_ENV];
    else process.env[PREWARM_OPT_IN_ENV] = originalEnv.optIn;
    await inFlightPrewarms.delete(KEY);
    await inFlightPrewarms.delete("BRAF_V600E");
    activeBackgroundTasks.length = 0;
    resetActiveFoldxJobs();
  });

  it("maintains a singleton instance", () => {
    const instance1 = PrewarmManager.getInstance();
    const instance2 = PrewarmManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  describe("opt-in gate (default OFF)", () => {
    it("does not dispatch anything at the default configuration", async () => {
      process.env.NODE_ENV = "development"; // not a test env; the opt-in is simply absent
      expect(isPrewarmEnabled()).toBe(false);

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);

      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(mockPushJob).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
    });

    it("does not dispatch when the opt-in is set to anything but the exact string", async () => {
      process.env.NODE_ENV = "development";
      for (const value of ["1", "TRUE", "yes", "on", ""]) {
        process.env[PREWARM_OPT_IN_ENV] = value;
        expect(isPrewarmEnabled(), `"${value}" must not enable prewarming`).toBe(false);
      }

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
    });

    it("skips prewarm execution when NODE_ENV is test even with the opt-in set", async () => {
      process.env.NODE_ENV = "test";
      process.env[PREWARM_OPT_IN_ENV] = "true";

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);

      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     * THE CAPABILITY DESCRIPTOR — the switch's whole contract, in one typed place
     * ─────────────────────────────────────────────────────────────────────────────
     * Its exact spelling, its exact opt-in value and its default ARE the contract: an operator reads
     * them, `.env.example` repeats them, and a doc sentence restates them. A descriptor makes the
     * three agree, and the live getter is what lets a test set the variable per case.
     */
    it("documents the switch: exact variable, exact opt-in value, off by default", () => {
      expect(PREWARM_CAPABILITY.envVar).toBe("PREWARM_FOLDX_ENABLED");
      expect(PREWARM_CAPABILITY.envVar).toBe(PREWARM_OPT_IN_ENV);
      expect(PREWARM_CAPABILITY.optInValue).toBe("true");
      expect(PREWARM_CAPABILITY.enabledByDefault).toBe(false);
    });

    it("reads the environment LIVE, so a value set after import still counts", () => {
      process.env.NODE_ENV = "development";
      delete process.env[PREWARM_OPT_IN_ENV];
      expect(PREWARM_CAPABILITY.isEnabled(), "the default is off").toBe(false);

      // Set AFTER this module was imported: a getter captured at module load would still say false,
      // and every test that opts in per case (and any operator toggling a deployment) would be
      // answered for the wrong state.
      process.env[PREWARM_OPT_IN_ENV] = "true";
      expect(PREWARM_CAPABILITY.isEnabled()).toBe(true);
      expect(PREWARM_CAPABILITY.isEnabled({ NODE_ENV: "test", [PREWARM_OPT_IN_ENV]: "true" } as any)).toBe(false);

      delete process.env[PREWARM_OPT_IN_ENV];
      expect(PREWARM_CAPABILITY.isEnabled(), "and it stops being on when the variable goes away").toBe(false);
    });

    it("reports the exact gate that refused a prewarm", () => {      expect(decidePrewarm(dummyParams, { NODE_ENV: "test" } as any)).toEqual({
        dispatch: false,
        reason: "test-environment"
      });
      expect(decidePrewarm(dummyParams, { NODE_ENV: "production" } as any)).toEqual({
        dispatch: false,
        reason: "not-opted-in"
      });
      const optedIn = { NODE_ENV: "production", [PREWARM_OPT_IN_ENV]: "true" } as any;
      expect(decidePrewarm({ ...dummyParams, pdbMapping: null }, optedIn)).toEqual({
        dispatch: false,
        reason: "structure-unknown"
      });
      expect(
        decidePrewarm({ ...dummyParams, conditions: { numberingVerified: false } }, optedIn)
      ).toEqual({ dispatch: false, reason: "numbering-unverified" });
      expect(
        decidePrewarm({ ...dummyParams, conditions: { foldxOptions: { pH: 5.0 } } }, optedIn)
      ).toEqual({ dispatch: false, reason: "non-default-conditions" });
      expect(decidePrewarm(dummyParams, optedIn)).toEqual({ dispatch: true });
    });
  });

  describe("interpretation conditions are never assumed", () => {
    it("refuses when the numbering is unverified", async () => {
      optIn();
      await PrewarmManager.getInstance().triggerPrewarm({
        ...dummyParams,
        conditions: { numberingVerified: false }
      });
      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
    });

    it("refuses declared non-default FoldX conditions rather than warming a key nobody will read", async () => {
      optIn();
      for (const foldxOptions of [{ pH: 5.0 }, { temperature: 310 }, { seed: 7 }, { ionicStrength: 0.5 }]) {
        await PrewarmManager.getInstance().triggerPrewarm({
          ...dummyParams,
          conditions: { foldxOptions }
        });
      }
      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
    });

    it("treats undefined fields as FoldX's defaults, exactly as the cache key does", () => {
      expect(declaresDefaultConditions(undefined)).toBe(true);
      expect(declaresDefaultConditions({})).toBe(true);
      expect(declaresDefaultConditions({ pH: 7.0, temperature: 298, ionicStrength: 0.05, seed: 12345 })).toBe(true);
      expect(declaresDefaultConditions({ pH: 7.0001 })).toBe(false);
    });

    it("mirrors FoldX's own defaults, so the warmed key cannot drift from the request's", () => {
      // The mirror is the only copy in this module; if `cache.ts` changes its implicit defaults this
      // fails instead of quietly warming an entry no interactive submit will ever look up.
      const implicit = getFoldxCacheKey("pdbhash", "VA600E");
      const explicit = getFoldxCacheKey("pdbhash", "VA600E", DEFAULT_FOLDX_CONDITIONS);
      expect(implicit).toBe(explicit);
    });
  });

  describe("dedup registry claim", () => {
    it("dispatches only for the caller that wins the atomic claim", async () => {
      optIn();
      // The losing caller of a concurrent pair: `add()` reports the key is taken. The previous
      // implementation ignored this return value and dispatched anyway (one variant, two FoldX jobs).
      const addSpy = vi.spyOn(inFlightPrewarms, "add").mockResolvedValue(false);

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);

      expect(addSpy).toHaveBeenCalledWith(KEY, expect.any(String));
      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
    });

    it("never consults has() before add() (no check-then-act)", async () => {
      optIn();
      const hasSpy = vi.spyOn(inFlightPrewarms, "has");
      mockFetchPdbFromRcsb.mockResolvedValue("ATOM 1 N VAL A 600 ... END");
      mockPushJob.mockResolvedValue("job-123");
      mockGetJobStatus.mockResolvedValue({ status: "completed" });

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      await activeBackgroundTasks[0].promise;

      expect(hasSpy).not.toHaveBeenCalled();
    });

    it("skips a duplicate while a prewarm for the same protein is in flight", async () => {
      optIn();
      await inFlightPrewarms.add(KEY);

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);

      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
    });

    it("keys the registry on the protein, not the gene label", () => {
      expect(buildPrewarmKey({ gene: "BRAF", variant: "V600E", uniprotId: "P15056" })).toBe("P15056_V600E");
      // Two isoforms of one gene must not share one in-flight slot.
      const isoform1 = buildPrewarmKey({ gene: "TP53", variant: "R273H", uniprotId: "P04637" });
      const isoform2 = buildPrewarmKey({ gene: "TP53", variant: "R273H", uniprotId: "P04637-2" });
      expect(isoform1).not.toBe(isoform2);
      // A caller with no accession still gets a stable key rather than an empty one.
      expect(buildPrewarmKey({ gene: "BRAF", variant: "V600E", uniprotId: "" })).toBe("BRAF_V600E");
    });
  });

  describe("dispatch and bookkeeping", () => {
    it("dispatches background job and cleans up on completion", async () => {
      optIn();
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
      expect(await inFlightPrewarms.has(KEY)).toBe(true);

      // Now resolve the PDB fetch and wait for background task promise
      const task = activeBackgroundTasks[0];
      resolvePdb!("ATOM 1 N VAL A 600 ... END");
      await task.promise;

      expect(mockResolveStructure).toHaveBeenCalledWith("P15056", 600, { requireWildType: true });
      expect(mockFetchPdbFromRcsb).toHaveBeenCalled();
      expect(mockPushJob).toHaveBeenCalledWith(
        "foldx",
        expect.objectContaining({
          mutation: "VA600E",
          uniprotId: "P15056"
        }),
        // Pre-warm is the system's own work: it must sort behind every reader's job.
        expect.objectContaining({ ownerId: "system" })
      );
      expect(activeBackgroundTasks.length).toBe(0);
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
    });

    it("warms the wild-type-gated template, not the raw Tier-1 mapping (F1)", async () => {
      optIn();
      mockResolveStructure.mockResolvedValue({
        pdbText: "ATOM 1 N VAL A 600 ... ALPHAFOLD END",
        provenance: { source: "alphafold", afdbVersion: "v6" },
      });
      mockPushJob.mockResolvedValue("job-af");
      mockGetJobStatus.mockResolvedValue({ status: "completed" });

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      await activeBackgroundTasks[0].promise;

      expect(mockResolveStructure).toHaveBeenCalledWith("P15056", 600, { requireWildType: true });
      expect(mockPushJob).toHaveBeenCalledWith(
        "foldx",
        expect.objectContaining({ wtPdb: "ATOM 1 N VAL A 600 ... ALPHAFOLD END", mutation: "VA600E" }),
        expect.anything()
      );
    });

    it("skips a run whose FoldX result is already cached (WP-I2)", async () => {
      optIn();
      mockFetchPdbFromRcsb.mockResolvedValue("ATOM 1 N VAL A 600 ... END");
      mockGetMutantFromCache.mockResolvedValue({ ddG: 1.2 });

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      await activeBackgroundTasks[0].promise;

      expect(mockGetMutantFromCache).toHaveBeenCalledWith(
        buildFoldxCacheKey("ATOM 1 N VAL A 600 ... END", "VA600E", DEFAULT_FOLDX_CONDITIONS)
      );
      expect(mockPushJob).not.toHaveBeenCalled();
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
    });

    it("makes its outbound calls as the system owner, not as the reader whose request triggered it", async () => {
      optIn();
      mockFetchPdbFromRcsb.mockImplementation(async () => {
        egressOwnerAtFetch.push(currentEgressOwner());
        return "ATOM 1 N VAL A 600 ... END";
      });
      mockPushJob.mockResolvedValue("job-123");
      mockGetJobStatus.mockResolvedValue({ status: "completed" });

      await runWithEgressOwner("reader-1", () => PrewarmManager.getInstance().triggerPrewarm(dummyParams));
      await activeBackgroundTasks[0].promise;

      expect(egressOwnerAtFetch).toEqual([EGRESS_SYSTEM_OWNER]);
    });

    it("pins the FoldX conditions into the queued job instead of relying on the worker's fallback", async () => {
      optIn();
      mockFetchPdbFromRcsb.mockResolvedValue("ATOM 1 N VAL A 600 ... END");
      mockPushJob.mockResolvedValue("job-123");
      mockGetJobStatus.mockResolvedValue({ status: "completed" });

      await PrewarmManager.getInstance().triggerPrewarm({ ...dummyParams, conditions: { foldxOptions: {} } });
      await activeBackgroundTasks[0].promise;

      expect(mockPushJob).toHaveBeenCalledWith(
        "foldx",
        expect.objectContaining({ options: DEFAULT_FOLDX_CONDITIONS }),
        expect.anything()
      );
    });

    it("marks the job as speculative so a joiner knows the remote engines are its own", async () => {
      optIn();
      mockFetchPdbFromRcsb.mockResolvedValue("ATOM 1 N VAL A 600 ... END");
      mockPushJob.mockResolvedValue("job-123");
      mockGetJobStatus.mockResolvedValue({ status: "completed" });

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      await activeBackgroundTasks[0].promise;

      // Without this flag a reader request that joins the job assumes the original submitter ran
      // DynaMut2 / DDMut / ThermoMPNN / StabilityOracle — and the pre-warm runs none of them.
      expect(mockPushJob).toHaveBeenCalledWith("foldx", expect.objectContaining({ prewarm: true }), expect.anything());
    });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     * THE PRE-WARM'S JOB IS VISIBLE TO THE INTERACTIVE PATH
     * ─────────────────────────────────────────────────────────────────────────────
     * Audit R2-F4: the pre-warm registered nothing, so a reader request for the same run started a
     * SECOND concurrent FoldX job. It is now registered under the interactive path's own key —
     * structure hash + mutation (chain included) + conditions, via the one shared derivation.
     */
    it("registers the queued job under the interactive path's own FoldX cache key", async () => {
      optIn();
      const pdbText = "ATOM 1 N VAL A 600 ... END";
      let releaseStatus: (value: any) => void;
      const statusGate = new Promise<any>((resolve) => { releaseStatus = resolve; });
      mockFetchPdbFromRcsb.mockResolvedValue(pdbText);
      mockPushJob.mockResolvedValue("job-123");
      mockGetJobStatus.mockImplementation(() => statusGate);

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      // The job is still in flight: the wait is parked on the status gate.
      await vi.waitFor(() => expect(mockGetJobStatus).toHaveBeenCalled());

      // The key the interactive path computes for the same structure, mutation and conditions.
      const interactiveKey = buildFoldxCacheKey(pdbText, "VA600E", DEFAULT_FOLDX_CONDITIONS);
      expect(getActiveFoldxJobId(interactiveKey)).toBe("job-123");

      releaseStatus!({ status: "completed" });
      await activeBackgroundTasks[0].promise;

      expect(getActiveFoldxJobId(interactiveKey), "the entry must not outlive the job").toBeUndefined();
      expect(activeFoldxJobs.size).toBe(0);
    });

    it("does not enqueue at all when an identical run is already in flight", async () => {
      optIn();
      const pdbText = "ATOM 1 N VAL A 600 ... END";
      mockFetchPdbFromRcsb.mockResolvedValue(pdbText);
      mockGetJobStatus.mockResolvedValue({ status: "running", startedAt: 1 });
      mockGetJobData.mockResolvedValue({ prewarm: false, phase: "repairing" });
      // A reader's request for this exact run is already queued/running.
      registerActiveFoldxJob(buildFoldxCacheKey(pdbText, "VA600E", DEFAULT_FOLDX_CONDITIONS), "job-reader");

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      await activeBackgroundTasks[0].promise;

      expect(mockPushJob, "there is nothing left to warm").not.toHaveBeenCalled();
      // And the pre-warm must not supervise a job it does not own: `awaitQueueJob` aborts a job that
      // has outlived the queue's lease, and a reader's job is not ours to abort.
      expect(mockAbortJob).not.toHaveBeenCalled();
      expect(getActiveFoldxJobId(buildFoldxCacheKey(pdbText, "VA600E", DEFAULT_FOLDX_CONDITIONS)))
        .toBe("job-reader");
      expect(await inFlightPrewarms.has(KEY), "the claim is still released").toBe(false);
    });

    it("claims with a token and releases only its own claim", async () => {
      optIn();
      const addSpy = vi.spyOn(inFlightPrewarms, "add");
      const deleteSpy = vi.spyOn(inFlightPrewarms, "delete");
      mockFetchPdbFromRcsb.mockResolvedValue("ATOM 1 N VAL A 600 ... END");
      mockPushJob.mockResolvedValue("job-123");
      mockGetJobStatus.mockResolvedValue({ status: "completed" });

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      const claimToken = addSpy.mock.calls[0][1];
      expect(typeof claimToken).toBe("string");
      expect(claimToken).toBeTruthy();

      await activeBackgroundTasks[0].promise;

      // Owner-checked release: a claim that expired and was re-claimed by someone else survives this
      // caller's cleanup, so a third prewarm cannot be admitted behind it.
      expect(deleteSpy).toHaveBeenCalledWith(KEY, claimToken);
    });

    it("does nothing when the structure could not be resolved", async () => {
      optIn();
      await PrewarmManager.getInstance().triggerPrewarm({ ...dummyParams, pdbMapping: null });
      expect(mockFetchPdbFromRcsb).not.toHaveBeenCalled();
      expect(activeBackgroundTasks.length).toBe(0);
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
    });

    it("handles failed prewarm jobs gracefully without throwing", async () => {
      optIn();
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
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
    });

    it("releases the claim when the job record disappears", async () => {
      optIn();
      mockFetchPdbFromRcsb.mockResolvedValue("ATOM 1 N VAL A 600 ... END");
      mockPushJob.mockResolvedValue("job-vanished");
      mockGetJobStatus.mockResolvedValue(null);

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      await activeBackgroundTasks[0].promise;

      expect(await inFlightPrewarms.has(KEY)).toBe(false);
      expect(activeBackgroundTasks.length).toBe(0);
    });
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * PHASE-AWARE BUDGETS
   * ─────────────────────────────────────────────────────────────────────────────
   * Driven on a virtual clock: the point of these tests is that a job may sit in the queue for far
   * longer than the old 240 s absolute timer, and then run for the queue's whole job cap, without the
   * prewarm abandoning work the queue still considers live.
   */
  describe("phase-aware wait budgets", () => {
    /** A job status as the queue would report it, expressed in the virtual clock the loop runs on. */
    type StatusReport = { status: string; createdAt?: number; startedAt?: number | null; error?: string };

    async function runWithStatuses(
      statusFor: (elapsedMs: number, virtualStart: number) => StatusReport,
      advanceMs: number
    ): Promise<{ start: number }> {
      optIn();
      vi.useFakeTimers();
      const start = Date.now();
      mockFetchPdbFromRcsb.mockResolvedValue("ATOM 1 N VAL A 600 ... END");
      mockPushJob.mockResolvedValue("job-123");
      mockGetJobStatus.mockImplementation(async () => statusFor(Date.now() - start, start));

      await PrewarmManager.getInstance().triggerPrewarm(dummyParams);
      const promise = activeBackgroundTasks[0].promise;
      await vi.advanceTimersByTimeAsync(advanceMs);
      await promise;
      return { start };
    }

    it("does not abandon a job that is queued past the old 240 s absolute timer", async () => {
      // The regression: 300 s of queue wait. The old loop aborted at 240 s — and because a queued
      // SQLite job has no AbortController, that abort did nothing while the claim was released, so a
      // second prewarm could enqueue a duplicate for the same variant.
      const { start } = await runWithStatuses(
        (elapsed) => (elapsed < 300_000 ? { status: "queued" } : { status: "completed" }),
        301_000
      );

      expect(mockAbortJob).not.toHaveBeenCalled();
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
      expect(activeBackgroundTasks.length).toBe(0);
      expect(Date.now() - start).toBeGreaterThanOrEqual(300_000);
    });

    it("does not abandon a RUNNING job before the queue's own stale-running lease", async () => {
      // Past the queue's job cap (foldxSec) but inside the lease the queue's reaper uses: the queue
      // has not declared this job dead, so neither may the prewarm.
      await runWithStatuses(
        (elapsed, virtualStart) =>
          elapsed < 1_000
            ? { status: "queued" }
            : elapsed < 905_000
              ? { status: "running", startedAt: virtualStart }
              : { status: "completed" },
        906_000
      );

      expect(mockAbortJob).not.toHaveBeenCalled();
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
    });

    it("gives up on a RUNNING job only after the queue's stale-running lease", async () => {
      await runWithStatuses(
        (_elapsed, virtualStart) => ({ status: "running", startedAt: virtualStart }),
        CONFIG.timeouts.foldxReaperLeaseMs + 2_000
      );

      expect(mockAbortJob).toHaveBeenCalledWith("job-123");
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
      expect(activeBackgroundTasks.length).toBe(0);
    });

    it("gives up on a QUEUED job at the stale-queued lease without pretending to abort it", async () => {
      await runWithStatuses(() => ({ status: "queued" }), CONFIG.timeouts.foldxQueuedLeaseMs + 2_000);

      // `abortJob` cannot cancel a job that has not started; calling it would only release the claim
      // while the job kept its place in the queue.
      expect(mockAbortJob).not.toHaveBeenCalled();
      expect(await inFlightPrewarms.has(KEY)).toBe(false);
      expect(activeBackgroundTasks.length).toBe(0);
    });

    it("budgets both phases from CONFIG, never from a literal", () => {
      const source = fs.readFileSync(
        path.join(process.cwd(), "server", "services", "infra", "prewarm-manager.ts"),
        "utf-8"
      );
      expect(
        /240000|240_000/.test(source),
        "the 240 s absolute watchdog is back; budget the queue and running phases from CONFIG.timeouts"
      ).toBe(false);
      expect(source).toContain("CONFIG.timeouts.foldxQueuedLeaseMs");
      expect(source).toContain("CONFIG.timeouts.foldxReaperLeaseMs");
      // The phases must be read at wait time, not captured in a module constant that could drift
      // from the queue's own leases.
      expect(source).toContain("now - queuedAt > CONFIG.timeouts.foldxQueuedLeaseMs");
      expect(source).toContain("now - runningSince > CONFIG.timeouts.foldxReaperLeaseMs");
    });

    it("cannot outlive its own registry claim", () => {
      /**
       * The claim's TTL (`state.ts`) is derived from these same two leases plus a margin. If the
       * leases ever grew past it, a claim could expire while its job was still legitimately queued —
       * which is exactly how one variant ran two FoldX jobs.
       */
      const worstCaseWait = CONFIG.timeouts.foldxQueuedLeaseMs + CONFIG.timeouts.foldxReaperLeaseMs;
      expect(worstCaseWait).toBeLessThan(PREWARM_CLAIM_TTL_MS);
    });
  });
});
