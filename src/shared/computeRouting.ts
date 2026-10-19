/**
 * computeRouting.ts — where a heavy job should run, and the sentences that explain why.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * FoldX and P2Rank are the two jobs that go through the queue (`biophysical-queue.ts`). Today they always
 * run on the one OCI host, where FoldX is emulated under Box64 and is ~60x slower than on a native x64
 * desktop. `doc/COMPUTE_ROUTING_PLAN.md` (section 5) lets a user's own machine take that user's jobs.
 * This file is the decision: given one job, the candidate hosts and what has been measured, return a
 * placement and the plain reasons for it.
 *
 * It is PURE on purpose — no clock, no randomness, no I/O, and no imports from outside `src/shared`
 * (`scripts/check-boundaries.ts`, rule 3). The server builds the inputs from telemetry and passes them
 * in, so the same function can run in shadow mode, in admission, and in the browser for a preview, and
 * every test is a table of inputs and one expected Decision.
 *
 * HONESTY RULES
 * -------------
 *   • A prediction says whether it was fitted (`measured`) or taken from the priors below (`prior`).
 *   • Memory has NO invented number of gigabytes. `peakRamBytes` is null until a class has enough
 *     MEASURED peaks, and even then the conservative size rule in {@link decidePlacement} still bounds
 *     the job, so a two-point fit can never authorise a structure far past anything that has run.
 *   • P2Rank has no timing prior at all, so its wall time is null and hosts are ranked by load alone.
 *   • A rejection always names the closest miss. A bare "cannot run" is never emitted.
 */

// ── Shared constants ───────────────────────────────────────────────────────────────────────────────

/**
 * Structures above this size skip RepairPDB (a cost guard). The FoldX runner and the timeout-budget
 * test read it through `server/services/stability/foldx/budget.ts`, which re-exports this value, so
 * the engine's `repair` flag and the runner's behaviour cannot disagree.
 */
export const FOLDX_REPAIR_MAX_RESIDUES = 400;

/** Fitted curves are used only once a host class has at least this many completed samples. */
export const COST_MODEL_MIN_SAMPLES_DEFAULT = 8;

/** With no fitted model, p90 is this multiple of the prior's p50. */
export const PRIOR_P90_FACTOR = 2;

/** An agent's job costs this many round trips beyond its compute: claim, two heartbeats, result. */
export const AGENT_TRANSFER_ROUND_TRIPS = 4;

/** Used only when an agent has not reported its link round-trip time yet. */
export const AGENT_DEFAULT_RTT_MS = 250;

/** The conservative size rule: refuse above the largest completed size times this factor. */
export const UNMEASURED_SIZE_GROWTH = 1.25;

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  placementPref: "auto",
  nearTieFraction: 0.2,
  ramHeadroom: 1.25,
  minSamples: COST_MODEL_MIN_SAMPLES_DEFAULT,
};

// ── Types ──────────────────────────────────────────────────────────────────────────────────────────

export type JobType = "foldx" | "p2rank";
export type ToolName = "foldx" | "p2rank";
export type PlacementPref = "auto" | "my_machine" | "server_only";

export interface JobFeatures {
  type: JobType;
  /** Residues of the structure actually used. NEVER a scan-window length. */
  residues: number;
  chains: number;
  /** BuildModel runs (5 by default). Ignored for P2Rank. */
  numberOfRuns: number;
  /** RepairPDB runs for this job. Build it with {@link foldxRepairApplies}, not from size alone. */
  repair: boolean;
  ownerId: string;
  requires: { tool: ToolName; minVersion?: string }[];
}

export interface HostTool {
  name: string;
  version: string;
  /**
   * The tool may be relied on for routing. True when it passed its self-test, or when the self-test
   * only TIMED OUT on a busy host (a busy host proves nothing, so the tool is kept rather than
   * refused); false when it could not start or started and failed. `selfTest` carries that nuance.
   */
  verified: boolean;
  /** How the last self-test ended, when known. A timeout keeps `verified` true but is recorded here. */
  selfTest?: "passed" | "timeout" | "failed";
}

