import path from "path";
import fs from "fs";
import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { defaultCacheRegistry } from "../../infra/cache-registry.ts";

export const mutantCache = new LRUCache<string, any>({
  max: 100,
  maxSize: 100 * 1024 * 1024, // 100MB limit (M-6)
  sizeCalculation: (value) => (value && typeof value.pdb === "string" ? value.pdb.length : 1000),
  ttl: 24 * 60 * 60 * 1000 // 24 hours in-memory TTL
});
defaultCacheRegistry.registerCache("mutantCache", mutantCache, { ttlDesc: "24h" });

const FOLDX_CACHE_DIR = path.join(process.cwd(), "logs", "foldx_cache");
if (!fs.existsSync(FOLDX_CACHE_DIR)) {
  try {
    fs.mkdirSync(FOLDX_CACHE_DIR, { recursive: true });
  } catch (_) {}
}

export function getCacheFilename(cacheKey: string): string {
  const hash = crypto.createHash("sha256").update(cacheKey).digest("hex");
  return path.join(FOLDX_CACHE_DIR, `${hash}.json`);
}

export async function getMutantFromCache(cacheKey: string): Promise<any | null> {
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

    mutantCache.set(cacheKey, result);
    const entry = {
      ...result,
      cachedAt: Date.now()
    };
    const filename = getCacheFilename(cacheKey);
    const tmpFilename = `${filename}.tmp.${process.pid}.${crypto.randomUUID()}`;
    fs.promises.mkdir(FOLDX_CACHE_DIR, { recursive: true })
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
}

export function getFoldxCacheKey(
  pdbHash: string,
  mutation: string,
  options?: FoldxCacheKeyOptions
): string {
  const FOLDX_CACHE_VERSION = "v2";
  const seed = options?.seed !== undefined ? options.seed : 12345;
  return `${pdbHash}_${mutation}_pH:${options?.pH ?? 7.0}_temp:${options?.temperature ?? 298}_ion:${options?.ionicStrength ?? 0.05}_seed:${seed}_version:${FOLDX_CACHE_VERSION}`;
}
