import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { CACHE_SCHEMA_VERSION } from "./cache-keys.ts";

export interface StoredVariantAnalysis {
  id: number;
  gene: string;
  variant: string;
  uniprotId: string;
  pos: number;
  wildType: string;
  mutant: string;
  acmgWeighting: string;
  acmgVerdict: string | null;
  payload: any;
  modelVersions: any;
  createdAt: string;
  updatedAt: string;
}

export type StoredVariantAnalysisSummary = Omit<StoredVariantAnalysis, "payload" | "modelVersions">;

export interface AnalysisCacheOptions {
  /** Maximum age of cache in milliseconds (default: 30 days = 30 * 24 * 60 * 60 * 1000) */
  maxAgeMs?: number;
  /** Required pipeline engine version in model_versions_json */
  requiredVersion?: string;
  /** If true, bypass cache and return null */
  forceRefresh?: boolean;
}

const dbInstances = new Map<string, DatabaseSync>();

export function getOrCreateSqliteDb(dbPath?: string): DatabaseSync {
  const targetPath = dbPath || process.env.ANALYSIS_DB_PATH || path.join(process.cwd(), "data", "analyses.sqlite");
  if (dbInstances.has(targetPath) && targetPath !== ":memory:") {
    return dbInstances.get(targetPath)!;
  }

  if (targetPath !== ":memory:") {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(targetPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  } catch (_) {}

  initDatabaseSchema(db);

  if (targetPath !== ":memory:") {
    dbInstances.set(targetPath, db);
  }
  return db;
}

export function closeSqliteDb(dbPath?: string): void {
  const targetPath = dbPath || process.env.ANALYSIS_DB_PATH || path.join(process.cwd(), "data", "analyses.sqlite");
  if (dbInstances.has(targetPath)) {
    try {
      dbInstances.get(targetPath)?.close();
    } catch (_) {}
    dbInstances.delete(targetPath);
  }
}

export function initDatabaseSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS variant_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gene TEXT NOT NULL,
      variant TEXT NOT NULL,
      uniprot_id TEXT NOT NULL,
      pos INTEGER NOT NULL,
      wild_type TEXT NOT NULL,
      mutant TEXT NOT NULL,
      acmg_weighting TEXT NOT NULL DEFAULT 'standard',
      acmg_verdict TEXT,
      payload_json TEXT NOT NULL,
      model_versions_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(gene, variant, acmg_weighting)
    );

    CREATE INDEX IF NOT EXISTS idx_variant_analyses_lookup ON variant_analyses(gene, variant, acmg_weighting);
    CREATE INDEX IF NOT EXISTS idx_variant_analyses_uniprot_pos ON variant_analyses(uniprot_id, pos);
    CREATE INDEX IF NOT EXISTS idx_variant_analyses_created ON variant_analyses(created_at DESC);

    CREATE TABLE IF NOT EXISTS external_cache (
      cache_key TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      etag TEXT,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT,
      schema_version TEXT DEFAULT 'v3'
    );

    CREATE INDEX IF NOT EXISTS idx_external_cache_expires ON external_cache(expires_at);
  `);

  try {
    const columns = db.prepare("PRAGMA table_info(variant_analyses)").all() as any[];
    const hasWeighting = columns.some(c => c.name === "acmg_weighting");
    if (!hasWeighting && columns.length > 0) {
      db.exec("ALTER TABLE variant_analyses ADD COLUMN acmg_weighting TEXT NOT NULL DEFAULT 'standard';");
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_analyses_unique ON variant_analyses(gene, variant, acmg_weighting);");
  } catch (_) {}

  try {
    const extColumns = db.prepare("PRAGMA table_info(external_cache)").all() as any[];
    const hasSchemaVer = extColumns.some(c => c.name === "schema_version");
    if (!hasSchemaVer && extColumns.length > 0) {
      db.exec("ALTER TABLE external_cache ADD COLUMN schema_version TEXT DEFAULT 'v3';");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_external_cache_schema ON external_cache(schema_version);");
  } catch (_) {}
}

export function executeSaveVariantAnalysis(db: DatabaseSync, params: {
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
  const now = new Date().toISOString();
  const geneNorm = params.gene.trim().toUpperCase();
  const variantNorm = params.variant.trim();
  const weightingNorm = params.acmgWeighting || "standard";
  const payloadJson = JSON.stringify(params.payload);
  const modelVersionsJson = params.modelVersions ? JSON.stringify(params.modelVersions) : null;

  const stmt = db.prepare(`
    INSERT INTO variant_analyses (
      gene, variant, uniprot_id, pos, wild_type, mutant, acmg_weighting, acmg_verdict,
      payload_json, model_versions_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(gene, variant, acmg_weighting) DO UPDATE SET
      uniprot_id = excluded.uniprot_id,
      pos = excluded.pos,
      wild_type = excluded.wild_type,
      mutant = excluded.mutant,
      acmg_verdict = excluded.acmg_verdict,
      payload_json = excluded.payload_json,
      model_versions_json = excluded.model_versions_json,
      updated_at = excluded.updated_at
    RETURNING id, created_at, updated_at;
  `);

  const result = stmt.get(
    geneNorm,
    variantNorm,
    params.uniprotId,
    params.pos,
    params.wildType,
    params.mutant,
    weightingNorm,
    params.acmgVerdict || null,
    payloadJson,
    modelVersionsJson,
    now,
    now
  ) as any;

  return {
    id: Number(result?.id ?? 0),
    gene: geneNorm,
    variant: variantNorm,
    uniprotId: params.uniprotId,
    pos: params.pos,
    wildType: params.wildType,
    mutant: params.mutant,
    acmgWeighting: weightingNorm,
    acmgVerdict: params.acmgVerdict || null,
    payload: params.payload,
    modelVersions: params.modelVersions || null,
    createdAt: result?.created_at || now,
    updatedAt: result?.updated_at || now
  };
}

export function executeGetVariantAnalysis(
  db: DatabaseSync,
  gene: string,
  variant: string,
  acmgWeighting: string = "standard",
  options?: AnalysisCacheOptions
): StoredVariantAnalysis | null {
  if (options?.forceRefresh) {
    return null;
  }

  const geneNorm = gene.trim().toUpperCase();
  const variantNorm = variant.trim();
  const weightingNorm = acmgWeighting || "standard";

  const stmt = db.prepare(`
    SELECT id, gene, variant, uniprot_id, pos, wild_type, mutant, acmg_weighting,
           acmg_verdict, payload_json, model_versions_json, created_at, updated_at
    FROM variant_analyses
    WHERE gene = ? AND variant = ? AND acmg_weighting = ?;
  `);

  const row = stmt.get(geneNorm, variantNorm, weightingNorm) as any;
  if (!row) return null;

  const maxAge = options?.maxAgeMs ?? (30 * 24 * 60 * 60 * 1000);
  const updatedTime = new Date(row.updated_at).getTime();
  if (!isNaN(updatedTime) && (Date.now() - updatedTime) > maxAge) {
    return null;
  }

  let parsedModelVersions: any = null;
  if (row.model_versions_json) {
    try {
      parsedModelVersions = JSON.parse(row.model_versions_json);
    } catch (_) {}
  }

  if (options?.requiredVersion && parsedModelVersions?.version !== options.requiredVersion) {
    return null;
  }

  let parsedPayload: any = null;
  try {
    parsedPayload = JSON.parse(row.payload_json);
  } catch (_) {
    return null;
  }

  return {
    id: Number(row.id),
    gene: row.gene,
    variant: row.variant,
    uniprotId: row.uniprot_id,
    pos: Number(row.pos),
    wildType: row.wild_type,
    mutant: row.mutant,
    acmgWeighting: row.acmg_weighting || "standard",
    acmgVerdict: row.acmg_verdict,
    payload: parsedPayload,
    modelVersions: parsedModelVersions,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function executeListRecentAnalyses(
  db: DatabaseSync,
  limit = 50,
  offset = 0,
  includePayload = false
): (StoredVariantAnalysis | StoredVariantAnalysisSummary)[] {
  if (!includePayload) {
    const stmt = db.prepare(`
      SELECT id, gene, variant, uniprot_id, pos, wild_type, mutant, acmg_weighting,
             acmg_verdict, created_at, updated_at
      FROM variant_analyses
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?;
    `);

    const rows = stmt.all(limit, offset) as any[];
    return rows.map(row => ({
      id: Number(row.id),
      gene: row.gene,
      variant: row.variant,
      uniprotId: row.uniprot_id,
      pos: Number(row.pos),
      wildType: row.wild_type,
      mutant: row.mutant,
      acmgWeighting: row.acmg_weighting || "standard",
      acmgVerdict: row.acmg_verdict,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  const stmt = db.prepare(`
    SELECT id, gene, variant, uniprot_id, pos, wild_type, mutant, acmg_weighting,
           acmg_verdict, payload_json, model_versions_json, created_at, updated_at
    FROM variant_analyses
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?;
  `);

  const rows = stmt.all(limit, offset) as any[];
  return rows.map(row => ({
    id: Number(row.id),
    gene: row.gene,
    variant: row.variant,
    uniprotId: row.uniprot_id,
    pos: Number(row.pos),
    wildType: row.wild_type,
    mutant: row.mutant,
    acmgWeighting: row.acmg_weighting || "standard",
    acmgVerdict: row.acmg_verdict,
    payload: JSON.parse(row.payload_json),
    modelVersions: row.model_versions_json ? JSON.parse(row.model_versions_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function executeSaveExternalCache(
  db: DatabaseSync,
  cacheKey: string,
  data: any,
  source: string,
  ttlSeconds?: number,
  etag?: string,
  schemaVersion = CACHE_SCHEMA_VERSION
): void {
  const now = new Date();
  const fetchedAt = now.toISOString();
  const expiresAt = ttlSeconds ? new Date(now.getTime() + ttlSeconds * 1000).toISOString() : null;
  const dataJson = JSON.stringify(data);

  const stmt = db.prepare(`
    INSERT INTO external_cache (cache_key, data_json, etag, source, fetched_at, expires_at, schema_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      data_json = excluded.data_json,
      etag = excluded.etag,
      source = excluded.source,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      schema_version = excluded.schema_version;
  `);

  stmt.run(cacheKey, dataJson, etag || null, source, fetchedAt, expiresAt, schemaVersion);
}

export function executeGetExternalCache<T = any>(
  db: DatabaseSync,
  cacheKey: string
): { data: T; source: string; fetchedAt: string; etag: string | null } | null {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    SELECT data_json, etag, source, fetched_at, expires_at
    FROM external_cache
    WHERE cache_key = ? AND (expires_at IS NULL OR expires_at > ?);
  `);

  const row = stmt.get(cacheKey, now) as any;
  if (!row) return null;

  try {
    return {
      data: JSON.parse(row.data_json),
      source: row.source,
      fetchedAt: row.fetched_at,
      etag: row.etag || null
    };
  } catch {
    return null;
  }
}