export interface HostFeatures {
  /** "server" or "agent:<id>". */
  id: string;
  kind: "server" | "agent";
  /** null for the server. */
  ownerId: string | null;
  /** A short name a reader recognises, e.g. "the shared server" or "Huthaifa's desktop". */
  label: string;
  online: boolean;
  arch: "x64" | "arm64";
  emulated: boolean;
  os: "linux" | "win32" | "darwin";
  cores: number;
  totalRamBytes: number;
  freeRamBytes: number;
  tools: HostTool[];
  /** Heavy jobs running now. Used to rank hosts when no wall-time prediction exists. */
  runningJobs: number;
  /** Sum of the predicted remaining time of its running jobs. */
  runningCostMs: number;
  /** Sum of the predicted time of jobs already placed on it and waiting. */
  queuedCostMs: number;
  /** Agents only; null when not measured yet. */
  linkRttMs: number | null;
  /** 0..1 over the last 20 claims; agents only (0 for the server). */
  leaseLossRate: number;
  /** The free-memory floor the host must keep (the server enforces 500 MB). */
  minFreeBytes: number;
}

/** A fitted power law `y = exp(a) * residues^b`, with the empirical p90/p50 ratio of its residuals. */
export interface PowerLawFit {
  a: number;
  b: number;
  p90Ratio: number;
}

/** What has been learned for one (job type, host class). Built by `server/services/infra/cost-models.ts`. */
export interface ClassCostModel {
  /** Completed samples behind the wall fit. */
  samples: number;
  wall: PowerLawFit | null;
  peakRam: PowerLawFit | null;
  /** Completed samples that carried a MEASURED peak; the memory fit needs this many, not `samples`. */
  peakRamSamples: number;
  /** Largest structure that completed on this class. */
  maxCompletedResidues: number | null;
  /** Hard ceiling learned from out-of-memory failures: jobs must be strictly below it. */
  oomCeilingResidues: number | null;
}

/** Read-only snapshot keyed by {@link costModelKey}. Missing keys mean "nothing measured". */
export type CostModels = Readonly<Record<string, ClassCostModel>>;

export interface Prediction {
  /** null when there is neither a fit nor a prior (P2Rank before telemetry). */
  wallMs: { p50: number; p90: number } | null;
  /** null until memory has been measured on this host class. */
  peakRamBytes: { p50: number; p90: number } | null;
  basis: "measured" | "prior";
  samples: number;
}

export type Placement = { kind: "server" } | { kind: "agent"; agentId: string } | { kind: "reject" };

export interface HostEvaluation {
  hostId: string;
  prediction: Prediction;
  /** Queue + running + predicted wall + transfer + reliability penalty; null without a wall prediction. */
  expectedCompletionMs: number | null;
}

export interface Decision {
  placement: Placement;
  /** Prediction for the chosen host; null on reject. */
  prediction: Prediction | null;
  /** Reader-facing, plain sentences. */
  reasons: string[];
  rejected: { hostId: string; because: string }[];
  /** Every feasible host, best first. Shadow mode logs this beside what actually happened. */
  ranked: HostEvaluation[];
}

export interface RoutingPolicy {
  placementPref: PlacementPref;
  /** Two hosts are a near tie when their expected completions differ by at most this fraction of the best. */
  nearTieFraction: number;
  /** Predicted p90 peak memory is multiplied by this before it is compared with free memory. */
  ramHeadroom: number;
  /** Samples a host class needs before its fitted curve replaces the prior. */
  minSamples: number;
}

// ── Small pure helpers ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether FoldX will run RepairPDB, exactly as `foldx/runner.ts` decides it: small enough AND not an
 * AlphaFold DB model (those are already well packed and skip repair). Size alone is not the rule.
 */
