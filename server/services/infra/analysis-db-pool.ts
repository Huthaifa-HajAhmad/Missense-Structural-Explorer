import fs from "fs";
import Piscina from "piscina";
import path from "path";
import type { StoredVariantAnalysis, StoredVariantAnalysisSummary, AnalysisCacheOptions, ExternalCacheRow } from "./analysis-db-core.ts";

let dbPiscinaInstance: Piscina | null = null;

export function getAnalysisDbPool(): Piscina {
  if (!dbPiscinaInstance) {
    const prodCandidates = [
      path.resolve(process.cwd(), "dist/analysis-db-worker.cjs"),
      typeof __dirname !== "undefined" ? path.resolve(__dirname, "analysis-db-worker.cjs") : null,
      typeof __dirname !== "undefined" ? path.resolve(__dirname, "../dist/analysis-db-worker.cjs") : null,
    ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

    const devCandidates = [
      path.resolve(process.cwd(), "server/workers/analysis-db-worker.ts"),
      typeof __dirname !== "undefined" ? path.resolve(__dirname, "../../workers/analysis-db-worker.ts") : null,
    ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

    const isProd = (process.env.NODE_ENV === "production" && prodCandidates.length > 0) ||
      (typeof __dirname !== "undefined" && __dirname.includes("dist"));

    const workerPath = isProd
      ? (prodCandidates[0] || path.resolve(process.cwd(), "dist/analysis-db-worker.cjs"))
      : (devCandidates[0] || path.resolve(process.cwd(), "server/workers/analysis-db-worker.ts"));

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
  includeExpired?: boolean;
}): Promise<ExternalCacheRow | null> {
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
