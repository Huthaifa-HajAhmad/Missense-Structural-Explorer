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
import { CONFIG } from "../config.ts";

export const activeBackgroundTasks: BackgroundTask[] = [];

export const PUBLIC_ENDPOINTS = [
  // Accounts (server/auth). Public at the token layer only: each route enforces its own rule —
  // sign-in routes are open, `/me/*` needs a user (requireUser), `/admin/*` an admin (requireAdmin),
  // `/setup` exists only until the first admin is created. AUTH_MODE still gates every write.
  "/auth",
  "/api/v1/auth",
  "/setup",
  "/api/v1/setup",
  "/me",
  "/api/v1/me",
  "/admin",
  "/api/v1/admin",
  // Pairing a computer (WP-F): asking for a code needs a signed-in person (requireUser); trading a code
  // for a token is the unpaired computer's own sign-in, throttled. Every other `/agent/*` route answers
  // only to an agent token, enforced in `accountAccess` before this list is read.
  "/agent/pair",
  "/api/v1/agent/pair",
  "/health",
  "/version",
  "/diagnostics",
  "/debug/cache-stats",
  "/openapi.json",
  "/docs",
  "/api/v1/health",
  "/api/v1/version",
  "/api/v1/diagnostics",
  "/api/v1/debug/cache-stats",
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
  "/alphagenome/verify-connection",
  "/api/v1/alphagenome/verify-connection",
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * IN-FLIGHT PREWARM CLAIMS — one key, one owner, one TTL derived from the queue
 * ─────────────────────────────────────────────────────────────────────────────
 * `add()` is the atomic claim (Redis `SET … NX`, SQLite `INSERT OR IGNORE`); `has()` exists for
 * inspection, not as a gate before `add()`. A caller that wants mutual exclusion must use `add()`'s
 * return value — `has()` followed by `add()` is two round trips and admits two owners.
 *
 * RELEASE BY OWNER: a claim may carry a token, and `delete(key, token)` releases it only while that
 * token still holds it. Without this, a claim whose TTL had expired could be re-claimed by a second
 * caller and then deleted by the FIRST caller's cleanup, silently admitting a third.
 */
export const PREWARM_CLAIM_TTL_MARGIN_MS = 60_000;

/**
 * How long a claim lives.
 *
 * DERIVED, not a literal: a claim must outlive the longest wait its holder is allowed to perform,
 * which is the queue's own stale-queued lease plus its stale-running lease (`prewarm-manager.ts`
 * gives up at exactly those). The previous value was a flat 30 minutes, which was EXACTLY
 * `CONFIG.timeouts.foldxQueuedLeaseMs` — so a claim could expire while its job was still
 * legitimately queued, and two prewarms for one variant could run at once. The margin covers the
 * gap between the holder's deadline check and its own release.
 */
export const PREWARM_CLAIM_TTL_MS =
  CONFIG.timeouts.foldxQueuedLeaseMs + CONFIG.timeouts.foldxReaperLeaseMs + PREWARM_CLAIM_TTL_MARGIN_MS;

class SqliteInFlightPrewarms {
  private db: DatabaseSync | null = null;
  /**
   * Resolved lazily from the environment so tests can redirect it.
   *
   * Previously a plain module-scope constant pointing at `<cwd>/data/shared_state.sqlite`.
   * This class is constructed in a MODULE-SCOPE initialiser below and is reachable from
   * `middleware.ts` through a value import of `PUBLIC_ENDPOINTS`, so merely importing the API
   * router opened the developer's real database — and two suites deleted that same file.
   */
  private get dbPath(): string {
    return process.env.SHARED_STATE_DB_PATH ?? path.join(process.cwd(), "data", "shared_state.sqlite");
  }

  constructor() {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
      /**
       * WAL + a busy timeout, exactly as the analysis database does.
       *
       * SQLite's default is to FAIL IMMEDIATELY when another connection holds the write lock, and this
       * file is shared by every worker thread in the process. A concurrent write therefore threw
       * "database is locked", the insert/delete was logged and dropped, and the in-flight prewarm
       * registry silently lost entries — in production that means duplicate prewarm jobs, and a stale
       * entry suppresses a legitimate one. (Observed as a load-dependent test failure:
       * `[SharedState] Error deleting from SQLite state: database is locked`.) With a busy timeout,
       * writers queue for up to 5s instead of erroring.
       */
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA busy_timeout = 5000;");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS inflight_prewarms (
          key TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          token TEXT
        );
      `);
      /**
       * `token` is a later addition, and this file is opened by every deployment without a
       * migration step. Adding the column to an existing table is the whole migration; a table that
       * already has it (or was just created with it) throws, which is the expected path.
       */
      try {
        this.db.exec("ALTER TABLE inflight_prewarms ADD COLUMN token TEXT;");
      } catch (alterErr: any) {
        /**
         * "duplicate column name" is the expected path — the table already had it, or was just
         * created with it. Anything else means claims cannot carry a token, which silently degrades
         * owner-checked release, so it is reported rather than swallowed.
         */
        if (!/duplicate column/i.test(alterErr?.message ?? "")) {
          console.error("[SharedState] Could not add the prewarm claim token column:", alterErr.message);
        }
      }
    } catch (err: any) {
      console.error("[SharedState] Failed to initialize SQLite database for state, using in-memory fallback:", err.message);
      this.db = null;
    }
  }

  /**
   * The fallback store, used when the database could not be opened or a write failed.
   *
   * A Map rather than the previous `Set` + separate expirations Map: one entry holds both facts, so
   * the claim decision is a single read-and-set with no `has()` call in front of it and no window
   * between two containers.
   */
  private inMemoryClaims = new Map<string, { expiresAt: number; token: string | null }>();

  /** One check-and-set. Synchronous by construction: nothing can interleave between the read and the write. */
  private claimInMemory(key: string, token: string | null, expiresAt: number, now: number): boolean {
    const existing = this.inMemoryClaims.get(key);
    if (existing && existing.expiresAt > now) {
      return false;
    }
    this.inMemoryClaims.set(key, { expiresAt, token });
    return true;
  }

  private releaseInMemory(key: string, token: string | undefined, now: number): boolean {
    const claim = this.inMemoryClaims.get(key);
    if (!claim) return false;
    if (claim.expiresAt <= now) {
      this.inMemoryClaims.delete(key);
      return false;
    }
    if (token !== undefined && claim.token !== token) {
      return false;
    }
    return this.inMemoryClaims.delete(key);
  }

  private hasInMemory(key: string, now: number): boolean {
    const claim = this.inMemoryClaims.get(key);
    if (!claim) return false;
    if (claim.expiresAt <= now) {
      this.inMemoryClaims.delete(key);
      return false;
    }
    return true;
  }

  has(key: string): boolean {
    const now = Date.now();
    if (!this.db) {
      return this.hasInMemory(key, now);
    }

    try {
      // Clean up expired locks first
      this.db.prepare("DELETE FROM inflight_prewarms WHERE expires_at < ?").run(now);
      const row = this.db.prepare("SELECT 1 FROM inflight_prewarms WHERE key = ?").get(key) as any;
      return !!row;
    } catch (err: any) {
      console.error("[SharedState] Error querying SQLite state:", err.message);
      return this.hasInMemory(key, now);
    }
  }

  /**
   * Claims `key`, atomically, for `token` when one is given.
   *
   * Returns true only for the caller that actually created the claim. This return value IS the
   * mutual exclusion; a caller that ignores it has no exclusion at all.
   */
  add(key: string, token?: string): boolean {
    const now = Date.now();
    const expiresAt = now + PREWARM_CLAIM_TTL_MS;

    if (!this.db) {
      return this.claimInMemory(key, token ?? null, expiresAt, now);
    }

    try {
      // Clean up expired locks first
      this.db.prepare("DELETE FROM inflight_prewarms WHERE expires_at < ?").run(now);
      // Try atomic insert
      const result = this.db.prepare("INSERT OR IGNORE INTO inflight_prewarms (key, expires_at, token) VALUES (?, ?, ?)")
        .run(key, expiresAt, token ?? null);
      return (result.changes ?? 0) > 0;
    } catch (err: any) {
      console.error("[SharedState] Error inserting into SQLite state:", err.message);
      /**
       * The database is unusable for this write, so the in-memory claim is the best available
       * answer. It deliberately does NOT re-query the database first: that query is the operation
       * that just failed, and re-running it is how the previous implementation turned a failed write
       * into a silent double claim.
       */
      return this.claimInMemory(key, token ?? null, expiresAt, now);
    }
  }

  /**
   * Releases `key`. With a token, only the claim's own owner can release it — a stale owner's
   * cleanup must not delete the claim a later caller now holds.
   */
  delete(key: string, token?: string): boolean {
    const now = Date.now();
    if (!this.db) {
      return this.releaseInMemory(key, token, now);
    }

    try {
      const result = token === undefined
        ? this.db.prepare("DELETE FROM inflight_prewarms WHERE key = ?").run(key)
        : this.db.prepare("DELETE FROM inflight_prewarms WHERE key = ? AND token = ?").run(key, token);
      return (result.changes ?? 0) > 0;
    } catch (err: any) {
      console.error("[SharedState] Error deleting from SQLite state:", err.message);
      return this.releaseInMemory(key, token, now);
    }
  }
}

const sqlitePrewarms = new SqliteInFlightPrewarms();

class RedisInFlightPrewarms {
  /** Seconds, because Redis `EX` takes seconds; derived from the same millisecond constant. */
  private TTL = Math.ceil(PREWARM_CLAIM_TTL_MS / 1000);

  /**
   * Compare-and-delete, so a release can only remove the claim its caller still owns.
   *
   * `GET` then `DEL` would be two round trips with a window between them: a claim that expired and
   * was re-claimed inside that window would be deleted by the previous owner.
   */
  private static readonly RELEASE_IF_OWNER_SCRIPT = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    end
    return 0
  `;

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

  async add(key: string, token?: string): Promise<boolean> {
    if (redisClient) {
      try {
        const res = await redisClient.set(`prewarm:${key}`, token ?? "1", "EX", this.TTL, "NX");
        return res === "OK";
      } catch (err: any) {
        console.error("[Redis] Error adding prewarm lock:", err.message);
      }
    }
    return sqlitePrewarms.add(key, token);
  }

  async delete(key: string, token?: string): Promise<boolean> {
    if (redisClient) {
      try {
        if (token === undefined) {
          const res = await redisClient.del(`prewarm:${key}`);
          return res > 0;
        }
        const res = await redisClient.eval(
          RedisInFlightPrewarms.RELEASE_IF_OWNER_SCRIPT,
          1,
          `prewarm:${key}`,
          token
        );
        return Number(res) > 0;
      } catch (err: any) {
        console.error("[Redis] Error deleting prewarm lock:", err.message);
      }
    }
    return sqlitePrewarms.delete(key, token);
  }
}

export const inFlightPrewarms = new RedisInFlightPrewarms();