export function foldxRepairApplies(residues: number, isAlphaFoldPdb: boolean): boolean {
  return residues <= FOLDX_REPAIR_MAX_RESIDUES && !isAlphaFoldPdb;
}

const GIB = 1024 ** 3;

/**
 * The class a host's measurements are pooled under: architecture, emulation, cores and total RAM to
 * the nearest GiB (the OS reports a little less than the installed amount, so a "16 GB" machine that
 * shows 15.6 GiB still lands in the 16g class).
 */
export function hostClassOf(host: Pick<HostFeatures, "arch" | "emulated" | "cores" | "totalRamBytes">): string {
  const gib = Math.max(1, Math.round(host.totalRamBytes / GIB));
  return `${host.arch}-${host.emulated ? "emulated" : "native"}-${host.cores}c-${gib}g`;
}

export function costModelKey(type: JobType, hostClass: string): string {
  return `${type}|${hostClass}`;
}

/** Numeric dotted-version comparison ("5.1" < "5.10"); non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-+]/).map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(/[.\-+]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export function evalPowerLaw(fit: PowerLawFit, residues: number): { p50: number; p90: number } {
  const p50 = Math.exp(fit.a) * Math.max(1, residues) ** fit.b;
  return { p50: Math.round(p50), p90: Math.round(p50 * Math.max(1, fit.p90Ratio)) };
}

function formatGb(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GB`;
}

/** "167 s", "2.3 s", "4 min". Deterministic, no locale. */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 120_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

const TOOL_LABEL: Record<ToolName, string> = { foldx: "FoldX", p2rank: "P2Rank" };

// ── Priors (section 2.3 of the plan; the measurements are quoted, not re-derived) ─────────────────────

/**
 * Native x64 BuildModel, measured with `npm run foldx:timing` (comment above `foldxBuildModelMs` in
 * `server/config.ts`): 154 residues 2.3 s and 875 residues 4.7 s for 5 runs, ~0.5 s per extra run at 875.
 * A line `fixed + runs × residues × k` through both points gives k ≈ 0.666 ms and fixed ≈ 1.79 s, which
 * reproduces the ~0.58 s per extra run at 875 residues.
 */
const NATIVE_BUILDMODEL_FIXED_MS = 1787;
const NATIVE_BUILDMODEL_MS_PER_RESIDUE_RUN = 2400 / (5 * (875 - 154));

/**
 * Emulated (OCI ARM64 + Box64) BuildModel, same source: SLC12A4 (1,085 residues) 167.2 s for 5 runs,
 * 13.3 s fixed + 30.8 s per run; SOD1 (154) 9.6 s. Total time scales as ~residues^1.44 (`foldx/budget.ts`).
 * The power law is anchored on the 1,085-residue total and split between fixed and per-run in the
 * measured 13.3 : 153.9 proportion, so it reproduces 167.2 s (5 runs), 44.1 s (1 run, measured 44.0 s)
 * and ~10 s for SOD1.
 *
 * CAVEAT (2026-10-17, OCI host, n=3 per cell): those are the two anchors this curve passes through, and no
 * other size does. p53 (393 residues) took 173 s, 4.5x the curve; CNNM2 AlphaFold (875) took 22 s, 5.6x
 * below it; across the four sizes log(5-run total) on log(residues) has R^2 = 0.29. Per-run cost follows the
 * substitution (SLC12A4 Gln867 -> Ala/His/Lys, 1 run: 28/45/84 s) and, for an unrepaired crystal structure,
 * the incomplete residues FoldX rebuilds (4.7 s each); see `foldx/budget.ts`. Treat this as a coarse ETA
 * prior, not a bound.
 */
const EMULATED_ANCHOR_RESIDUES = 1085;
const EMULATED_ANCHOR_TOTAL_MS = 167_200;
const EMULATED_ANCHOR_RUNS = 5;
const EMULATED_FIXED_SHARE = 13_300 / EMULATED_ANCHOR_TOTAL_MS;
const EMULATED_EXPONENT = 1.44;

