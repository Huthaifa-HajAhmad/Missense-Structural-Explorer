import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { energeticsDataSchema } from "../../../../src/shared/contracts.ts";
import {
  backfillMutantCacheCompanions,
  getFoldxCacheKey,
  getMutantFromCache,
  mutantCache,
  writeMutantToCache,
  getRepairCacheKey,
  getRepairedStructureFromCache,
  writeRepairedStructureToCache,
  repairedStructureCache,
  noteRepairFailure,
  repairRecentlyFailed,
  clearRepairFailure,
  repairFailureTotal,
} from "./cache.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REPAIRED TEMPLATE IS A PROPERTY OF THE STRUCTURE, NOT OF THE MUTATION
 * ─────────────────────────────────────────────────────────────────────────────
 * Measured on this repository's own job dirs: FoldX RepairPDB took 205.4 s while the five-run
 * mutant build took 2.2 s — ~98% of a FoldX leg spent producing an artefact that does not depend on
 * the substitution. Because the mutant cache key contains the mutation, every variant on the same
 * template re-derived it.
 *
 * What matters here is that the repair key cannot drift into depending on the mutation, and that a
 * miss is always a safe miss (an unreadable or truncated entry must mean "repair it", never "fail
 * the job").
 */
describe("FoldX repaired-structure cache", () => {
  let tmpDir: string;
  const originalEnv = process.env.FOLDX_CACHE_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-repair-cache-"));
    process.env.FOLDX_CACHE_DIR = tmpDir;
    repairedStructureCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    repairedStructureCache.clear();
    mutantCache.clear();
    if (originalEnv === undefined) delete process.env.FOLDX_CACHE_DIR;
    else process.env.FOLDX_CACHE_DIR = originalEnv;
    /**
     * Preventive, not a fix for an observed failure here: `FOLDX_CACHE_DIR` is this test's own temp
     * directory, and cache.ts writes into it with promises -- including `unlink`s it does not await.
     * `runner-repair-cache.test.ts` failed in CI with "ENOTEMPTY: directory not empty, rmdir ..."
     * for exactly that reason, so the retries are added here rather than waiting to rediscover it.
     */
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  describe("what is allowed into the result cache", () => {
    const FIX = "fix-shell:r15-seq14:v1" as const;
    const entry = (repairMode: string | undefined, extra: Record<string, unknown> = {}) => ({
      status: "success", ddG: 0.5, energetics: { foldxMean: 0.5, ...(repairMode ? { repairMode } : {}), ...extra }
    });

    it("keeps a result whose repair is the one its key names", async () => {
      const key = getFoldxCacheKey("h", "SA159C", { repairMode: "full" });
      writeMutantToCache(key, entry("full"));
      expect(await getMutantFromCache(key)).not.toBeNull();
      const localKey = getFoldxCacheKey("h", "SA159C", { repairMode: FIX });
      writeMutantToCache(localKey, entry(FIX));
      expect(await getMutantFromCache(localKey)).not.toBeNull();
    });

    it("never keeps a result that got a different repair, or does not say which it got", async () => {
      const key = getFoldxCacheKey("h2", "SA159C", { repairMode: "full" });
      // The case that produced three different answers for one variant: unrepaired, served as if repaired.
      writeMutantToCache(key, entry("none", { foldxRepairSkipped: true }));
      expect(await getMutantFromCache(key)).toBeNull();
      // A local repair filed under the whole-chain key (or the reverse) would be the same mistake.
      writeMutantToCache(key, entry(FIX));
      expect(await getMutantFromCache(key)).toBeNull();
      // An older agent reports no mode at all.
      writeMutantToCache(key, entry(undefined));
      expect(await getMutantFromCache(key)).toBeNull();
    });
  });

  describe("companion engines kept with the FoldX entry", () => {
    const key = getFoldxCacheKey("companions", "SA159C", { repairMode: "full" });
    const stored = () => ({
      status: "success", ddG: 0.13,
      energetics: { foldxMean: 0.13, repairMode: "full", rasp: null, stabilityoracle: null, thermompnn: null }
    });

    it("keeps an answer, so a revisit does not ask the model service again", async () => {
      writeMutantToCache(key, stored());
      await backfillMutantCacheCompanions(key, {
        energetics: {
          stabilityoracle: 0.58, rasp: 0.8, raspSource: "alphafold", thermompnn: -0.38,
          protvarStatus: "done", protvar: 0.4, protvarPlddt: 71.2, protvarModel: "AF-P43694-F1"
        }
      });
      const kept = (await getMutantFromCache(key)).energetics;
      expect(kept).toMatchObject({
        stabilityoracle: 0.58, stabilityoracleStatus: "done",
        rasp: 0.8, raspSource: "alphafold", raspStatus: "done",
        thermompnn: -0.38,
        protvar: 0.4, protvarStatus: "done", protvarModel: "AF-P43694-F1"
      });
      // FoldX's own value and its repair mode are untouched.
      expect(kept).toMatchObject({ foldxMean: 0.13, repairMode: "full" });
    });

    it("keeps a finished 'ProtVar has no prediction' too, which is an answer", async () => {
      writeMutantToCache(key, stored());
      await backfillMutantCacheCompanions(key, { energetics: { protvar: null, protvarStatus: "done", protvarReason: "No prediction for this residue" } });
      expect((await getMutantFromCache(key)).energetics).toMatchObject({ protvar: null, protvarStatus: "done", protvarReason: "No prediction for this residue" });
    });

    it("never keeps an outage: a model service that was down for one run must not be recorded for a day", async () => {
      writeMutantToCache(key, stored());
      await backfillMutantCacheCompanions(key, {
        energetics: {
          stabilityoracle: null, stabilityoracleStatus: "error", stabilityoracleError: "sidecar offline",
          rasp: null, raspStatus: "unavailable", protvarStatus: "error", protvarError: "EBI timed out", thermompnn: null
        }
      });
      const kept = (await getMutantFromCache(key)).energetics;
      expect(kept.stabilityoracle).toBeNull();
      expect(kept.stabilityoracleStatus).toBeUndefined();
      expect(kept.rasp).toBeNull();
      expect(kept.protvarStatus).toBeUndefined();
    });

    it("does nothing when there is no entry to add to", async () => {
      await expect(backfillMutantCacheCompanions(getFoldxCacheKey("absent", "SA1C", { repairMode: "full" }), { energetics: { stabilityoracle: 1 } })).resolves.toBeUndefined();
    });
  });

  it("keys a local repair by the residue it was centred on, and never as the whole-chain one", () => {
    const pdbHash = "hash";
    const whole = getRepairCacheKey(pdbHash, { seed: 12345 });
    const at159 = getRepairCacheKey(pdbHash, { seed: 12345 }, { chain: "A", resSeq: 159, insCode: "" });
    const at160 = getRepairCacheKey(pdbHash, { seed: 12345 }, { chain: "A", resSeq: 160, insCode: "" });
    const at159B = getRepairCacheKey(pdbHash, { seed: 12345 }, { chain: "B", resSeq: 159, insCode: "" });
    expect(new Set([whole, at159, at160, at159B]).size).toBe(4);
    // The substitution is not in it: every substitution at one position shares the repair.
    expect(at159).not.toContain("SA159C");
    // The whole-chain key is exactly what it was, so repairs already cached stay valid.
    expect(whole).toBe("repair_hash_pH:7_temp:298_ion:0.05_seed:12345_version:v1");
  });

  it("memoizes missing repair reads and immediately sees a newly written repair", async () => {
    const read = vi.spyOn(fs.promises, "readFile");
    const key = getRepairCacheKey("missing-probe");
    expect(await getRepairedStructureFromCache(key)).toBeNull();
    expect(await getRepairedStructureFromCache(key)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    await writeRepairedStructureToCache(key, "ATOM repaired");
    expect((await getRepairedStructureFromCache(key))?.pdb).toBe("ATOM repaired");
  });

  it("keeps declared repair identity and refresh metadata at the payload boundary", () => {
    const fields = { foldxRepairCacheKey: "repair-id", foldxRepairRefresh: { after: 10, until: 20 } };
    expect(energeticsDataSchema.pick({ foldxRepairCacheKey: true, foldxRepairRefresh: true }).parse(fields)).toEqual(fields);
  });

  it("keys repair by structure and environment only — never by mutation", () => {
    const pdbHash = "hash-of-the-wild-type-text";
    const options = { pH: 7.4, temperature: 310, ionicStrength: 0.15, seed: 12345 };

    expect(getRepairCacheKey(pdbHash, options)).toBe(getRepairCacheKey(pdbHash, options));
    // Same structure, different environment: a different minimisation, so a different entry.
    expect(getRepairCacheKey(pdbHash, options)).not.toBe(getRepairCacheKey(pdbHash, { ...options, pH: 5 }));

    // The mutant key DOES vary by mutation; the repair key must not — that difference is the saving.
    const mutantA = getFoldxCacheKey(pdbHash, "SA489C", { ...options, repairMode: "full" });
    const mutantB = getFoldxCacheKey(pdbHash, "SA489W", { ...options, repairMode: "full" });
    expect(mutantA).not.toBe(mutantB);
    expect(getRepairCacheKey(pdbHash, options)).not.toContain("SA489");
  });

  it("round-trips repaired coordinates through disk", async () => {
    const key = getRepairCacheKey("structure-hash", {});
    const pdb = "ATOM      1  N   GLU A 431\n";

    // Awaited, not slept on: the writer returns its promise precisely so a caller can observe the
    // write instead of hoping 50 ms was enough on a loaded machine.
    await writeRepairedStructureToCache(key, pdb);
    void 0;

    repairedStructureCache.clear(); // force the disk path
    const restored = await getRepairedStructureFromCache(key);
    expect(restored?.pdb).toBe(pdb);
  });

  it("treats an unreadable, truncated or empty entry as a MISS", async () => {
    const key = getRepairCacheKey("broken-hash", {});
    const filename = path.join(tmpDir, `${(await import("crypto")).createHash("sha256").update(key).digest("hex")}.json`);

    fs.writeFileSync(filename, "{not json");
    expect(await getRepairedStructureFromCache(key)).toBeNull();

    fs.writeFileSync(filename, JSON.stringify({ pdb: "" }));
    expect(await getRepairedStructureFromCache(key)).toBeNull();

    // A miss must mean "repair the structure", never "fail the job".
    fs.writeFileSync(filename, JSON.stringify({ cachedAt: Date.now() }));
    expect(await getRepairedStructureFromCache(key)).toBeNull();
  });

  it("ignores an expired entry rather than serving stale coordinates", async () => {
    const key = getRepairCacheKey("expired-hash", {});
    const crypto = await import("crypto");
    const filename = path.join(tmpDir, `${crypto.createHash("sha256").update(key).digest("hex")}.json`);

    fs.writeFileSync(filename, JSON.stringify({ pdb: "ATOM ...", cachedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 }));
    expect(await getRepairedStructureFromCache(key)).toBeNull();
  });

  it("refuses to cache an empty structure", async () => {
    const key = getRepairCacheKey("empty-hash", {});
    await writeRepairedStructureToCache(key, "");
    expect(await getRepairedStructureFromCache(key)).toBeNull();
  });
});

/**
 * A local repair that times out used to be retried on every request: the failure is never cached as a
 * result, and nothing else fills a `fix-shell` key. The backoff is the only thing that stops the loop.
 */
describe("repair failure backoff", () => {
  it("remembers a failure until the same repair succeeds", () => {
    const key = getRepairCacheKey("backoff-hash", {});
    expect(repairRecentlyFailed(key)).toBe(false);
    noteRepairFailure(key);
    expect(repairRecentlyFailed(key)).toBe(true);
    clearRepairFailure(key);
    expect(repairRecentlyFailed(key)).toBe(false);
  });

  it("keeps one position's failure away from another's", () => {
    const a = getRepairCacheKey("backoff-hash", {}, { chain: "A", resSeq: 100, insCode: "" });
    const b = getRepairCacheKey("backoff-hash", {}, { chain: "A", resSeq: 200, insCode: "" });
    noteRepairFailure(a);
    expect(repairRecentlyFailed(a)).toBe(true);
    expect(repairRecentlyFailed(b)).toBe(false);
    clearRepairFailure(a);
  });

  it("counts failures for the `none` instrumentation", () => {
    const before = repairFailureTotal();
    noteRepairFailure(getRepairCacheKey("counted-hash", {}));
    expect(repairFailureTotal()).toBe(before + 1);
  });
});