export function executePurgeExpiredExternalCache(db: DatabaseSync): number {
  const now = new Date().toISOString();
  const info = db.prepare("DELETE FROM external_cache WHERE expires_at IS NOT NULL AND expires_at < ?;").run(now);
  return Number(info?.changes ?? 0);
}

export function executePurgeOutdatedSchemaExternalCache(db: DatabaseSync, currentVersion = CACHE_SCHEMA_VERSION): number {
  const info = db.prepare("DELETE FROM external_cache WHERE schema_version IS NULL OR schema_version != ?;").run(currentVersion);
  return Number(info?.changes ?? 0);
}

export function executePurgeStaleVariantAnalyses(db: DatabaseSync): number {
  try {
    const rows = db.prepare("SELECT id, payload_json FROM variant_analyses LIMIT 1000").all() as any[];
    if (rows.length === 0) return 0;

    const toDelete: number[] = [];
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload_json);
        if (
          !payload ||
          (typeof payload === "object" && Object.keys(payload).length === 0) ||
          (payload.error && !payload.ruleBasedInsights && !payload.clinvar)
        ) {
          toDelete.push(Number(row.id));
        }
      } catch {
        toDelete.push(Number(row.id));
      }
    }

    if (toDelete.length === 0) return 0;

    const placeholders = toDelete.map(() => "?").join(",");
    const info = db.prepare(`DELETE FROM variant_analyses WHERE id IN (${placeholders});`).run(...toDelete);
    return Number(info?.changes ?? 0);
  } catch {
    return 0;
  }
}
