import {
  costModelKey,
  type ClassCostModel,
  type CostModels,
  type JobType,
  type PowerLawFit,
} from "../../../src/shared/computeRouting.ts";

/**
 * cost-models.ts — turn job telemetry into the read-only `CostModels` snapshot the placement engine reads.
 *
 * The engine (`src/shared/computeRouting.ts`) is pure; this file is where measurements become curves.
 * It takes rows rather than a database handle, so the `job_telemetry` table (WP-0,
 * `compute-telemetry.ts`) owns storage and this file owns only the arithmetic. See
 * `doc/COMPUTE_ROUTING_PLAN.md`, section 5.3.
 *
 * The fit is deliberately plain: per (job type, host class), a least-squares line through
 * (log residues, log value), and the p90 of the residual ratio. No black box, so a reader can check a
 * prediction by hand, and refitting every 10 new samples is cheap.
 */

export type TelemetryOutcome = "completed" | "oom" | "timeout" | "failed" | "cancelled";

/** The subset of a `job_telemetry` row the fit needs. */
export interface TelemetrySample {
  type: JobType;
  hostClass: string;
  residues: number;
  wallMs: number | null;
  peakRssBytes: number | null;
  outcome: TelemetryOutcome;
}

/** Fewer distinct sizes than this cannot define a slope; the fit is skipped. */
const MIN_DISTINCT_SIZES = 2;

/** The empirical p90 of `actual / fitted`, never below 1 (p90 cannot be faster than p50). */
function p90Ratio(ratios: number[]): number {
  if (ratios.length === 0) return 1;
  const sorted = [...ratios].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.9 * sorted.length) - 1);
  return Math.max(1, sorted[idx]);
}

/** Least-squares `ln y = a + b ln x`. Returns null when the points cannot define a slope. */
export function fitPowerLaw(points: { x: number; y: number }[]): PowerLawFit | null {
  const usable = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0 && p.y > 0);
  if (new Set(usable.map((p) => p.x)).size < MIN_DISTINCT_SIZES) return null;
  const lx = usable.map((p) => Math.log(p.x));
  const ly = usable.map((p) => Math.log(p.y));
  const n = usable.length;
  const mx = lx.reduce((s, v) => s + v, 0) / n;
  const my = ly.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (lx[i] - mx) * (ly[i] - my);
    sxx += (lx[i] - mx) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const ratios = usable.map((p, i) => p.y / Math.exp(a + b * lx[i]));
  return { a, b, p90Ratio: p90Ratio(ratios) };
}

/**
 * The out-of-memory ceiling for one class: jobs must be strictly smaller than the smallest size that
 * ran out of memory. The plan makes a single OOM provisional and two at the same size sticky; the
 * snapshot treats both as a ceiling (refusing is the safe side), and `sticky` tells admission whether a
 * host with more RAM may reset it.
 */
export function oomCeiling(samples: TelemetrySample[]): { residues: number; sticky: boolean } | null {
  const sizes = samples.filter((s) => s.outcome === "oom").map((s) => s.residues);
  if (sizes.length === 0) return null;
  const min = Math.min(...sizes);
  return { residues: min, sticky: sizes.filter((s) => s === min).length >= 2 };
}

/**
 * The ceiling the engine ENFORCES: the second-smallest out-of-memory size, i.e. the smallest size at or
 * below which the host has died for memory at least twice. One death alone teaches nothing enforceable:
 * a single misclassified failure would otherwise refuse every job that size and larger, for good.
 * Old deaths age out in `loadSamples` (30 days), and an admin can forget them (`DELETE /admin/compute/ceilings`).
 */
export function enforcedOomCeiling(samples: TelemetrySample[]): number | null {
  const sizes = samples.filter((s) => s.outcome === "oom").map((s) => s.residues).sort((a, b) => a - b);
  return sizes.length >= 2 ? sizes[1] : null;
}

/** Build the snapshot. Only completed jobs feed the curves; only OOMs set ceilings. */
export function buildCostModels(samples: TelemetrySample[]): CostModels {
  const groups = new Map<string, TelemetrySample[]>();
  for (const s of samples) {
    const key = costModelKey(s.type, s.hostClass);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const models: Record<string, ClassCostModel> = {};
  for (const [key, rows] of groups) {
    const completed = rows.filter((r) => r.outcome === "completed");
    models[key] = {
      samples: completed.length,
      wall: fitPowerLaw(completed.filter((r) => r.wallMs != null).map((r) => ({ x: r.residues, y: r.wallMs as number }))),
      peakRam: fitPowerLaw(completed.filter((r) => r.peakRssBytes != null).map((r) => ({ x: r.residues, y: r.peakRssBytes as number }))),
      maxCompletedResidues: completed.length > 0 ? Math.max(...completed.map((r) => r.residues)) : null,
      oomCeilingResidues: enforcedOomCeiling(rows),
    };
  }
  return Object.freeze(models);
}
