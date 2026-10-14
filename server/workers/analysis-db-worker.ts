import {
  getOrCreateSqliteDb,
  executeSaveVariantAnalysis,
  executeGetVariantAnalysis,
  executeListRecentAnalyses,
  executeSaveExternalCache,
  executeGetExternalCache,
  executePurgeExpiredExternalCache,
  executePurgeOutdatedSchemaExternalCache,
  executePurgeStaleVariantAnalyses,
  type StoredVariantAnalysis,
  type StoredVariantAnalysisSummary,
  type AnalysisCacheOptions,
  type ExternalCacheRow
} from "../services/analysis-db-core.ts";

/**
 * Worker handler for saveVariantAnalysis
 */
export async function workerSaveVariantAnalysis({
  dbPath,
  params
}: {
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
  const db = getOrCreateSqliteDb(dbPath);
  return executeSaveVariantAnalysis(db, params);
}

/**
 * Worker handler for getVariantAnalysis
 */
export async function workerGetVariantAnalysis({
  dbPath,
  gene,
  variant,
  acmgWeighting,
  options
}: {
  dbPath?: string;
  gene: string;
  variant: string;
  acmgWeighting?: string;
  options?: AnalysisCacheOptions;
}): Promise<StoredVariantAnalysis | null> {
  const db = getOrCreateSqliteDb(dbPath);
  return executeGetVariantAnalysis(db, gene, variant, acmgWeighting, options);
}

/**
 * Worker handler for listRecentAnalyses
 */
export async function workerListRecentAnalyses({
  dbPath,
  limit,
  offset,
  includePayload
}: {
  dbPath?: string;
  limit?: number;
  offset?: number;
  includePayload?: boolean;
}): Promise<(StoredVariantAnalysis | StoredVariantAnalysisSummary)[]> {
  const db = getOrCreateSqliteDb(dbPath);
  return executeListRecentAnalyses(db, limit, offset, includePayload);
}

/**
 * Worker handler for saveExternalCache
 */
export async function workerSaveExternalCache({
  dbPath,
  cacheKey,
  data,
  source,
  ttlSeconds,
  etag,
  schemaVersion
}: {
  dbPath?: string;
  cacheKey: string;
  data: any;
  source: string;
  ttlSeconds?: number;
  etag?: string;
  schemaVersion?: string;
}): Promise<void> {
  const db = getOrCreateSqliteDb(dbPath);
  executeSaveExternalCache(db, cacheKey, data, source, ttlSeconds, etag, schemaVersion);
}

/**
 * Worker handler for getExternalCache
 */
export async function workerGetExternalCache({
  dbPath,
  cacheKey,
  includeExpired = false
}: {
  dbPath?: string;
  cacheKey: string;
  includeExpired?: boolean;
}): Promise<ExternalCacheRow | null> {
  const db = getOrCreateSqliteDb(dbPath);
  return executeGetExternalCache(db, cacheKey, includeExpired);
}

/**
 * Worker handler for purgeExpiredExternalCache
 */
export async function workerPurgeExpiredExternalCache({
  dbPath
}: {
  dbPath?: string;
}): Promise<number> {
  const db = getOrCreateSqliteDb(dbPath);
  return executePurgeExpiredExternalCache(db);
}

/**
 * Worker handler for purgeOutdatedSchemaExternalCache
 */
export async function workerPurgeOutdatedSchemaExternalCache({
  dbPath,
  currentVersion
}: {
  dbPath?: string;
  currentVersion?: string;
}): Promise<number> {
  const db = getOrCreateSqliteDb(dbPath);
  return executePurgeOutdatedSchemaExternalCache(db, currentVersion);
}

/**
 * Worker handler for purgeStaleVariantAnalyses
 */
export async function workerPurgeStaleVariantAnalyses({
  dbPath
}: {
  dbPath?: string;
}): Promise<number> {
  const db = getOrCreateSqliteDb(dbPath);
  return executePurgeStaleVariantAnalyses(db);
}
