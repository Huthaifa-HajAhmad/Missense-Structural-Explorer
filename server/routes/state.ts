/**
 * state.ts — Shared mutable server state and type definitions.
 *
 * Extracted here to break the circular import chain:
 *   routes.ts → routes/index.ts → routes/variant.ts → routes.ts  (CIRCULAR)
 *
 * Now both routes.ts and route modules import from here instead.
 */

export interface FoldXResult {
  pdb: string;
  ddG: number | null;
  status: string;
  foldedResidueIndex: number;
  resolvedChain?: string;
  energetics?: {
    foldxMean: number | null;
    foldxSd: number | null;
    foldx: number | null;
    dynamut2: number | null;
    ddmut: number | null;
    rasp: number | null;
    thermompnn: number | null;
    vdw: number | null;
    electrostatics: number | null;
    rawDdGs: number[];
    stericClashWarning: boolean;
    localSidechainRmsd: number | null;
    foldxRepairFailed?: boolean;
    seed?: number | null;
    consensusVerdict: string | null;
    raspReason?: string;
  } | null;
}

export interface BackgroundTask {
  id: string;
  controller: AbortController;
  promise: Promise<any>;
}

import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import Redis from "ioredis";

export const activeBackgroundTasks: BackgroundTask[] = [];

export const PUBLIC_ENDPOINTS = [
  "/health",
  "/version",
  "/diagnostics",
  "/openapi.json",
  "/docs",
  "/api/v1/health",
  "/api/v1/version",
  "/api/v1/diagnostics",
  "/api/v1/openapi.json",
  "/api/docs",
  "/sidecar-health",
  "/api/v1/sidecar-health",
  "/capabilities",
  "/api/v1/capabilities",
  "/session/keys",
  "/session/refresh",
  "/api/v1/session/keys",
  "/api/v1/session/refresh",
  "/sequence",
  "/api/v1/sequence",
  "/pdb",
  "/api/v1/pdb",
  "/alphafold-pdb",
  "/api/v1/alphafold-pdb",
  "/homologs",
  "/api/v1/homologs",
  "/clinvar",
  "/api/v1/clinvar",
  "/literature",
  "/api/v1/literature",
  "/uniprot-features",
  "/api/v1/uniprot-features",
  "/landscape",
  "/api/v1/landscape",
  "/conservation-context",
  "/api/v1/conservation-context",
  "/pocket-finder",
  "/api/v1/pocket-finder",
  "/pocket-job",
  "/api/v1/pocket-job",
  "/nearest-residues",
  "/api/v1/nearest-residues",
  "/generate-mutant",
  "/api/v1/generate-mutant",
  "/foldx-job",
  "/api/v1/foldx-job",
  "/analyze-variant-biophysical",
  "/api/v1/analyze-variant-biophysical",
  "/structural-diff",
  "/api/v1/structural-diff",
  "/dynamut2-job",
  "/api/v1/dynamut2-job",
  "/ddmut-job",
  "/api/v1/ddmut-job",
  "/thermompnn-job",
  "/api/v1/thermompnn-job",
  "/jobs/events",
  "/api/v1/jobs/events",
  "/pocket-detect",
  "/api/v1/pocket-detect",
  "/analyze-variant",
  "/api/v1/analyze-variant",
  "/analyze-variant-narrative",
  "/api/v1/analyze-variant-narrative",
  "/resolve-gene",
  "/api/v1/resolve-gene",
  "/translate-variant",
  "/api/v1/translate-variant",
  "/esmfold",
  "/api/v1/esmfold",
  "/structural-align",
  "/api/v1/structural-align",
  "/validate-biohub-token",
  "/api/v1/validate-biohub-token",
  "/test-tamarind-connection",
  "/api/v1/test-tamarind-connection",
  "/test-hf-connection",
  "/api/v1/test-hf-connection",
  "/biophysics/verify-stability",
  "/api/v1/biophysics/verify-stability",
  "/structure/multimer",
  "/api/v1/structure/multimer",
  "/ppi/binding-affinity",
  "/api/v1/ppi/binding-affinity",
  "/alphagenome/region-saturation",
  "/api/v1/alphagenome/region-saturation",
];

// Initialize optional Redis Client
let redisClient: Redis | null = null;
let redisPub: Redis | null = null;
let redisSub: Redis | null = null;

if (process.env.REDIS_URL) {
  try {
    console.log(`[Redis] Connecting to Redis URL: ${process.env.REDIS_URL}`);
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Fail fast on connection errors
    });
    
    redisClient.on("error", (err: any) => {
      console.warn("[Redis] Client error, falling back to local storage:", err.message);
      redisClient = null;
    });

    redisPub = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    redisPub.on("error", () => { redisPub = null; });

    redisSub = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    redisSub.on("error", () => { redisSub = null; });
  } catch (err: any) {
    console.error("[Redis] Failed to initialize Redis:", err.message);
    redisClient = null;
    redisPub = null;
    redisSub = null;
  }
}

