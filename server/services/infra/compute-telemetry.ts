/**
 * compute-telemetry.ts — one row per finished job, and the cost models learned from them
 * (doc/COMPUTE_ROUTING_PLAN.md 5.3).
 *
 * The table lives in the queue's own database, beside `biophysical_jobs`, and the queue writes a row
 * when a job settles: it is the one place that sees every ending (completed, failed, timed out,
 * cancelled, killed for memory), including the ones the worker callback never returns from.
 *
 * Peak memory is not sampled yet (WP-0's process sampler), so `peak_rss_bytes` is null and the engine
 * uses its conservative size rule. Wall time and out-of-memory ceilings are learned now.
 */
import type { DatabaseSync } from "node:sqlite";
import type { JobType } from "../../../src/shared/computeRouting.ts";
import { buildCostModels, type TelemetryOutcome, type TelemetrySample } from "./cost-models.ts";
import type { CostModels } from "../../../src/shared/computeRouting.ts";

export interface TelemetryRow {
  jobId: string;
  type: JobType;
  hostId: string;
  hostClass: string;
  residues: number;
  repaired: boolean | null;
  runs: number | null;
  wallMs: number | null;
  peakRssBytes: number | null;
  outcome: TelemetryOutcome;
  errorClass: string | null;
  toolVersion: string | null;
  createdAt: number;
}

export function ensureTelemetryTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_telemetry (
      job_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      host_id TEXT NOT NULL,
      host_class TEXT NOT NULL,
      residues INTEGER NOT NULL,
      chains INTEGER,
      runs INTEGER,
      repaired INTEGER,
      wall_ms INTEGER,
      peak_rss_bytes INTEGER,
      outcome TEXT NOT NULL,
      error_class TEXT,
      tool_version TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_telemetry_class ON job_telemetry(type, host_class, outcome);
  `);
}

/** Idempotent per job: a job that is re-queued by a restart and settles again keeps its last ending. */
export function recordTelemetry(db: DatabaseSync, row: TelemetryRow): void {
  db.prepare(`
    INSERT OR REPLACE INTO job_telemetry
      (job_id, type, host_id, host_class, residues, runs, repaired, wall_ms, peak_rss_bytes, outcome, error_class, tool_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.jobId, row.type, row.hostId, row.hostClass, row.residues, row.runs,
    row.repaired == null ? null : row.repaired ? 1 : 0,
    row.wallMs, row.peakRssBytes, row.outcome, row.errorClass, row.toolVersion, row.createdAt,
  );
}

/**
 * Samples the models learn from. Rows without a known size teach nothing about size, and cancelled
 * jobs say nothing about the host, so both are left out.
 */
/** An out-of-memory death older than this no longer sets a ceiling (the host or the tool may have changed). */
export const OOM_MEMORY_DAYS = 30;

export function loadSamples(db: DatabaseSync, limit = 5000, now = Date.now()): TelemetrySample[] {
  const rows = db.prepare(`
    SELECT type, host_class, residues, wall_ms, peak_rss_bytes, outcome FROM job_telemetry
    WHERE residues > 0 AND outcome != 'cancelled' AND (outcome != 'oom' OR created_at >= ?)
    ORDER BY created_at DESC LIMIT ?
  `).all(now - OOM_MEMORY_DAYS * 86_400_000, limit) as any[];
  return rows.map((r) => ({
    type: r.type,
    hostClass: r.host_class,
    residues: r.residues,
    wallMs: r.wall_ms ?? null,
    peakRssBytes: r.peak_rss_bytes ?? null,
    outcome: r.outcome,
  }));
}

/**
 * The models, refitted every `REFIT_EVERY` new samples rather than per request (5.3), and at once after
 * an out-of-memory death: a ceiling must stop the very next larger job, not the tenth.
 */
const REFIT_EVERY = 10;

export class CostModelCache {
  private models: CostModels | null = null;
  private pending = 0;

  constructor(private readonly db: DatabaseSync) {}

  noteRecorded(outcome: TelemetryOutcome): void {
    this.pending++;
    if (outcome === "oom") this.models = null;
  }

  get(): CostModels {
    if (!this.models || this.pending >= REFIT_EVERY) {
      this.models = buildCostModels(loadSamples(this.db));
      this.pending = 0;
    }
    return this.models;
  }
}
