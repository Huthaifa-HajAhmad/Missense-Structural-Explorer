import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { apiRouter } from "../routes.ts";
import { BiophysicalJobQueue } from "../services/biophysical-queue.ts";
import {
  buildFoldxCacheKey,
  registerActiveFoldxJob,
  resetActiveFoldxJobs,
} from "../services/infra/foldx-job-registry.ts";
import { DEFAULT_FOLDX_CONDITIONS } from "../services/infra/prewarm-manager.ts";

const PDB = "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND";
const MUTATION = "SA489C";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A READER REQUEST JOINS AN IN-FLIGHT PRE-WARM — asserted at the route
 * ─────────────────────────────────────────────────────────────────────────────
 * Registering the pre-warm's job under the interactive path's own key is only half the fix (audit
 * R2-F4: one variant, two concurrent FoldX jobs). The other half is what happens when a reader
 * actually joins one, and the two halves must not be confused:
 *
 *   • joining a job submitted by ANOTHER READER request means that request already dispatched the
 *     companion engines (ThermoMPNN / StabilityOracle / RaSP) and owns the job record — so
 *     the joiner must NOT resubmit them (`isExistingActiveJob`).
 *   • joining a PRE-WARM job means nobody dispatched them and nobody owns the record — the pre-warm
 *     has no reader context and is only warming FoldX. The joiner must do BOTH, or the reader is
 *     answered with engines that are missing and nothing on the way to fill them in.
 *
 * The queue's worker here never finishes, which is what keeps the job joinable.
 */
describe("/generate-mutant joins an in-flight pre-warm FoldX job", () => {
  function handlerFor(routePath: string) {
    const route: any = apiRouter.stack.find((layer: any) => layer.route && layer.route.path === routePath);
    expect(route, `${routePath} is not registered`).toBeDefined();
    return route.route.stack[route.route.stack.length - 1].handle;
  }

  function responseDouble() {
    const out: any = { statusCode: 200, body: null };
    out.status = (code: number) => { out.statusCode = code; return out; };
    out.json = (body: any) => { out.body = body; return out; };
    return out;
  }

  /** Submits a job directly, the way the pre-warm (or another reader request) would. */
  async function pushFoldxJob(data: Record<string, any>): Promise<string> {
    const queue = BiophysicalJobQueue.getInstance();
    return queue.pushJob("foldx", {
      wtPdb: PDB,
      mutation: MUTATION,
      uniprotId: "Q9H116",
      jobDir: `${process.cwd()}\\temp_jobs\\prewarm-join-test`,
      ...data,
    });
  }

  /** Everything the route reaches for on a non-cache-hit run, mocked to settle instantly. */
  async function mockRouteDependencies() {
    const biophysics = await import("../services/biophysics.ts");
    const stabilityOracle = await import("../services/stabilityoracle.ts");
    const uniprot = await import("../services/uniprot.ts");

    vi.spyOn(biophysics, "getMutantFromCache").mockResolvedValue(undefined as any);
    const thermompnn = vi.spyOn(biophysics, "submitThermoMpnnJob").mockResolvedValue({ status: "done", jobId: null, prediction: 0.42 } as any);
    vi.spyOn(biophysics, "runRaspLocal").mockResolvedValue(null as any);
    vi.spyOn(stabilityOracle, "runStabilityOracleAnalysis").mockResolvedValue(null as any);
    const oracle = vi.spyOn(stabilityOracle, "runStabilityOracleAnalysisDetailed").mockResolvedValue({ kind: "unavailable", reason: "test" } as any);
    vi.spyOn(uniprot, "fetchUniprotSequence").mockResolvedValue("");
    return { thermompnn, oracle };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    resetActiveFoldxJobs();
    BiophysicalJobQueue.resetForTesting();
    // Concurrency 1 with a worker that never resolves: the pushed job stays "running" and joinable.
    BiophysicalJobQueue.initialize(1, async () => new Promise(() => {}));
  });

  afterAll(() => {
    BiophysicalJobQueue.resetForTesting();
    resetActiveFoldxJobs();
  });

  it("joins the pre-warm job, submits the companion engines it could not, and starts no second FoldX job", async () => {
    const prewarmJobId = await pushFoldxJob({ options: DEFAULT_FOLDX_CONDITIONS, prewarm: true });
    const cacheKey = buildFoldxCacheKey(PDB, MUTATION, DEFAULT_FOLDX_CONDITIONS);
    registerActiveFoldxJob(cacheKey, prewarmJobId);

    const { thermompnn, oracle } = await mockRouteDependencies();
    const queue = BiophysicalJobQueue.getInstance();
    // Installed AFTER the pre-warm's own submission: any further push is the duplicate this test forbids.
    const pushSpy = vi.spyOn(BiophysicalJobQueue.prototype, "pushJob");

    const res = responseDouble();
    await handlerFor("/generate-mutant")(
      { body: { wtPdb: PDB, mutation: MUTATION, uniprotId: "Q9H116" }, headers: {} } as any,
      res,
      () => {}
    );

    expect(pushSpy, "a reader request must not enqueue a second FoldX job for a run already in flight")
      .not.toHaveBeenCalled();
    expect(res.body.foldxJobId).toBe(prewarmJobId);
    expect(res.body.status).toBe("queued");

    // The companion engine the pre-warm never submitted is this request's responsibility…
    expect(thermompnn).toHaveBeenCalledTimes(1);
    // …and its outcome is written to the job the reader is polling, which the pre-warm never did.
    const jobData = await queue.getJobData(prewarmJobId);
    expect(jobData?.remoteJobs?.thermompnnVal).toBe(0.42);
    expect(jobData?.remoteJobs?.thermompnnStatus).toBe("done");
    // The pre-warm's record had no reader context at all; the joining request supplies the
    // provenance the reader's export cites.
    expect(jobData?.structureProvenance?.source).toBe("client-provided");
  });

  it("still treats a job submitted by another reader request as fully owned, and resubmits nothing", async () => {
    // No `prewarm: true`: this is a reader's own job, whose submitter is running the companion engines.
    const readerJobId = await pushFoldxJob({});
    const cacheKey = buildFoldxCacheKey(PDB, MUTATION, DEFAULT_FOLDX_CONDITIONS);
    registerActiveFoldxJob(cacheKey, readerJobId);

    const { thermompnn } = await mockRouteDependencies();

    const res = responseDouble();
    await handlerFor("/generate-mutant")(
      { body: { wtPdb: PDB, mutation: MUTATION, uniprotId: "Q9H116" }, headers: {} } as any,
      res,
      () => {}
    );

    expect(res.body.foldxJobId).toBe(readerJobId);
    expect(thermompnn, "the original submitter already dispatched ThermoMPNN").not.toHaveBeenCalled();
  });
});
