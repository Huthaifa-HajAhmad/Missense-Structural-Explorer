/**
 * admission.ts — asks the placement engine whether a job can run, before it is queued
 * (doc/COMPUTE_ROUTING_PLAN.md WP-D).
 *
 * `COMPUTE_ROUTING` decides what the answer does:
 *   off     the engine is not consulted (today's behaviour).
 *   shadow  (default) the engine runs and its Decision is logged as one `[routing:shadow]` JSON line,
 *           and nothing changes. This is how the probe and the learned ceilings are checked against
 *           reality before anyone is refused.
 *   on      a `reject` becomes HTTP 422 with the engine's reason, and a job whose size has since gone
 *           past a learned out-of-memory ceiling is failed at claim time instead of being run and killed.
 *
 * Only the server is a host until agents exist (WP-F), so the engine's job here is the hard filters:
 * the tool is installed, and the structure is not larger than this host class has shown it can hold.
 */
import crypto from "crypto";
import {
  DEFAULT_ROUTING_POLICY,
  costModelKey,
  decidePlacement,
  foldxRepairApplies,
  hostClassOf,
  type CostModels,
  type Decision,
  type HostFeatures,
  type JobFeatures,
  type JobType,
  type PlacementPref,
  type RoutingPolicy,
} from "../../../src/shared/computeRouting.ts";

export type RoutingMode = "off" | "shadow" | "on";

/**
 * Default `shadow` in every deployment. Under test the default is `off`, so suites that enqueue jobs do
 * not probe the host (the P2Rank check starts Java); the admission tests set the mode explicitly.
 */
export function routingMode(): RoutingMode {
  const fallback = process.env.NODE_ENV === "test" ? "off" : "shadow";
  const raw = (process.env.COMPUTE_ROUTING || fallback).trim().toLowerCase();
  return raw === "off" || raw === "on" ? raw : "shadow";
}

/** The engine refused the job. Answered with 422 and the engine's reader-facing reasons. */
export class AdmissionError extends Error {
  readonly status = 422;
  readonly code = "CANNOT_RUN_HERE";
  constructor(readonly reasons: string[]) {
    super(reasons.join(" ") || "This job cannot run on the server.");
    this.name = "AdmissionError";
  }
}

/** What the queue knows about a job when it is submitted. */
export interface AdmissionInput {
  type: JobType;
  /** Of the structure actually used; 0 when unknown (the engine is then not consulted). */
  residues: number;
  /** AlphaFold models skip RepairPDB; only FoldX uses this. */
  isAlphaFoldModel?: boolean;
  ownerId: string;
  placementPref?: PlacementPref;
}

export function jobFeaturesOf(input: AdmissionInput): JobFeatures {
  return {
    type: input.type,
    residues: input.residues,
    chains: 1,
    numberOfRuns: input.type === "foldx" ? 5 : 0,
    repair: input.type === "foldx" ? foldxRepairApplies(input.residues, Boolean(input.isAlphaFoldModel)) : false,
    ownerId: input.ownerId,
    requires: [{ tool: input.type }],
  };
}

function envNumber(name: string, fallback: number, ok: (n: number) => boolean): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (Number.isFinite(n) && ok(n)) return n;
  console.warn(`[routing] Ignoring ${name}=${JSON.stringify(raw)}: not a valid value; using ${fallback}.`);
  return fallback;
}

/**
 * The engine's tunables, from the environment (plan section 8), falling back to the shipped defaults.
 * Read per decision so a restart is all a change needs, and a bad value is logged and ignored rather
 * than allowed to make every job look tied, unmeasured or out of memory.
 */
export function routingPolicyFromEnv(placementPref: PlacementPref = "auto"): RoutingPolicy {
  return {
    placementPref,
    minSamples: Math.round(envNumber("COST_MODEL_MIN_SAMPLES", DEFAULT_ROUTING_POLICY.minSamples, (n) => n >= 1 && n <= 1000)),
    ramHeadroom: envNumber("ROUTING_RAM_HEADROOM", DEFAULT_ROUTING_POLICY.ramHeadroom, (n) => n >= 1 && n <= 4),
    nearTieFraction: envNumber("ROUTING_TIE_MARGIN", DEFAULT_ROUTING_POLICY.nearTieFraction, (n) => n >= 0 && n <= 1),
  };
}

export function decide(input: AdmissionInput, server: HostFeatures, models: CostModels): Decision {
  return decidePlacement(jobFeaturesOf(input), [server], routingPolicyFromEnv(input.placementPref ?? "auto"), models);
}

/** Pre-warm submissions are skipped: they are speculative and would drown the lines that matter. */
export function logShadow(input: AdmissionInput, decision: Decision, actual: string): void {
  if (input.ownerId === "system") return;
  console.log(`[routing:shadow] ${JSON.stringify({
    type: input.type,
    residues: input.residues,
    // A stable pseudonym, so one person's submissions can be followed without logging their account id.
    owner: input.ownerId === "legacy" ? "legacy" : crypto.createHash("sha256").update(input.ownerId).digest("hex").slice(0, 10),
    decision: decision.placement.kind,
    reasons: decision.reasons,
    rejected: decision.rejected,
    ranked: decision.ranked.map((r) => ({ host: r.hostId, wallMs: r.prediction.wallMs, basis: r.prediction.basis, samples: r.prediction.samples })),
    actual,
  })}`);
}

/**
 * At claim time: has a learned out-of-memory ceiling for this host class appeared since the job was
 * queued? Returns the reason to fail it with, or null to run it. Size only: it needs no probe, so the
 * scheduler can ask it synchronously for every claim.
 */
export function ceilingRefusal(
  type: JobType,
  residues: number,
  host: Pick<HostFeatures, "arch" | "emulated" | "cores" | "totalRamBytes">,
  models: CostModels,
): string | null {
  if (!(residues > 0)) return null;
  const ceiling = models[costModelKey(type, hostClassOf(host))]?.oomCeilingResidues;
  if (ceiling == null || residues < ceiling) return null;
  return `This structure (${residues} residues) is too large to run on the shared server: a structure of ${ceiling} residues ran out of memory there. It was not started.`;
}
