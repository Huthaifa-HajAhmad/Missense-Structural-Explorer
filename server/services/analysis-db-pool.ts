import Piscina from "piscina";
import path from "path";
import type { StoredVariantAnalysis, StoredVariantAnalysisSummary, AnalysisCacheOptions } from "./analysis-db-core.ts";

let dbPiscinaInstance: Piscina | null = null;

export function getAnalysisDbPool(): Piscina {
  if (!dbPiscinaInstance) {
    let currentDir: string;
    if (typeof __dirname !== "undefined") {
      currentDir = __dirname;
    } else {
      currentDir = path.resolve(process.cwd(), "server/services");
    }

    const isProd = process.env.NODE_ENV === "production" || currentDir.includes("dist");

    let workerPath: string;
    if (isProd) {
      workerPath = path.resolve(currentDir, "analysis-db-worker.cjs");
    } else {
      workerPath = path.resolve(currentDir, "../workers/analysis-db-worker.ts");
    }

    const maxWorkersEnv = process.env.ANALYSIS_DB_WORKERS ? parseInt(process.env.ANALYSIS_DB_WORKERS, 10) : NaN;
    // For SQLite with WAL mode, 1-2 dedicated worker threads provide optimal concurrency without WAL lock contention
    const maxWorkers = !isNaN(maxWorkersEnv) && maxWorkersEnv > 0 ? maxWorkersEnv : 2;

    const execArgv = process.env.VITEST ? ["--import", "tsx"] : process.execArgv;

    dbPiscinaInstance = new Piscina({
      filename: workerPath,
      maxThreads: maxWorkers,
      minThreads: 1,
      idleTimeout: 30000,
      execArgv
    });
  }
  return dbPiscinaInstance;
}

export async function runSaveVariantAnalysisInWorker(params: {
  dbPath?: string;
  params: {
    gene: string;
    variant: string;
    uniprotId: string;
    pos: number;
    wildType: string;
    mutant: string;
    acmgWeighting?: string;
    acmgVerdict?: string | null;
    payload: any;
    modelVersions?: any;
  };
}): Promise<StoredVariantAnalysis> {
  return getAnalysisDbPool().run(params, { name: "workerSaveVariantAnalysis" });
}

export async function runGetVariantAnalysisInWorker(params: {
  dbPath?: string;
  gene: string;
  variant: string;
  acmgWeighting?: string;
  options?: AnalysisCacheOptions;
}): Promise<StoredVariantAnalysis | null> {
  return getAnalysisDbPool().run(params, { name: "workerGetVariantAnalysis" });
}

export async function runListRecentAnalysesInWorker(params: {
  dbPath?: string;
  limit?: number;
  offset?: number;
  includePayload?: boolean;
}): Promise<(StoredVariantAnalysis | StoredVariantAnalysisSummary)[]> {
  return getAnalysisDbPool().run(params, { name: "workerListRecentAnalyses" });
}

export async function runSaveExternalCacheInWorker(params: {
  dbPath?: string;
  cacheKey: string;
  data: any;
  source: string;
  ttlSeconds?: number;
  etag?: string;
  schemaVersion?: string;
}): Promise<void> {
  return getAnalysisDbPool().run(params, { name: "workerSaveExternalCache" });
}

export async function runGetExternalCacheInWorker(params: {
  dbPath?: string;
  cacheKey: string;
}): Promise<{ data: any; source: string; fetchedAt: string; etag: string | null } | null> {
  return getAnalysisDbPool().run(params, { name: "workerGetExternalCache" });
}

export async function runPurgeExpiredExternalCacheInWorker(params: {
  dbPath?: string;
}): Promise<number> {
  return getAnalysisDbPool().run(params, { name: "workerPurgeExpiredExternalCache" });
}

export async function runPurgeOutdatedSchemaExternalCacheInWorker(params: {
  dbPath?: string;
  currentVersion?: string;
}): Promise<number> {
  return getAnalysisDbPool().run(params, { name: "workerPurgeOutdatedSchemaExternalCache" });
}

export async function runPurgeStaleVariantAnalysesInWorker(params: {
  dbPath?: string;
}): Promise<number> {
  return getAnalysisDbPool().run(params, { name: "workerPurgeStaleVariantAnalyses" });
}

export async function shutdownDbPool() {
  if (dbPiscinaInstance) {
    await dbPiscinaInstance.destroy();
    dbPiscinaInstance = null;
  }
}
