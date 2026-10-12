import path from "path";
import fs from "fs";
import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { defaultCacheRegistry } from "../../infra/cache-registry.ts";
import { mayServe } from "../../../../src/shared/computeProvenance.ts";
import { serverProvenance } from "../../infra/host-probe.ts";

export const mutantCache = new LRUCache<string, any>({
  max: 100,
  maxSize: 100 * 1024 * 1024, // 100MB limit (M-6)
  sizeCalculation: (value) => (value && typeof value.pdb === "string" ? value.pdb.length : 1000),
  ttl: 24 * 60 * 60 * 1000 // 24 hours in-memory TTL
});
defaultCacheRegistry.registerCache("mutantCache", mutantCache, { ttlDesc: "24h" });

/**
 * FoldX disk-cache directory.
 *
 * Resolved from the environment (with the repository path as the production default) so tests
 * can redirect it. It was a frozen `process.cwd()` constant that read no variable, which made
 * this module — and the `/debug/clear-caches` handler that deletes the same directory — the last
 * places a test run could destroy real cached results.
 *
 * The directory is created lazily on first write rather than at import: an import-time
 * `mkdirSync` created a real folder under the repository as a side effect of merely importing
 * this module, including under test.
 */
export function getFoldxCacheDir(): string {
  return process.env.FOLDX_CACHE_DIR ?? path.join(process.cwd(), "logs", "foldx_cache");
}

function ensureFoldxCacheDir(): string {
  const dir = getFoldxCacheDir();
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
  }
  return dir;
}

export function getCacheFilename(cacheKey: string): string {
  const hash = crypto.createHash("sha256").update(cacheKey).digest("hex");
  return path.join(ensureFoldxCacheDir(), `${hash}.json`);
}

/**
 * A cached FoldX result for `cacheKey`, if there is one this requester may be served.
 *
 * `requesterId` is the signed-in person asking (null without an account). A result computed on
 * somebody's own computer is served to others only if it was validated and its owner shares results
 * (`mayServe`, src/shared/computeProvenance.ts); otherwise this answers "not cached" for them and the
 * run happens again. Omitted, only results shareable with anyone are returned.
 */
export async function getMutantFromCache(cacheKey: string, requesterId?: string | null): Promise<any | null> {
  const found = await readMutantFromCache(cacheKey);
  return found && mayServe(found, requesterId) ? found : null;
}

async function readMutantFromCache(cacheKey: string): Promise<any | null> {
  const memCached = mutantCache.get(cacheKey);
  if (memCached) {
    if (memCached?.status === "failed") {
      mutantCache.delete(cacheKey);
    } else {
      return memCached;
    }
  }

  try {
    const filename = getCacheFilename(cacheKey);
    let raw: string;
    try {
      raw = await fs.promises.readFile(filename, "utf-8");
    } catch {
      return null;
    }

    const parsed = JSON.parse(raw);
    const cachedAt = parsed.cachedAt || 0;
    const cacheAge = Date.now() - cachedAt;
    const ttlMs = 24 * 60 * 60 * 1000;
    if (cacheAge < ttlMs) {
      const { cachedAt: _, ...originalResult } = parsed;
      if (originalResult?.status === "failed") {
        fs.promises.unlink(filename).catch(() => {});
        return null;
      }
      mutantCache.set(cacheKey, originalResult);
      return originalResult;
    } else {
      fs.promises.unlink(filename).catch(() => {});
    }
  } catch (err: any) {
    console.error("[FoldX Cache Read Error]", err.message);
    try {
      const filename = getCacheFilename(cacheKey);
      fs.promises.unlink(filename).catch(() => {});
    } catch (_) {}
  }
  return null;
}

export function writeMutantToCache(cacheKey: string, result: any) {
  try {
    // Never cache results where RepairPDB failed, ddG is null, or status is not success
    if (!result || result.status !== "success" || result.ddG === null || result?.energetics?.foldxRepairFailed) {
      console.log("[FoldX Cache] Skipping in-memory and disk cache write for un-repaired/failed run.");
      return;
    }

    // Every stored result says where it ran. Results written here without one were computed by
    // this server (agent results arrive with their own, WP-F).
    if (!result.computeProvenance) result.computeProvenance = serverProvenance(null, "foldx");
    mutantCache.set(cacheKey, result);
    const entry = {
      ...result,
      cachedAt: Date.now()
    };
    const filename = getCacheFilename(cacheKey);
    const tmpFilename = `${filename}.tmp.${process.pid}.${crypto.randomUUID()}`;
    fs.promises.mkdir(getFoldxCacheDir(), { recursive: true })
      .then(async () => {
        await fs.promises.writeFile(tmpFilename, JSON.stringify(entry), "utf-8");
        await fs.promises.rename(tmpFilename, filename);
      })
      .catch(err => {
        fs.promises.unlink(tmpFilename).catch(() => {});
        console.error("[FoldX Cache Write Error]", err.message);
      });
  } catch (err: any) {
    console.error("[FoldX Cache Set Error]", err.message);
  }
}

export interface FoldxCacheKeyOptions {
  pH?: number;
  temperature?: number;
  ionicStrength?: number;
  seed?: number;
  /**
   * The FoldX version that will run it, when the host reports one (agents, WP-F). Part of the key so
   * two versions never share a result. Absent for the server, whose bundled FoldX is the one every
   * existing cache entry was computed with, so those entries stay valid.
   */
  toolVersion?: string;
}