/** Total BuildModel time for `runs` on each host. Extracted so the repair prior can reuse the ratio. */
function nativeBuildModelTotalMs(r: number, runs: number): number {
  return NATIVE_BUILDMODEL_FIXED_MS + runs * r * NATIVE_BUILDMODEL_MS_PER_RESIDUE_RUN;
}
function emulatedBuildModelTotalMs(r: number, runs: number): number {
  const scaled = EMULATED_ANCHOR_TOTAL_MS * (r / EMULATED_ANCHOR_RESIDUES) ** EMULATED_EXPONENT;
  return scaled * (EMULATED_FIXED_SHARE + (1 - EMULATED_FIXED_SHARE) * (runs / EMULATED_ANCHOR_RUNS));
}

/**
 * RepairPDB, ONE measured curve. Two points, both NATIVE:
 *   • SOD1, 154 residues, 49 s — `npm run compute:benchmark` (2026-10-11, x64-native-20c-16g).
 *   • An experimental structure, 305 residues, 205.4 s — the table in `foldx/cache.ts`. That table is
 *     natively measured: its BuildModel column (2.2 s at 305) matches the native BuildModel prior
 *     (`nativeBuildModelTotalMs(305, 5)` ≈ 2.8 s), not the emulated one (≈ 31 s).
 * A line through them gives ln(205.4/49) / ln(305/154) ≈ 2.1, which reproduces both points (205.8 s at
 * 305). The old prior divided a 205 s anchor by the ~60x BuildModel factor and predicted 0.6 s at 154 —
 * ~76x too fast. [estimate] for the emulated host only.
 */
const NATIVE_REPAIR_ANCHOR_RESIDUES = 154;
const NATIVE_REPAIR_ANCHOR_MS = 49_000;
const REPAIR_EXPONENT = 2.1;

function nativeRepairMs(r: number): number {
  return NATIVE_REPAIR_ANCHOR_MS * (r / NATIVE_REPAIR_ANCHOR_RESIDUES) ** REPAIR_EXPONENT;
}

/**
 * The emulated server has never been benchmarked for RepairPDB, so rather than invent a factor its prior
 * reuses the measured native curve scaled by the emulation penalty this file already applies to
 * BuildModel at the SAME size (never below 1). Emulated repair is therefore never predicted faster than
 * native — the inversion the review found — and `npm run compute:benchmark` on the server replaces it.
 */
function emulatedRepairMs(r: number): number {
  const penalty = emulatedBuildModelTotalMs(r, 1) / nativeBuildModelTotalMs(r, 1);
  return nativeRepairMs(r) * Math.max(1, penalty);
}

/** Prior p50 for a FoldX job (RepairPDB when it applies, then BuildModel). */
export function foldxPriorP50Ms(job: Pick<JobFeatures, "residues" | "numberOfRuns" | "repair">, emulated: boolean): number {
  const r = Math.max(1, job.residues);
  const runs = Math.max(1, job.numberOfRuns);
  const buildModel = emulated ? emulatedBuildModelTotalMs(r, runs) : nativeBuildModelTotalMs(r, runs);
  const repair = job.repair ? (emulated ? emulatedRepairMs(r) : nativeRepairMs(r)) : 0;
  return Math.round(buildModel + repair);
}

