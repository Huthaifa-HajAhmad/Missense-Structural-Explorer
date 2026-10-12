import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRouter } from "../routes.ts";
import { BiophysicalJobQueue } from "../services/biophysical-queue.ts";
import { resetActiveFoldxJobs } from "../services/infra/foldx-job-registry.ts";
import { _resetHostProbe } from "../services/infra/host-probe.ts";

/**
 * WP-E and WP-B/D acceptance through the real `/generate-mutant` handler (the review found these were
 * asserted only at the queue level): two signed-in people asking for the same FoldX run share ONE job
 * and both become watchers; the wait estimate reaches the response; a person's own limit answers 429
 * and a job the server cannot run answers 422, each with its code.
 */

const PDB = "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND";
const MUTATION = "SA489C";

function handler() {
  const route: any = apiRouter.stack.find((layer: any) => layer.route && layer.route.path === "/generate-mutant");
  return route.route.stack[route.route.stack.length - 1].handle;
}

function responseDouble() {
  const out: any = { statusCode: 200, body: null, headers: {} };
  out.status = (code: number) => { out.statusCode = code; return out; };
  out.json = (body: any) => { out.body = body; return out; };
  out.setHeader = (k: string, v: string) => { out.headers[k] = v; };
  return out;
}

function person(id: string, quota: Record<string, number> | null = null) {
  return {
    kind: "user",
    userId: id,
    sessionIdHash: "h",
    user: { id, email: `${id}@lab.org`, displayName: id, role: "member", status: "active", shareResults: true, placementPref: "auto", quota },
  };
}

async function submit(principal: any) {
  const res = responseDouble();
  await handler()({ body: { wtPdb: PDB, mutation: MUTATION, uniprotId: "Q9H116" }, headers: {}, principal } as any, res, () => {});
  return res;
}

async function mockRouteDependencies() {
  const biophysics = await import("../services/biophysics.ts");
  const external = await import("../services/external.ts");
  const stabilityOracle = await import("../services/stabilityoracle.ts");
  const uniprot = await import("../services/uniprot.ts");
  vi.spyOn(biophysics, "getMutantFromCache").mockResolvedValue(undefined as any);
  vi.spyOn(external, "submitDynaMut2Job").mockResolvedValue("d2-job");
  vi.spyOn(external, "submitDdmutJob").mockResolvedValue("ddmut-job");
  vi.spyOn(biophysics, "submitThermoMpnnJob").mockResolvedValue({ status: "unavailable" } as any);
  vi.spyOn(biophysics, "runRaspLocal").mockResolvedValue(null as any);
  vi.spyOn(stabilityOracle, "runStabilityOracleAnalysis").mockResolvedValue(null as any);
  vi.spyOn(uniprot, "fetchUniprotSequence").mockResolvedValue("");
}

let savedMode: string | undefined;
beforeEach(async () => {
  savedMode = process.env.COMPUTE_ROUTING;
  vi.restoreAllMocks();
  resetActiveFoldxJobs();
  BiophysicalJobQueue.resetForTesting();
  BiophysicalJobQueue.initialize(1, () => new Promise(() => {})); // nothing ever finishes
  await mockRouteDependencies();
});

afterEach(() => {
  if (savedMode === undefined) delete process.env.COMPUTE_ROUTING;
  else process.env.COMPUTE_ROUTING = savedMode;
  _resetHostProbe();
  BiophysicalJobQueue.resetForTesting();
  resetActiveFoldxJobs();
});

describe("/generate-mutant: one FoldX run for two people", () => {
  it("shares one job, makes both watchers, and reports the wait estimate", async () => {
    const queue = BiophysicalJobQueue.getInstance();
    // Something already running, with an estimate, so the shared job waits and has an ETA.
    await queue.pushJob("foldx", { blocker: true }, { ownerId: "someone", costEstimateMs: 60_000 });
    await new Promise((r) => setTimeout(r, 120));

    const a = await submit(person("alice"));
    const b = await submit(person("bob"));
    expect(a.statusCode).toBe(200);
    expect(b.body.foldxJobId).toBe(a.body.foldxJobId);
    expect(await queue.getQueueLength()).toBe(2); // the blocker + ONE shared job
    expect(typeof a.body.queuedEtaMs).toBe("number");

    // Both see it as theirs to withdraw from; one withdrawing leaves it for the other.
    const id = a.body.foldxJobId;
    expect((await queue.listFor("bob")).map((j) => j.id)).toContain(id);
    expect(await queue.cancelFor(id, "alice", false)).toMatchObject({ ok: true, aborted: false });
    expect((await queue.getJobStatus(id))?.status).toBe("queued");
  });
});

describe("/generate-mutant: limits and admission answer with their own status and code", () => {
  it("429 QUEUED_PER_USER when the person's own limit is reached", async () => {
    const queue = BiophysicalJobQueue.getInstance();
    await queue.pushJob("foldx", { blocker: true }, { ownerId: "someone" });
    await new Promise((r) => setTimeout(r, 120));
    await queue.pushJob("foldx", { other: 1 }, { ownerId: "carol" }); // carol already has one waiting

    const res = await submit(person("carol", { queuedPerUser: 1 }));
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatchObject({ code: "QUEUED_PER_USER" });
    expect(res.body.error.message).toMatch(/You already have 1 job waiting \(your limit is 1\)/);
  });

  it("422 CANNOT_RUN_HERE when the server cannot run it (COMPUTE_ROUTING=on)", async () => {
    process.env.COMPUTE_ROUTING = "on";
    _resetHostProbe([]); // this server has neither FoldX nor P2Rank
    const res = await submit(person("dave"));
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatchObject({ code: "CANNOT_RUN_HERE" });
    expect(res.body.error.message).toMatch(/FoldX/);
  });
});