// Local task abort functions
export function abortLocalTask(taskId: string) {
  const task = activeBackgroundTasks.find((t) => t.id === taskId);
  if (task) {
    console.log(`[Task] Aborting local background task: ${taskId}`);
    task.controller.abort();
  }
}

// Broadcast task abort signal to the cluster
export function publishAbortTask(taskId: string) {
  if (redisPub) {
    redisPub.publish("task_abort", taskId).catch((err: any) => {
      console.error("[Redis] Failed to publish abort signal:", err.message);
    });
  }
  abortLocalTask(taskId);
}

// Subscribe to task abort events if Redis sub client is active
if (redisSub) {
  redisSub.subscribe("task_abort").then(() => {
    redisSub!.on("message", (channel: string, message: string) => {
      if (channel === "task_abort") {
        console.log(`[Redis] Received abort signal for task: ${message}`);
        abortLocalTask(message);
      }
    });
  }).catch((err: any) => {
    console.error("[Redis] Subscriptions failed:", err.message);
  });
}

class SqliteInFlightPrewarms {
  private db: DatabaseSync | null = null;
  private dbPath = path.join(process.cwd(), "data", "shared_state.sqlite");
  private TTL = 30 * 60 * 1000; // 30 minutes

  constructor() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS inflight_prewarms (
          key TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL
        );
      `);
    } catch (err: any) {
      console.error("[SharedState] Failed to initialize SQLite database for state, using in-memory fallback:", err.message);
      this.db = null;
    }
  }

  private inMemorySet = new Set<string>();
  private inMemoryExpirations = new Map<string, number>();

  has(key: string): boolean {
    const now = Date.now();
    if (!this.db) {
      const exp = this.inMemoryExpirations.get(key);
      if (exp && exp > now) {
        return true;
      }
      this.inMemorySet.delete(key);
      this.inMemoryExpirations.delete(key);
      return false;
    }

    try {
      // Clean up expired locks first
      this.db.prepare("DELETE FROM inflight_prewarms WHERE expires_at < ?").run(now);
      const row = this.db.prepare("SELECT 1 FROM inflight_prewarms WHERE key = ?").get(key) as any;
      return !!row;
    } catch (err: any) {
      console.error("[SharedState] Error querying SQLite state:", err.message);
      const exp = this.inMemoryExpirations.get(key);
      if (exp && exp > now) {
        return true;
      }
      this.inMemorySet.delete(key);
      this.inMemoryExpirations.delete(key);
      return false;
    }
  }

  add(key: string): boolean {
    const now = Date.now();
    const expiresAt = now + this.TTL;

    if (!this.db) {
      if (this.has(key)) return false;
      this.inMemorySet.add(key);
      this.inMemoryExpirations.set(key, expiresAt);
      return true;
    }

    try {
      // Clean up expired locks first
      this.db.prepare("DELETE FROM inflight_prewarms WHERE expires_at < ?").run(now);
      // Try atomic insert
      const result = this.db.prepare("INSERT OR IGNORE INTO inflight_prewarms (key, expires_at) VALUES (?, ?)").run(key, expiresAt);
      return (result.changes ?? 0) > 0;
    } catch (err: any) {
      console.error("[SharedState] Error inserting into SQLite state:", err.message);
      if (this.has(key)) return false;
      this.inMemorySet.add(key);
      this.inMemoryExpirations.set(key, expiresAt);
      return true;
    }
  }

  delete(key: string): boolean {
    if (!this.db) {
      this.inMemoryExpirations.delete(key);
      return this.inMemorySet.delete(key);
    }

    try {
      const result = this.db.prepare("DELETE FROM inflight_prewarms WHERE key = ?").run(key);
      return (result.changes ?? 0) > 0;
    } catch (err: any) {
      console.error("[SharedState] Error deleting from SQLite state:", err.message);
      return this.inMemorySet.delete(key);
    }
  }
}

const sqlitePrewarms = new SqliteInFlightPrewarms();

class RedisInFlightPrewarms {
  private TTL = 30 * 60; // 30 minutes in seconds

  async has(key: string): Promise<boolean> {
    if (redisClient) {
      try {
        const val = await redisClient.get(`prewarm:${key}`);
        return !!val;
      } catch (err: any) {
        console.error("[Redis] Error checking prewarm lock:", err.message);
      }
    }
    return sqlitePrewarms.has(key);
  }

  async add(key: string): Promise<boolean> {
    if (redisClient) {
      try {
        const res = await redisClient.set(`prewarm:${key}`, "1", "EX", this.TTL, "NX");
        return res === "OK";
      } catch (err: any) {
        console.error("[Redis] Error adding prewarm lock:", err.message);
      }
    }
    return sqlitePrewarms.add(key);
  }

  async delete(key: string): Promise<boolean> {
    if (redisClient) {
      try {
        const res = await redisClient.del(`prewarm:${key}`);
        return res > 0;
      } catch (err: any) {
        console.error("[Redis] Error deleting prewarm lock:", err.message);
      }
    }
    return sqlitePrewarms.delete(key);
  }
}

export const inFlightPrewarms = new RedisInFlightPrewarms();