/** The prediction for one job on one host: the fitted curve when there are enough samples, else the prior. */
export function predictJob(job: JobFeatures, host: HostFeatures, models: CostModels, minSamples: number): Prediction {
  const model = models[costModelKey(job.type, hostClassOf(host))];
  const samples = model?.samples ?? 0;
  // The memory curve needs MEASURED peaks, not merely completed rows: a cache hit completes with no
  // peak and must not help a two-point fit look trustworthy.
  const peakRamBytes = model?.peakRam && model.peakRamSamples >= minSamples ? evalPowerLaw(model.peakRam, job.residues) : null;
  if (model?.wall && samples >= minSamples) {
    return { wallMs: evalPowerLaw(model.wall, job.residues), peakRamBytes, basis: "measured", samples };
  }
  if (job.type === "foldx") {
    const p50 = foldxPriorP50Ms(job, host.emulated);
    return { wallMs: { p50, p90: p50 * PRIOR_P90_FACTOR }, peakRamBytes, basis: "prior", samples };
  }
  return { wallMs: null, peakRamBytes, basis: "prior", samples };
}

// ── Hard filters ──────────────────────────────────────────────────────────────────────────────────

type FilterMiss =
  | { kind: "offline" }
  | { kind: "pref" }
  | { kind: "owner" }
  | { kind: "tool"; tool: ToolName; state: "missing" | "unverified" | "old"; minVersion?: string }
  | { kind: "ceiling"; limit: number; learnedFrom: "oom" | "largest_completed"; measured: boolean }
  | { kind: "ram"; neededBytes: number; availableBytes: number };

function describeMiss(miss: FilterMiss, job: JobFeatures): string {
  switch (miss.kind) {
    case "offline":
      return "it is offline";
    case "pref":
      return "your placement preference keeps jobs on the shared server";
    case "owner":
      return "it belongs to another user, and a computer only runs its owner's jobs";
    case "tool": {
      const name = TOOL_LABEL[miss.tool];
      if (miss.state === "missing") return `${name} is not set up on it`;
      if (miss.state === "unverified") return `${name} is installed but has not passed its self-test`;
      return `its ${name} is older than the required version ${miss.minVersion}`;
    }
    case "ceiling":
      if (miss.learnedFrom === "oom") return `a structure of ${miss.limit} residues ran out of memory there, and this one has ${job.residues}`;
      if (miss.measured) return `${job.residues} residues is well beyond the largest structure that has completed there (${Math.floor(miss.limit)} residues)`;
      return `memory use is not measured yet, and ${job.residues} residues is beyond the safe size of ${Math.floor(miss.limit)} learned from completed jobs`;
    case "ram":
      return `it needs about ${formatGb(miss.neededBytes)} free and has ${formatGb(miss.availableBytes)}`;
  }
}

function firstMiss(job: JobFeatures, host: HostFeatures, policy: RoutingPolicy, models: CostModels, prediction: Prediction): FilterMiss | null {
  if (!host.online) return { kind: "offline" };
  if (host.kind === "agent" && policy.placementPref === "server_only") return { kind: "pref" };
  if (host.kind === "agent" && host.ownerId !== job.ownerId) return { kind: "owner" };

  for (const need of job.requires) {
    const tool = host.tools.find((t) => t.name === need.tool);
    if (!tool) return { kind: "tool", tool: need.tool, state: "missing" };
    if (!tool.verified) return { kind: "tool", tool: need.tool, state: "unverified" };
    if (need.minVersion && compareVersions(tool.version, need.minVersion) < 0) {
      return { kind: "tool", tool: need.tool, state: "old", minVersion: need.minVersion };
    }
  }

  const model = models[costModelKey(job.type, hostClassOf(host))];
  if (model?.oomCeilingResidues != null && job.residues >= model.oomCeilingResidues) {
    return { kind: "ceiling", limit: model.oomCeilingResidues, learnedFrom: "oom", measured: true };
  }

  const availableBytes = Math.max(0, host.freeRamBytes - host.minFreeBytes);
  if (prediction.peakRamBytes) {
    const neededBytes = prediction.peakRamBytes.p90 * policy.ramHeadroom;
    if (neededBytes > availableBytes) return { kind: "ram", neededBytes, availableBytes };
  }
  // The size guard is an AND with the memory rule, not an alternative to it: the memory fit can rest on
  // as few as two distinct sizes, so it never licenses a structure far past the largest one that
  // actually completed. A class with nothing completed yet is not refused — that would refuse every
  // first job.
  if (model?.maxCompletedResidues != null && job.residues > model.maxCompletedResidues * UNMEASURED_SIZE_GROWTH) {
    return {
      kind: "ceiling",
      limit: model.maxCompletedResidues * UNMEASURED_SIZE_GROWTH,
      learnedFrom: "largest_completed",
      measured: prediction.peakRamBytes != null,
    };
  }
  return null;
}

