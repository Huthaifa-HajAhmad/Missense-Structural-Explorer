import { DatabaseSync } from "node:sqlite";
import path from "path";
import { CACHE_SCHEMA_VERSION } from "./cache-keys.ts";
import {
  getOrCreateSqliteDb,
  closeSqliteDb,
  executeSaveVariantAnalysis,
  executeGetVariantAnalysis,
  executeListRecentAnalyses,
  executeSaveExternalCache,
  executeGetExternalCache,
  executePurgeExpiredExternalCache,
  executePurgeOutdatedSchemaExternalCache,
  executePurgeStaleVariantAnalyses,
  StoredVariantAnalysis,
  StoredVariantAnalysisSummary,
  AnalysisCacheOptions
} from "./analysis-db-core.ts";
import {
  runSaveVariantAnalysisInWorker,
  runGetVariantAnalysisInWorker,
  runListRecentAnalysesInWorker,
  runSaveExternalCacheInWorker,
  runGetExternalCacheInWorker,
  runPurgeStaleVariantAnalysesInWorker
} from "./analysis-db-pool.ts";

export type { StoredVariantAnalysis, StoredVariantAnalysisSummary, AnalysisCacheOptions };

export class AnalysisDatabase {
  private static instance: AnalysisDatabase | null = null;
  private db: DatabaseSync;
  private targetPath: string;

  private constructor(dbPath?: string) {
    const targetPath = dbPath || process.env.ANALYSIS_DB_PATH || path.join(process.cwd(), "data", "analyses.sqlite");
    this.targetPath = targetPath;
    this.db = getOrCreateSqliteDb(targetPath);

    try {
      this.purgeExpiredExternalCache();
      this.purgeOutdatedSchemaExternalCache(CACHE_SCHEMA_VERSION);
      setImmediate(() => {
        try {
          if (this.targetPath !== ":memory:") {
            runPurgeStaleVariantAnalysesInWorker({ dbPath: this.targetPath }).catch(() => {});
          } else {
            this.purgeStaleVariantAnalyses();
          }
        } catch (_) {}
      });
    } catch (_) {}
  }

  public static getInstance(dbPath?: string): AnalysisDatabase {
    if (!AnalysisDatabase.instance) {
      AnalysisDatabase.instance = new AnalysisDatabase(dbPath);
    }
    return AnalysisDatabase.instance;
  }

  /**
   * For testing purposes to reset or use an in-memory/custom DB
   */
  public static resetInstance(dbPath?: string): AnalysisDatabase {
    if (AnalysisDatabase.instance) {
      try {
        closeSqliteDb(AnalysisDatabase.instance.targetPath);
      } catch (_) {}
      AnalysisDatabase.instance = null;
    }
    AnalysisDatabase.instance = new AnalysisDatabase(dbPath);
    return AnalysisDatabase.instance;
  }

  public saveVariantAnalysis(params: {
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
  }): StoredVariantAnalysis {
    return executeSaveVariantAnalysis(this.db, params);
  }

  /**
   * Asynchronous non-blocking companion to saveVariantAnalysis that dispatches to worker pool.
   */
  public async saveVariantAnalysisAsync(params: {
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
  }): Promise<StoredVariantAnalysis> {
    if (this.targetPath === ":memory:") {
      await new Promise<void>(resolve => setImmediate(resolve));
      return this.saveVariantAnalysis(params);
    }
    try {
      return await runSaveVariantAnalysisInWorker({ dbPath: this.targetPath, params });
    } catch (err) {
      console.warn("[AnalysisDatabase] Worker dispatch fallback to sync saveVariantAnalysis:", err);
      return this.saveVariantAnalysis(params);
    }
  }

  public getVariantAnalysis(
    gene: string,
    variant: string,
    acmgWeighting: string = "standard",
    options?: AnalysisCacheOptions
  ): StoredVariantAnalysis | null {
    return executeGetVariantAnalysis(this.db, gene, variant, acmgWeighting, options);
  }

  /**
   * Asynchronous non-blocking companion to getVariantAnalysis that dispatches to worker pool.
   */
  public async getVariantAnalysisAsync(
    gene: string,
    variant: string,
    acmgWeighting: string = "standard",
    options?: AnalysisCacheOptions
  ): Promise<StoredVariantAnalysis | null> {
    if (this.targetPath === ":memory:") {
      await new Promise<void>(resolve => setImmediate(resolve));
      return this.getVariantAnalysis(gene, variant, acmgWeighting, options);
    }
    try {
      return await runGetVariantAnalysisInWorker({ dbPath: this.targetPath, gene, variant, acmgWeighting, options });
    } catch (err) {
      console.warn("[AnalysisDatabase] Worker dispatch fallback to sync getVariantAnalysis:", err);
      return this.getVariantAnalysis(gene, variant, acmgWeighting, options);
    }
  }

