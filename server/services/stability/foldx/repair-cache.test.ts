import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getFoldxCacheKey,
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
    repairedStructureCache.clear();
    if (originalEnv === undefined) delete process.env.FOLDX_CACHE_DIR;
    else process.env.FOLDX_CACHE_DIR = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