/** The single most useful sentence when every host was refused. Order = most actionable first. */
function closestMiss(job: JobFeatures, misses: { host: HostFeatures; miss: FilterMiss }[]): string {
  const ram = misses.filter((m) => m.miss.kind === "ram") as { host: HostFeatures; miss: Extract<FilterMiss, { kind: "ram" }> }[];
  if (ram.length > 0) {
    const best = [...ram].sort((x, y) => y.miss.availableBytes - x.miss.availableBytes || x.host.id.localeCompare(y.host.id))[0];
    return `This job needs about ${formatGb(best.miss.neededBytes)} of free memory; the most any host has free is ${formatGb(best.miss.availableBytes)} (${best.host.label}).`;
  }
  const ceiling = misses.find((m) => m.miss.kind === "ceiling");
  if (ceiling) return `This structure (${job.residues} residues) is too large to run safely: ${describeMiss(ceiling.miss, job)} on ${ceiling.host.label}.`;
  const tool = misses.find((m) => m.miss.kind === "tool");
  if (tool) return `No connected computer can run it: ${describeMiss(tool.miss, job)} (${tool.host.label}).`;
  if (misses.length > 0 && misses.every((m) => m.miss.kind === "offline")) return "No computer that could run this job is online.";
  const first = misses[0];
  return first ? `No host can run this job: ${first.host.label} — ${describeMiss(first.miss, job)}.` : "No host is available to run this job.";
}

// ── The decision ──────────────────────────────────────────────────────────────────────────────────

/**
 * Expected time until the job finishes on this host: what is already ahead of it, its own p50, the
 * round trips an agent adds, and a penalty for agents that lose leases (their job would rerun).
 */
function expectedCompletion(host: HostFeatures, prediction: Prediction): number | null {
  if (!prediction.wallMs) return null;
  const p50 = prediction.wallMs.p50;
  const transfer = host.kind === "agent" ? (host.linkRttMs ?? AGENT_DEFAULT_RTT_MS) * AGENT_TRANSFER_ROUND_TRIPS : 0;
  const penalty = Math.min(1, Math.max(0, host.leaseLossRate)) * p50;
  return host.queuedCostMs + host.runningCostMs + p50 + transfer + penalty;
}

/** Best first. With a wall prediction everywhere, by expected completion; otherwise by load. Ties by id. */
function rank(evals: { host: HostFeatures; ev: HostEvaluation }[]): { host: HostFeatures; ev: HostEvaluation }[] {
  const allTimed = evals.every((e) => e.ev.expectedCompletionMs != null);
  return [...evals].sort((x, y) => {
    if (allTimed) {
      const d = (x.ev.expectedCompletionMs as number) - (y.ev.expectedCompletionMs as number);
      if (d !== 0) return d;
    } else {
      const d = x.host.runningJobs - y.host.runningJobs || x.host.queuedCostMs + x.host.runningCostMs - (y.host.queuedCostMs + y.host.runningCostMs);
      if (d !== 0) return d;
    }
    return x.host.id.localeCompare(y.host.id);
  });
}

function placementFor(host: HostFeatures): Placement {
  return host.kind === "server" ? { kind: "server" } : { kind: "agent", agentId: host.id.replace(/^agent:/, "") };
}