  public listRecentAnalyses(limit?: number, offset?: number, includePayload?: false): StoredVariantAnalysisSummary[];
  public listRecentAnalyses(limit: number, offset: number, includePayload: true): StoredVariantAnalysis[];
  public listRecentAnalyses(limit = 50, offset = 0, includePayload = false): (StoredVariantAnalysis | StoredVariantAnalysisSummary)[] {
    return executeListRecentAnalyses(this.db, limit, offset, includePayload);
  }

  public listRecentAnalysesSummary(limit = 50, offset = 0): StoredVariantAnalysisSummary[] {
    return executeListRecentAnalyses(this.db, limit, offset, false) as StoredVariantAnalysisSummary[];
  }

  /**
   * Asynchronous non-blocking companion to listRecentAnalyses that dispatches to worker pool.
   */
  public async listRecentAnalysesAsync(limit?: number, offset?: number, includePayload?: false): Promise<StoredVariantAnalysisSummary[]>;
  public async listRecentAnalysesAsync(limit: number, offset: number, includePayload: true): Promise<StoredVariantAnalysis[]>;
  public async listRecentAnalysesAsync(limit = 50, offset = 0, includePayload = false): Promise<(StoredVariantAnalysis | StoredVariantAnalysisSummary)[]> {
    if (this.targetPath === ":memory:") {
      await new Promise<void>(resolve => setImmediate(resolve));
      return this.listRecentAnalyses(limit, offset, includePayload as any);
    }
    try {
      return await runListRecentAnalysesInWorker({ dbPath: this.targetPath, limit, offset, includePayload });
    } catch (err) {
      console.warn("[AnalysisDatabase] Worker dispatch fallback to sync listRecentAnalyses:", err);
      return this.listRecentAnalyses(limit, offset, includePayload as any);
    }
  }

  public saveExternalCache(
    cacheKey: string,
    data: any,
    source: string,
    ttlSeconds?: number,
    etag?: string,
    schemaVersion = CACHE_SCHEMA_VERSION
  ): void {
    executeSaveExternalCache(this.db, cacheKey, data, source, ttlSeconds, etag, schemaVersion);
  }

  public getExternalCache<T = any>(cacheKey: string): { data: T; source: string; fetchedAt: string; etag: string | null } | null {
    return executeGetExternalCache<T>(this.db, cacheKey);
  }

  /**
   * Asynchronous non-blocking companion to saveExternalCache that dispatches to worker pool.
   */
  public async saveExternalCacheAsync(
    cacheKey: string,
    data: any,
    source: string,
    ttlSeconds?: number,
    etag?: string,
    schemaVersion = CACHE_SCHEMA_VERSION
  ): Promise<void> {
    if (this.targetPath === ":memory:") {
      await new Promise<void>(resolve => setImmediate(resolve));
      this.saveExternalCache(cacheKey, data, source, ttlSeconds, etag, schemaVersion);
      return;
    }
    try {
      await runSaveExternalCacheInWorker({ dbPath: this.targetPath, cacheKey, data, source, ttlSeconds, etag, schemaVersion });
    } catch (err) {
      console.warn("[AnalysisDatabase] Worker dispatch fallback to sync saveExternalCache:", err);
      this.saveExternalCache(cacheKey, data, source, ttlSeconds, etag, schemaVersion);
    }
  }

  /**
   * Asynchronous non-blocking companion to getExternalCache that dispatches to worker pool.
   */
  public async getExternalCacheAsync<T = any>(cacheKey: string): Promise<{ data: T; source: string; fetchedAt: string; etag: string | null } | null> {
    if (this.targetPath === ":memory:") {
      await new Promise<void>(resolve => setImmediate(resolve));
      return this.getExternalCache<T>(cacheKey);
    }
    try {
      return await runGetExternalCacheInWorker({ dbPath: this.targetPath, cacheKey });
    } catch (err) {
      console.warn("[AnalysisDatabase] Worker dispatch fallback to sync getExternalCache:", err);
      return this.getExternalCache<T>(cacheKey);
    }
  }

  public purgeExpiredExternalCache(): number {
    return executePurgeExpiredExternalCache(this.db);
  }

  public purgeOutdatedSchemaExternalCache(currentVersion = CACHE_SCHEMA_VERSION): number {
    return executePurgeOutdatedSchemaExternalCache(this.db, currentVersion);
  }

  public purgeStaleVariantAnalyses(): number {
    return executePurgeStaleVariantAnalyses(this.db);
  }

  public clearAll(): void {
    try {
      this.db.exec("DELETE FROM external_cache; DELETE FROM variant_analyses;");
    } catch (_) {}
  }
}