export function getFoldxCacheKey(
  pdbHash: string,
  mutation: string,
  options?: FoldxCacheKeyOptions
): string {
  // v3: the run-averaging rule changed (MAD outlier filter removed, see parser.ts). A v2 entry holds
  // a mean and SD that discarded legitimate runs, so it must not be served as the current answer.
  const FOLDX_CACHE_VERSION = "v3";
  const seed = options?.seed !== undefined ? options.seed : 12345;
  const tool = options?.toolVersion ? `_foldx:${options.toolVersion}` : "";
  return `${pdbHash}_${mutation}_pH:${options?.pH ?? 7.0}_temp:${options?.temperature ?? 298}_ion:${options?.ionicStrength ?? 0.05}_seed:${seed}_version:${FOLDX_CACHE_VERSION}${tool}`;
}

// ---------------------------------------------------------------------------
// Repaired wild-type structures — the expensive half of a FoldX run
// ---------------------------------------------------------------------------

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND CACHE EXISTS (read before merging it into the mutant cache)
 * ─────────────────────────────────────────────────────────────────────────────
 * `RepairPDB` minimises the WILD-TYPE structure: it is a function of the structure and the FoldX
 * environment, and it does not depend on the mutation at all. The mutant cache key, however, has
 * always contained the mutation, so the repair was recomputed for every variant and thrown away
 * with the job directory (`server.ts` deletes it in the worker's `finally`).
 *
 * Measured on this repository's own leftover job dirs, same mutation, same position:
 *
 *   structure                  RepairPDB   BuildModel ×5   total
 *   AlphaFold, 875 residues    skipped     5.1 s           5.1 s
 *   experimental, 305 residues 205.4 s     2.2 s           208 s
 *
 * i.e. ~98% of the wall clock of a FoldX leg was spent re-deriving an artefact that was already
 * known. A ten-variant sweep of one gene paid it ten times (~34 minutes) for one structure.
 *
 * The repaired text is a deterministic transform of its input: the runner already pins the RNG
 * (`--timeSeedRotabase=false`, `seed` in the key) so the same structure and options always produce
 * the same coordinates. The TTL is therefore about invalidating a FoldX BINARY change, which the
 * version peg below covers explicitly, rather than about staleness in the usual sense.
 */
export const repairedStructureCache = new LRUCache<string, { pdb: string }>({
  max: 40,
  maxSize: 80 * 1024 * 1024,
  sizeCalculation: (value) => (typeof value?.pdb === "string" ? value.pdb.length : 1000),
  ttl: 30 * 24 * 60 * 60 * 1000 // 30 days, pegged to REPAIR_CACHE_VERSION
});
defaultCacheRegistry.registerCache("repairedStructureCache", repairedStructureCache, { ttlDesc: "30d" });

/** Bump when the FoldX binary or the repair command line changes. */
const REPAIR_CACHE_VERSION = "v1";

/** Repair depends on the structure and the force-field environment — never on the substitution. */
export function getRepairCacheKey(pdbHash: string, options?: FoldxCacheKeyOptions): string {
  const seed = options?.seed !== undefined ? options.seed : 12345;
  return `repair_${pdbHash}_pH:${options?.pH ?? 7.0}_temp:${options?.temperature ?? 298}_ion:${options?.ionicStrength ?? 0.05}_seed:${seed}_version:${REPAIR_CACHE_VERSION}`;
}

export async function getRepairedStructureFromCache(cacheKey: string): Promise<{ pdb: string } | null> {
  const memCached = repairedStructureCache.get(cacheKey);
  if (memCached?.pdb) return memCached;

  try {
    const raw = await fs.promises.readFile(getCacheFilename(cacheKey), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pdb !== "string" || parsed.pdb.length === 0) return null;

    const cacheAge = Date.now() - (parsed.cachedAt || 0);
    if (cacheAge >= 30 * 24 * 60 * 60 * 1000) {
      fs.promises.unlink(getCacheFilename(cacheKey)).catch(() => {});
      return null;
    }
    const entry = { pdb: parsed.pdb as string };
    repairedStructureCache.set(cacheKey, entry);
    return entry;
  } catch {
    // A miss, a malformed entry and an unreadable directory all mean the same thing here: repair
    // the structure. None of them may fail the job.
    return null;
  }
}

/**
 * Persists repaired coordinates, returning when the atomic write has settled.
 *
 * The promise is returned so callers (both the FoldX runner and tests) can await disk settlement
 * before proceeding. Internal error handling ensures a disk write error never fails or rejects the calling job.
 */
export function writeRepairedStructureToCache(cacheKey: string, pdb: string): Promise<void> {
  if (!pdb || pdb.length === 0) return Promise.resolve();
  try {
    repairedStructureCache.set(cacheKey, { pdb });
    const filename = getCacheFilename(cacheKey);
    const tmpFilename = `${filename}.tmp.${process.pid}.${crypto.randomUUID()}`;
    return fs.promises.mkdir(getFoldxCacheDir(), { recursive: true })
      .then(async () => {
        await fs.promises.writeFile(tmpFilename, JSON.stringify({ pdb, cachedAt: Date.now() }), "utf-8");
        await fs.promises.rename(tmpFilename, filename);
      })
      .catch(err => {
        fs.promises.unlink(tmpFilename).catch(() => {});
        console.error("[FoldX Repair Cache Write Error]", err.message);
      });
  } catch (err: any) {
    console.error("[FoldX Repair Cache Set Error]", err.message);
    return Promise.resolve();
  }
}