function describePrediction(p: Prediction): string | null {
  if (!p.wallMs) return null;
  const basis = p.basis === "measured" ? `fitted from ${p.samples} completed jobs on this kind of computer` : "an estimate from earlier benchmarks, not yet measured on this computer";
  return `Expected run time about ${formatDuration(p.wallMs.p50)} (up to ${formatDuration(p.wallMs.p90)}), ${basis}.`;
}

/**
 * Decide where one job runs.
 *
 *   1. Hard filters, each recording why a host was removed.
 *   2. Predict per remaining host (fit when the class has `minSamples`, else prior).
 *   3. Rank by expected completion. A near tie (within `nearTieFraction` of the best) goes to the
 *      owner's own computer under `my_machine`, otherwise to the shared server.
 *   4. Emit the Decision. If nothing is feasible, reject with the closest miss.
 */
export function decidePlacement(job: JobFeatures, hosts: HostFeatures[], policy: RoutingPolicy, models: CostModels): Decision {
  const rejected: { hostId: string; because: string }[] = [];
  const misses: { host: HostFeatures; miss: FilterMiss }[] = [];
  const feasible: { host: HostFeatures; ev: HostEvaluation }[] = [];

  for (const host of [...hosts].sort((a, b) => a.id.localeCompare(b.id))) {
    const prediction = predictJob(job, host, models, policy.minSamples);
    const miss = firstMiss(job, host, policy, models, prediction);
    if (miss) {
      misses.push({ host, miss });
      rejected.push({ hostId: host.id, because: describeMiss(miss, job) });
      continue;
    }
    feasible.push({ host, ev: { hostId: host.id, prediction, expectedCompletionMs: expectedCompletion(host, prediction) } });
  }

  if (feasible.length === 0) {
    return { placement: { kind: "reject" }, prediction: null, reasons: [closestMiss(job, misses)], rejected, ranked: [] };
  }

  const ranked = rank(feasible);
  let chosen = ranked[0];
  const reasons: string[] = [];
  const best = chosen.ev.expectedCompletionMs;

  // A near tie needs a time on every side. With any host unpredicted, `rank` ordered by load, and a
  // null completion would read as 0 here and make an untimed host "tied" with everything.
  const allTimed = ranked.every((e) => e.ev.expectedCompletionMs != null);
  if (best != null && allTimed && ranked.length > 1) {
    const margin = best * policy.nearTieFraction;
    const tied = ranked.filter((e) => (e.ev.expectedCompletionMs as number) - best <= margin);
    if (tied.length > 1) {
      const preferKind = policy.placementPref === "my_machine" ? "agent" : "server";
      const preferred = tied.find((e) => e.host.kind === preferKind);
      if (preferred && preferred !== chosen) {
        chosen = preferred;
        reasons.push(
          preferKind === "agent"
            ? `Your computer and the shared server would finish at about the same time, so it runs on ${chosen.host.label} as you prefer.`
            : `The hosts would finish at about the same time, so it stays on ${chosen.host.label}.`,
        );
      }
    }
  }

  if (reasons.length === 0) {
    if (ranked.length === 1) reasons.push(`It runs on ${chosen.host.label}, the only computer that can take it now.`);
    else if (best == null) reasons.push(`It runs on ${chosen.host.label}, which has the fewest jobs running; there is no run-time estimate for this tool yet.`);
    else reasons.push(`It runs on ${chosen.host.label}, which is expected to finish first.`);
  }
  if (chosen.host.kind === "server" && chosen.host.emulated && job.type === "foldx" && hosts.some((h) => h.kind === "agent")) {
    reasons.push("FoldX on the shared server runs under emulation, which is much slower than on a regular Windows or Linux PC.");
  }
  const predictionSentence = describePrediction(chosen.ev.prediction);
  if (predictionSentence) reasons.push(predictionSentence);

  return { placement: placementFor(chosen.host), prediction: chosen.ev.prediction, reasons, rejected, ranked: ranked.map((e) => e.ev) };
}
