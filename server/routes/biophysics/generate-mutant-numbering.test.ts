import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRouter } from "../../routes.ts";
import { clearAllCaches } from "../../services/cache.ts";
import { BiophysicalJobQueue } from "../../services/biophysical-queue.ts";
import { clearInFlightRemoteSubmissions } from "./generation.ts";
import { AuditLogger } from "../../utils.ts";
import { issueNumberingProof } from "../../services/translation/numbering-proof.ts";

/**
 * /generate-mutant mutates the residue at a canonical UniProt position (the browser sends no structure;
 * the server resolves one for that position). Its audit entry records how that position's numbering
 * was proven, whether the result was queued, joined or served from the cache. A structure the caller
 * sent is read in its own numbering, so no UniProt proof applies to it.
 */
const PDB = "ATOM      1  CA  SER A 489      1.000   1.000   1.000  1.00  0.00           C\nEND";

async function generate(body: Record<string, unknown>) {
  const route: any = apiRouter.stack.find((layer: any) => layer.route?.path === "/generate-mutant");
  const handler = route.route.stack[route.route.stack.length - 1].handle;
  const res: any = { status() { return this; }, json() { return this; } };
  await handler({ body, headers: {} }, res, () => {});
}

describe("/generate-mutant numbering proof in the audit entry", () => {
  let audit: { mock: { calls: unknown[][] } };

  beforeEach(async () => {
    clearAllCaches();
    clearInFlightRemoteSubmissions();
    try { BiophysicalJobQueue.initialize(2, async () => ({})); } catch (_) {}
    vi.stubEnv("APP_SESSION_SECRET", "generate-mutant-test-secret");
    const external = await import("../../services/external.ts");
    vi.spyOn(external, "submitDynaMut2Job").mockResolvedValue("1");
    vi.spyOn(external, "submitDdmutJob").mockResolvedValue("2");
    const biophysics = await import("../../services/biophysics.ts");
    vi.spyOn(biophysics, "getMutantFromCache").mockResolvedValue({
      pdb: PDB, ddG: 1.25, status: "success",
      energetics: { foldx: 1.25, foldxMean: 1.25, rasp: 1.7, thermompnn: 0.8, stabilityoracle: 0.4, dynamut2: -0.5, ddmut: -0.4 }
    } as any);
    vi.spyOn(biophysics, "runRaspLocal").mockResolvedValue({ score: 1.7 });
    vi.spyOn(biophysics, "writeMutantToCache").mockImplementation(() => {});
    const resolver = await import("../../services/structure-resolver.ts");
    vi.spyOn(resolver, "resolveStructure").mockResolvedValue({ pdbText: PDB, provenance: { source: "alphafold", chainId: "A" } } as any);
    audit = vi.spyOn(AuditLogger, "log").mockResolvedValue(undefined as any);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const proofFor = (position: number) =>
    issueNumberingProof({ accession: "Q9H116", position, wildType: "S", mutant: "C", proof: "genomic" });
  const entries = () => audit.mock.calls.filter((call) => call[0] === "GENERATE_MUTANT").map((call) => call[1]);

  it("records the proof for the canonical residue on a cache hit", async () => {
    const numberingProof = issueNumberingProof({ accession: "Q9H116", position: 489, wildType: "S", mutant: "C", proof: "genomic" });

    await generate({ mutation: "SA489C", uniprotId: "Q9H116", numberingProof });

    expect(entries()).toEqual([expect.objectContaining({ served: "cache-hit", numberingProof: "genomic" })]);
  });

  describe("on a cache miss", () => {
    beforeEach(async () => {
      const biophysics = await import("../../services/biophysics.ts");
      vi.mocked(biophysics.getMutantFromCache).mockResolvedValue(null as any);
    });

    it("records a queued job once it is in the queue", async () => {
      vi.spyOn(BiophysicalJobQueue.getInstance(), "pushJob").mockResolvedValue("queued-job-1");

      await generate({ mutation: "SA489C", uniprotId: " Q9H116 ", numberingProof: proofFor(489) });

      expect(entries()).toEqual([expect.objectContaining({ served: "queued", numberingProof: "genomic" })]);
    });

    it("records nothing when the queue refuses the job: nothing ran", async () => {
      const pushJob = vi.spyOn(BiophysicalJobQueue.getInstance(), "pushJob").mockRejectedValue(new Error("BUSY"));

      await generate({ mutation: "SA489C", uniprotId: "Q9H116", numberingProof: proofFor(489) });

      expect(pushJob).toHaveBeenCalled();
      expect(entries()).toEqual([]);
    });

    it("records a request that joins a job already running for the same mutation", async () => {
      const registry = await import("../../services/infra/foldx-job-registry.ts");
      vi.spyOn(registry, "submitOrJoinFoldxJob").mockResolvedValue({
        queueJobId: "running-job-1", joined: true, status: "running", startedAt: null, phase: null, jobData: { remoteJobs: {} }
      } as any);

      await generate({ mutation: "SA489C", uniprotId: "Q9H116", numberingProof: proofFor(489) });

      expect(entries()).toEqual([expect.objectContaining({ served: "joined", numberingProof: "genomic" })]);
    });
  });

  it("records an unverified residue and why when the proof names another one", async () => {
    const numberingProof = issueNumberingProof({ accession: "Q9H116", position: 490, wildType: "S", mutant: "C", proof: "genomic" });

    await generate({ mutation: "SA489C", uniprotId: "Q9H116", numberingProof });

    expect(entries()).toEqual([expect.objectContaining({ numberingProof: "unverified", numberingProofCheck: "other-residue" })]);
  });

  it("does not look RaSP or ProtVar up by UniProt position for the caller's own structure, and says why", async () => {
    const biophysics = await import("../../services/biophysics.ts");
    const protvar = await import("../../services/external-api/protvar.ts");
    const protvarSpy = vi.spyOn(protvar, "fetchProtVarFoldx");
    vi.mocked(biophysics.getMutantFromCache).mockResolvedValue({
      pdb: PDB, ddG: 1.25, status: "success", energetics: { foldx: 1.25, foldxMean: 1.25, rasp: null, protvarStatus: "pending" }
    } as any);
    let body: any = null;
    const route: any = apiRouter.stack.find((layer: any) => layer.route?.path === "/generate-mutant");
    const res: any = { status() { return this; }, json(payload: any) { body = payload; return this; } };

    await route.route.stack[route.route.stack.length - 1].handle({ body: { mutation: "SA489C", uniprotId: "Q9H116", wtPdb: PDB }, headers: {} }, res, () => {});

    expect(biophysics.runRaspLocal).not.toHaveBeenCalled();
    expect(protvarSpy).not.toHaveBeenCalled();
    expect(body.energetics).toMatchObject({ raspStatus: "unavailable", protvarStatus: "unavailable" });
    expect(body.energetics.raspError).toContain("numbered by the file");
  });

  it("checks no UniProt proof when the caller's own structure is used", async () => {
    await generate({ mutation: "SA489C", uniprotId: "Q9H116", wtPdb: PDB });

    const [entry] = entries();
    expect(entry).toMatchObject({ numberingProofCheck: "caller-structure" });
    expect(entry).not.toHaveProperty("numberingProof");
  });
});
