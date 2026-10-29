import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { energeticsDataSchema } from "../../../../src/shared/contracts.ts";
import {
  getFoldxCacheKey,
  getMutantFromCache,
  mutantCache,
  getRepairCacheKey,
  getRepairedStructureFromCache,
  writeRepairedStructureToCache,
  repairedStructureCache,
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

  it("supersedes a provisional mutant once its background repair is available", async () => {
    const repairKey = getRepairCacheKey("upgrade");
    const key = getFoldxCacheKey("upgrade", "SA159C");
    mutantCache.set(key, { status: "success", ddG: 0.5761, energetics: {
      foldxRepairSkipped: true, foldxRepairCacheKey: repairKey
    } });
    expect(await getMutantFromCache(key)).not.toBeNull();
    await writeRepairedStructureToCache(repairKey, "ATOM repaired");
    expect(await getMutantFromCache(key)).toBeNull();
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
    const mutantA = getFoldxCacheKey(pdbHash, "SA489C", options);
    const mutantB = getFoldxCacheKey(pdbHash, "SA489W", options);
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
