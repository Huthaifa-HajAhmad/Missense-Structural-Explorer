/**
 * engineStatus.ts — THE single source of truth for how a biophysical engine's outcome is
 * named, described, coloured and counted on every Energetics surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS (read before adding an engine or a status label)
 * ─────────────────────────────────────────────────────────────────────────────
 * Before this module, the six ΔΔG engines were rendered across five surfaces under fourteen
 * different names, and their outcomes were spelled with ~40 ad-hoc strings ("Standby",
 * "Upstream Congested", "Not in Zenodo DB", "Offline", "Idle", "Coverage Limited", …) spread
 * as an if/else ladder through EnergeticsView and EnergeticsInspector. That produced three
 * classes of defect, all of which this module is designed to make impossible:
 *
 *   1. Contradiction — one engine was described as "offline" beside a successful value.
 *   2. Silent degradation — a 1-of-6 estimate was styled identically to a 6-of-6 estimate.
 *   3. Sign drift — the same ΔΔG was printed as +0.09 in one panel and −0.09 in another.
 *
 * The rules that follow from that:
 *
 *   • NO surface may invent a status string. Call `resolveEngineState()` and render what it
 *     returns. `src/components/__tests__/energeticsLabels.guard.test.ts` fails the build if a legacy
 *     literal reappears in a guarded surface; `src/shared/__tests__/consensusVerdict.guard.test.ts`
 *     does the same for verdict literals. (This comment previously named an
 *     `engineStatus.guard.test.ts` that has never existed — a trap for anyone who went looking.)
 *   • NO surface may format a ΔΔG itself. Call `formatDdg()` / `toCanonicalDdg()`. Positive
 *     canonical ΔΔG ALWAYS means destabilizing, whatever the provider's native convention is.
 *   • NO surface may count engines itself. Call `summarizeCoverage()`.
 *
 * The module is pure: it imports only from `src/shared` so both the server and the client can
 * use it (enforced by `scripts/check-boundaries.ts`).
 */

import { THRESHOLDS } from "./thresholds/constants.ts";

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

export type EnergyEngineId =
  | "foldx"
  | "dynamut2"
  | "ddmut"
  | "rasp"
  | "thermompnn"
  | "stabilityoracle";

/**
 * The provider's native sign convention for its raw ΔΔG output.
 *
 * This is the crux of the sign bug this module fixes: FoldX/RaSP/ThermoMPNN/StabilityOracle
 * report *positive = destabilizing*, while DynaMut2 and DDMut report *negative =
 * destabilizing*. Both conventions appeared on the same screen simultaneously. Every consumer
 * now normalises through `toCanonicalDdg()` and never sees a raw sign.
 */
export type NativeSign = "positive-destabilizing" | "negative-destabilizing";

/**
 * How an engine's absence should be diagnosed when no more specific cause is known.
 *
 * `install`  — the engine is not provisioned in this deployment (fixable by an operator)
 * `coverage` — the engine ran but holds no data for this protein (not fixable, by design)
 * `upstream` — a third party did not answer (retryable)
 *
 * These three are the distinctions a clinical user actually needs, and the ones the previous
 * UI collapsed into the single word "Standby".
 */
export type AbsenceClass = "install" | "coverage" | "upstream";

export interface EngineDescriptor {
  id: EnergyEngineId;
  /** The ONE display name. Never render an engine under a second name. */
  name: string;
  /** The Type/taxonomy cell. */
  taxonomy: string;
  /** Native sign convention of the raw provider value. */
  nativeSign: NativeSign;
  /** Canonical (positive = destabilizing) cut-point, in kcal/mol. */
  strongCut: number;
  /** Canonical band where destabilization is supporting-but-not-strong, in kcal/mol. */
  supportingCut: number;
  /** Canonical value at or below which the variant is treated as stabilizing. */
  stabilizingCut: number;
  absenceClass: AbsenceClass;
  /** One-line description of what the engine measures. */
  summary: string;
}

/**
 * Canonical cut-points.
 *
 * `strongCut` comes from the tuned per-engine thresholds in `thresholds/constants.ts`, which is
 * what fixes the defect where FoldX's 1.5/0.5 cut-points were applied to all six engines (a
 * RaSP ΔΔG of +1.2 was rendered "Moderately Destabilizing" while the consensus counted it as
 * destabilizing).
 *
 * `supportingCut` (±0.5) and `stabilizingCut` are UI band conventions, not published
 * per-engine cut-points: only FoldX publishes supporting/stabilizing bands. They are kept
 * identical to the values the UI already used so that this change alters classification only
 * where the science supports it.
 */
const SUPPORTING_CUT = 0.5;
const STABILIZING_CUT = -0.5;

const magnitude = (v: number) => Math.abs(v);

/**
 * The six engines, in the order they are presented. Adding an engine here is the ONLY place a
 * new engine must be registered for it to appear consistently everywhere.
 */
export const ENERGY_ENGINES: readonly EngineDescriptor[] = [
  {
    id: "foldx",
    name: "FoldX",
    taxonomy: "Force Field Repacking (ensemble)",
    nativeSign: "positive-destabilizing",
    strongCut: THRESHOLDS.foldxDdG.destabilizingStrong,
    supportingCut: THRESHOLDS.foldxDdG.destabilizingSupporting,
    stabilizingCut: THRESHOLDS.foldxDdG.stabilizing,
    absenceClass: "install",
    summary: "Empirical atomic force field with sidechain repacking on a rigid backbone.",
  },
  {
    id: "dynamut2",
    name: "DynaMut2",
    taxonomy: "Normal Mode Analysis / ML",
    nativeSign: "negative-destabilizing",
    strongCut: magnitude(THRESHOLDS.dynamut2.destabilizing),
    supportingCut: SUPPORTING_CUT,
    stabilizingCut: STABILIZING_CUT,
    absenceClass: "upstream",
    summary: "Normal-mode dynamics (elastic network) combined with a trained stability model.",
  },
  {
    id: "ddmut",
    name: "DDMut",
    taxonomy: "Graph Deep Learning / Transformers",
    nativeSign: "negative-destabilizing",
    strongCut: magnitude(THRESHOLDS.ddmut.destabilizing),
    supportingCut: SUPPORTING_CUT,
    stabilizingCut: STABILIZING_CUT,
    absenceClass: "upstream",
    summary: "Siamese graph/transformer network over atomic density.",
  },
  {
    id: "rasp",
    name: "RaSP",
    taxonomy: "Structural Embeddings / MLP Head",
    nativeSign: "positive-destabilizing",
    strongCut: THRESHOLDS.rasp.destabilizing,
    supportingCut: SUPPORTING_CUT,
    stabilizingCut: STABILIZING_CUT,
    absenceClass: "coverage",
    summary: "Precomputed Rosetta/ESM-IF1 stability profile, available for a curated protein set.",
  },
  {
    id: "thermompnn",
    name: "ThermoMPNN",
    taxonomy: "ProteinMPNN Embeddings / Deep Learning",
    nativeSign: "positive-destabilizing",
    strongCut: THRESHOLDS.thermompnn.destabilizing,
    supportingCut: SUPPORTING_CUT,
    stabilizingCut: STABILIZING_CUT,
    absenceClass: "install",
    summary: "ProteinMPNN backbone embeddings trained on large experimental stability sets.",
  },
  {
    id: "stabilityoracle",
    name: "StabilityOracle",
    taxonomy: "Graph-Transformer / Structure ML",
    nativeSign: "positive-destabilizing",
    strongCut: THRESHOLDS.stabilityoracle.destabilizing,
    supportingCut: SUPPORTING_CUT,
    stabilizingCut: STABILIZING_CUT,
    absenceClass: "install",
    summary: "Geometric graph-transformer over wild-type and mutant 3D coordinates.",
  },
] as const;

export const ENERGY_ENGINE_IDS: readonly EnergyEngineId[] = ENERGY_ENGINES.map(e => e.id);

const ENGINE_BY_ID: Record<EnergyEngineId, EngineDescriptor> = ENERGY_ENGINES.reduce(
  (acc, engine) => {
    acc[engine.id] = engine;
    return acc;
  },
  {} as Record<EnergyEngineId, EngineDescriptor>
);

export function getEngine(id: EnergyEngineId): EngineDescriptor {
  return ENGINE_BY_ID[id];
}

// ---------------------------------------------------------------------------
// ΔΔG values: one sign convention, one formatter
// ---------------------------------------------------------------------------

export type EnergyUnit = "kcal/mol" | "kJ/mol";

/** Conversion factor. Exact by definition of the thermochemical calorie. */
export const KJ_PER_KCAL = 4.184;

/**
 * Normalises a raw provider value into the canonical convention
 * (positive = destabilizing). Returns `null` for missing input rather than 0 — coercing
 * absence to zero is what let the UI claim "± 0.00 kcal/mol" for an absent ensemble SD.
 */
export function toCanonicalDdg(id: EnergyEngineId, raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return null;
  return ENGINE_BY_ID[id].nativeSign === "negative-destabilizing" ? -raw : raw;
}

/**
 * THE ΔΔG formatter. Every surface must use this so a value can never be printed with two
 * different signs in two panels.
 *
 * @param canonicalDdg already-normalised value (positive = destabilizing)
 */
export function formatDdg(
  canonicalDdg: number | null | undefined,
  unit: EnergyUnit = "kcal/mol",
  digits = 2
): string {
  if (canonicalDdg === null || canonicalDdg === undefined || !Number.isFinite(canonicalDdg)) {
    return "—";
  }
  return unit === "kJ/mol"
    ? `${(canonicalDdg * KJ_PER_KCAL).toFixed(digits)} kJ/mol`
    : `${canonicalDdg.toFixed(digits)} kcal/mol`;
}

/** Same as `formatDdg` but always carries an explicit sign, for badges and deltas. */
export function formatSignedDdg(
  canonicalDdg: number | null | undefined,
  unit: EnergyUnit = "kcal/mol",
  digits = 2
): string {
  if (canonicalDdg === null || canonicalDdg === undefined || !Number.isFinite(canonicalDdg)) {
    return "—";
  }
  return `${canonicalDdg > 0 ? "+" : ""}${formatDdg(canonicalDdg, unit, digits)}`;
}

/**
 * Formats an ensemble mean with its spread, unit stated once: "1.20 ± 0.30 kcal/mol".
 *
 * A missing spread must not be rendered as "± 0.00" — that reads as perfect reproducibility
 * across the ensemble when the spread was simply not measured.
 */
export function formatDdgPair(
  canonicalMean: number | null | undefined,
  canonicalSpread: number | null | undefined,
  unit: EnergyUnit = "kcal/mol",
  digits = 2
): string {
  if (canonicalMean === null || canonicalMean === undefined || !Number.isFinite(canonicalMean)) {
    return "—";
  }
  const factor = unit === "kJ/mol" ? KJ_PER_KCAL : 1;
  const unitLabel = unit === "kJ/mol" ? "kJ/mol" : "kcal/mol";
  const meanText = (canonicalMean * factor).toFixed(digits);
  if (canonicalSpread === null || canonicalSpread === undefined || !Number.isFinite(canonicalSpread)) {
    return `${meanText} ${unitLabel}`;
  }
  return `${meanText} ± ${(canonicalSpread * factor).toFixed(digits)} ${unitLabel}`;
}

/** Converts a canonical value from one display unit to another (used by the kcal/kJ toggle). */
export function convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit): number {
  if (from === to) return value;
  return to === "kJ/mol" ? value * KJ_PER_KCAL : value / KJ_PER_KCAL;
}

// ---------------------------------------------------------------------------
// Risk bands — each engine judged on its own scale
// ---------------------------------------------------------------------------

export type RiskBandId = "high" | "moderate" | "neutral" | "stabilizing";

export interface RiskBand {
  id: RiskBandId;
  label: string;
  /** Severity, independent of theme. Surfaces map this to their own tokens. */
  severity: "danger" | "warn" | "neutral" | "good";
}

const RISK_BANDS: Record<RiskBandId, RiskBand> = {
  high: { id: "high", label: "Destabilizing", severity: "danger" },
  moderate: { id: "moderate", label: "Moderately destabilizing", severity: "warn" },
  neutral: { id: "neutral", label: "Neutral", severity: "neutral" },
  stabilizing: { id: "stabilizing", label: "Stabilizing", severity: "good" },
};

export function getRiskBand(id: RiskBandId): RiskBand {
  return RISK_BANDS[id];
}

export const RISK_BAND_IDS: readonly RiskBandId[] = ["high", "moderate", "neutral", "stabilizing"];

/**
 * Classifies an ALREADY-CANONICAL value using the engine's own cut-points.
 *
 * Private on purpose: taking a canonical value here means a caller holding a raw provider value
 * could silently invert the verdict. Use `classifyRawDdg()` instead — it is impossible to call
 * with the wrong convention.
 */
function classifyCanonicalDdg(id: EnergyEngineId, canonicalDdg: number): RiskBand {
  const engine = ENGINE_BY_ID[id];
  if (canonicalDdg >= engine.strongCut) return RISK_BANDS.high;
  if (canonicalDdg >= engine.supportingCut) return RISK_BANDS.moderate;
  if (canonicalDdg <= engine.stabilizingCut) return RISK_BANDS.stabilizing;
  return RISK_BANDS.neutral;
}

/**
 * The primary classification API: give it the value exactly as the provider reported it and it
 * normalises the sign itself. This is the only way to obtain a risk band, so a caller cannot
 * pair one engine's raw value with another engine's cut-points by accident.
 */
export function classifyRawDdg(
  id: EnergyEngineId,
  rawValue: number | null | undefined
): RiskBand | null {
  const canonical = toCanonicalDdg(id, rawValue);
  return canonical === null ? null : classifyCanonicalDdg(id, canonical);
}

// ---------------------------------------------------------------------------
// Engine outcomes: 9 canonical states replacing ~40 ad-hoc strings
// ---------------------------------------------------------------------------

/**
 * The complete set of outcomes an engine row may be in.
 *
 * `computed`       a value is present
 * `running`        work is in flight and has a route to completion
 * `not-installed`  the engine is not provisioned in this deployment (operator-fixable)
 * `not-covered`    the engine holds no data for this protein (not fixable, by design)
 * `upstream-busy`  a third-party queue did not answer in time (retryable)
 * `upstream-error` a third party returned an error (retryable)
 * `failed`         our pipeline failed for this engine
 * `no-result`      the run ended without producing a value and no cause is known.
 *                  This is the honest answer where the UI previously said "Standby" (which
 *                  implies waiting) or left an engine spinning on "In Progress" forever.
 * `skipped`        the user chose to hide a pending engine (never changes coverage)
 */
export type EngineState =
  | "computed"
  | "running"
  | "not-installed"
  | "not-covered"
  | "upstream-busy"
  | "upstream-error"
  | "failed"
  | "no-result"
  | "skipped";

export const ENGINE_STATE_IDS: readonly EngineState[] = [
  "computed",
  "running",
  "not-installed",
  "not-covered",
  "upstream-busy",
  "upstream-error",
  "failed",
  "no-result",
  "skipped",
];

/**
 * One canonical label per state. The `engineStatus` guard test asserts this map is total, so a
 * new state cannot be added without a user-facing name.
 */
export const ENGINE_STATE_LABELS: Record<EngineState, string> = {
  computed: "Computed",
  running: "Running",
  "not-installed": "Not available here",
  "not-covered": "Not covered",
  "upstream-busy": "Provider busy",
  "upstream-error": "Provider error",
  failed: "Failed",
  "no-result": "No result",
  skipped: "Hidden",
};

/** Tone → the surface picks its own theme tokens; this only conveys severity/intent. */
export type EngineTone = "good" | "neutral" | "muted" | "warn" | "danger";

const STATE_TONES: Record<EngineState, EngineTone> = {
  computed: "good",
  running: "neutral",
  "not-installed": "muted",
  "not-covered": "muted",
  "upstream-busy": "warn",
  "upstream-error": "warn",
  failed: "danger",
  "no-result": "warn",
  skipped: "muted",
};

/**
 * A classification of *why* an engine has no value, supplied by the caller which alone knows
 * the engine-specific flags (FoldX's binary/repair flags, the server's `raspReason`, …).
 */
export type EngineProblem =
  | "binary-missing"
  | "repair-failed"
  | "pipeline-failed"
  | "coverage-miss"
  | "upstream-busy"
  | "upstream-error"
  | "not-configured";

/**
 * Everything the resolver needs to know about one engine. Callers pass facts they already
 * hold; they must not pre-classify into a label.
 */
export interface EngineObservation {
  id: EnergyEngineId;
  /** Raw provider value (native sign); `null` when absent. */
  value: number | null;
  /** Server lifecycle status, for the remote engines. */
  status?: "pending" | "done" | "unavailable" | "error" | null;
  /** Engine-specific cause, when known. Takes precedence over `status`. */
  problem?: EngineProblem | null;
  /** Free-text detail from the server, shown as supporting detail (never as the label). */
  detail?: string | null;
  /** True while the owning run is still in flight. */
  runActive?: boolean;
  /** True when the user has hidden still-running engines. Affects presentation, never coverage. */
  hidden?: boolean;
  /**
   * True when the value is shown for reference but must NOT be counted in the consensus —
   * e.g. FoldX after a failed RepairPDB, where the number is retained for transparency but the
   * calibrated consensus already excludes it. Modelling this explicitly removes a latent
   * inconsistency where the table implied an engine contributed while the maths ignored it.
   */
  excludeFromConsensus?: boolean;
}

export interface EngineOutcome {
  id: EnergyEngineId;
  engine: EngineDescriptor;
  state: EngineState;
  /** Canonical label — the only string a surface may render as the state. */
  label: string;
  tone: EngineTone;
  /** Plain-language, actionable sentence. Empty for `computed`. */
  reason: string;
  /** Server detail, retained for a disclosure; never used as the primary label. */
  detail: string | null;
  /** Canonical value (positive = destabilizing), or `null`. */
  canonicalDdg: number | null;
  /** Risk band from the engine's own cut-points, or `null`. */
  risk: RiskBand | null;
  /** Whether this engine contributed a value to the consensus. */
  contributesToConsensus: boolean;
  /**
   * True when a value is shown but deliberately not counted.
   *
   * Exposed explicitly rather than left for each renderer to infer from
   * `state === "computed" && !contributesToConsensus`. The inference is easy to miss — the
   * inspector missed it, and rendered an excluded FoldX value as "Computed" with a green dot while
   * the view beside it said "Not counted", i.e. the two surfaces certified and discarded the same
   * number at once. A contract that makes the fact available cannot stop a renderer ignoring it, but
   * a renderer that has to opt IN to ignoring it is a different proposition from one that never knew.
   */
  excluded: boolean;
  /** Whether the user has hidden this row's pending state. */
  hidden: boolean;
}

const PROBLEM_TO_STATE: Record<EngineProblem, EngineState> = {
  "binary-missing": "not-installed",
  "repair-failed": "failed",
  "pipeline-failed": "failed",
  "coverage-miss": "not-covered",
  "upstream-busy": "upstream-busy",
  "upstream-error": "upstream-error",
  "not-configured": "not-installed",
};

/**
 * Plain-language reasons. These deliberately answer "can I do anything about it?" rather than
 * naming the provider's infrastructure (the previous copy leaked "Zenodo", "BioSig",
 * "rotabase.txt" and container paths to clinical users).
 */
function reasonFor(state: EngineState, engine: EngineDescriptor, detail: string | null): string {
  switch (state) {
    case "computed":
      return "";
    case "running":
      return "Calculation in progress.";
    case "not-installed":
      return engine.id === "stabilityoracle" || engine.id === "thermompnn"
        ? "Not available in this deployment — the local model service is not running."
        : "Not available in this deployment.";
    case "not-covered":
      // Deliberately does not assert a fact about the protein. The server reports the same state for
      // a protein outside the covered set AND for a position within a covered protein, and the
      // precise sentence travels in `detail`.
      return engine.id === "rasp"
        ? `No precomputed ${engine.name} score is available for this variant.`
        : "No precomputed data for this variant.";
    case "upstream-busy":
      return `${engine.name}'s provider did not answer in time. This can be retried later.`;
    case "upstream-error":
      return `${engine.name}'s provider returned an error. This can be retried later.`;
    case "failed":
      return detail && /repair/i.test(detail)
        ? "Structure preparation failed, so no reliable estimate was produced."
        : "The calculation failed for this variant.";
    case "no-result":
      return "The run ended without returning a value for this engine.";
    case "skipped":
      return "Hidden while still running. This does not affect the engine count.";
    default:
      return "";
  }
}

/**
 * Resolves one engine's observation into a canonical outcome.
 *
 * Precedence is deliberate and encodes the product's honesty rules:
 *
 *   1. A value that exists always beats a failure flag — an engine that partly succeeded is
 *      reported as computed.
 *   2. A cause the caller actually knows (`problem`) beats anything inferred from `status`.
 *   3. `pending` is only "running" while the run is genuinely in flight. A pending engine whose
 *      run has ended has no route to completion, and saying so is the fix for the defect where a
 *      stalled engine displayed "In Progress" indefinitely.
 *   4. When nothing at all is known, the answer is `no-result` — not a guess about whose fault
 *      it is. Only engines whose absence is a *property of the dataset* (RaSP) are allowed to
 *      assert "not covered" without further evidence.
 *   5. The user's "hide" choice never overrides a fact; it only renames a running row.
 */
export function resolveEngineOutcome(obs: EngineObservation): EngineOutcome {
  const engine = ENGINE_BY_ID[obs.id];
  const canonicalDdg = toCanonicalDdg(obs.id, obs.value);
  const detail = obs.detail ?? null;

  let state: EngineState;
  if (canonicalDdg !== null) {
    state = "computed";
  } else if (obs.problem) {
    state = PROBLEM_TO_STATE[obs.problem];
  } else if (obs.status === "error") {
    state = "upstream-error";
  } else if (obs.status === "unavailable") {
    state =
      engine.absenceClass === "upstream"
        ? "upstream-busy"
        : engine.absenceClass === "coverage"
          ? "not-covered"
          : "not-installed";
  } else if (obs.status === "pending") {
    state = obs.runActive ? "running" : "no-result";
  } else if (obs.status === "done") {
    // Reported complete but produced nothing: that is a result, not a pending state.
    state = "no-result";
  } else if (obs.runActive) {
    state = "running";
  } else if (engine.absenceClass === "coverage") {
    state = "not-covered";
  } else {
    state = "no-result";
  }

  // Hiding is presentational only, and only ever renames a running engine.
  const hidden = Boolean(obs.hidden) && state === "running";
  if (hidden) state = "skipped";

  /**
   * A value can be shown without being counted.
   *
   * The exclusion is derived HERE as well as from `excludeFromConsensus`, because the two causes of
   * exclusion are properties of the observation itself: FoldX after a failed repair, or with no
   * binary to run. Deriving it in the builder alone left the two entry points disagreeing — a caller
   * using the resolver directly (as the Splicing tab does through `buildEngineOutcomes`' own inputs)
   * got `risk: "high"` for a value the consensus had discarded.
   */
  const excluded =
    canonicalDdg !== null &&
    (Boolean(obs.excludeFromConsensus) ||
      obs.problem === "repair-failed" ||
      obs.problem === "binary-missing");
  /**
   * FoldX's two structural failures get their own copy, and it is COMPOSED with the exclusion note
   * rather than replaced by it.
   *
   * The previous version had two defects, both confirmed by review:
   *   • the reason was overwritten by the generic exclusion sentence whenever a value existed, so the
   *     repair cause rendered only in the case it was NOT written for — and never explained why a
   *     visible number was untrusted;
   *   • in that one reachable case it asserted "this estimate was produced from an unminimised
   *     model" while `canonicalDdg` was null, i.e. it claimed an estimate that does not exist.
   *
   * The cause now depends on whether a value is actually present, and the caller appends the
   * exclusion note instead of discarding the cause.
   */
  const foldxCause =
    obs.id !== "foldx"
      ? null
      : obs.problem === "binary-missing"
        ? "The FoldX binary is not installed, so no force-field estimate could be computed. Install it and re-run to include FoldX in the consensus."
        : obs.problem === "repair-failed"
          ? canonicalDdg !== null
            ? "Structure repair failed, so this estimate came from an unminimised model."
            : "Structure repair failed and no estimate could be produced."
          : null;

  const exclusionNote = "Shown for reference only — excluded from the consensus.";
  const baseReason = foldxCause ?? reasonFor(state, engine, detail);

  return {
    id: obs.id,
    engine,
    state,
    label: ENGINE_STATE_LABELS[state],
    tone: STATE_TONES[state],
    reason: state === "computed" && excluded
      ? foldxCause
        ? `${foldxCause} ${exclusionNote}`
        : exclusionNote
      : baseReason,
    detail,
    canonicalDdg,
    /**
     * `null` for an excluded value.
     *
     * `risk` is a classification of a *measurement*, and callers act on it: the Splicing tab turns a
     * high band into "Structural Destabilization". An excluded FoldX value is one this app has
     * decided not to trust (repair failed, or no binary), and one panel even suppresses the number
     * itself — so deriving a risk band from it produced a screen that showed "FoldX ΔΔG: —" while
     * asserting structural destabilization from that same hidden value.
     */
    risk: canonicalDdg === null || excluded ? null : classifyCanonicalDdg(obs.id, canonicalDdg),
    contributesToConsensus: canonicalDdg !== null && !excluded,
    excluded,
    hidden,
  };
}

// ---------------------------------------------------------------------------
// Building outcomes from pipeline facts
// ---------------------------------------------------------------------------

/** Lifecycle status reported by the server for a remote engine. */
export type RemoteStatus = "pending" | "done" | "unavailable" | "error" | null | undefined;

/**
 * Everything the two Energetics surfaces know about a run.
 *
 * Both the main column and the inspector build their rows from this one shape via
 * `buildEngineOutcomes`, so they cannot drift into describing the same run differently — the
 * failure mode that previously let one panel say "offline" while the other showed a value.
 */
export interface EngineFacts {
  foldxMean?: number | null;
  /** Single-value FoldX fallback used when no ensemble mean is present. */
  foldxDdg?: number | null;
  foldxSd?: number | null;
  dynamut2?: number | null;
  ddmut?: number | null;
  rasp?: number | null;
  thermompnn?: number | null;
  stabilityoracle?: number | null;
  dynamut2Status?: RemoteStatus;
  ddmutStatus?: RemoteStatus;
  thermompnnStatus?: RemoteStatus;
  raspReason?: string | null;
  thermompnnError?: string | null;
  foldingError?: string | null;
  foldingStatus?: "success" | "failed" | "unavailable" | null;
  foldxRepairFailed?: boolean;
  foldxBinaryMissing?: boolean;
  isFolding?: boolean;
  /** Presentation-only: collapse still-running rows. Never changes coverage. */
  hidePending?: boolean;
}

/**
 * Maps a provider lifecycle status onto a cause, **respecting what absence means per engine**.
 *
 * This must not treat every `unavailable` as an upstream problem: the server reports
 * `unavailable` both for a remote queue that did not answer (DynaMut2/DDMut) and for an engine
 * this deployment simply cannot run (ThermoMPNN/StabilityOracle have no sidecar). Collapsing
 * those into one cause told the user to "retry later" for a service that will never be there.
 */
function absenceProblemFor(engine: EngineDescriptor, status: RemoteStatus): EngineProblem | null {
  if (status === "error") return "upstream-error";
  if (status !== "unavailable") return null;
  switch (engine.absenceClass) {
    case "upstream":
      return "upstream-busy";
    case "coverage":
      return "coverage-miss";
    case "install":
    default:
      return "not-configured";
  }
}

/**
 * Classifies a RaSP miss reason into a cause.
 *
 * The server's `raspReason` values describe two very different situations, and treating every one of
 * them as a coverage property told the user a biological fact ("no profile exists for this protein")
 * when the real cause was a store that is missing, unreadable, truncated or corrupt — all of which an
 * operator can fix. Only a genuine miss may be reported as coverage.
 */
export function classifyRaspMissReason(reason: string | null | undefined): EngineProblem {
  if (!reason) return "coverage-miss";
  /**
   * Order matters, and the default matters more.
   *
   * The lookup returns exactly one coverage sentence — "Residue position is not present in the
   * pre-computed database" — for both a protein outside the covered set and a position within a
   * covered protein. Everything else the server can say is about the *store* (`Pre-computed RaSP
   * database unavailable`, `the index file is not present`, `the index could not be read`, a
   * completeness mismatch, a query error).
   *
   * Note that a naive `/not present/` test is wrong here: it matches "position is not present",
   * which is the coverage case. So coverage is matched explicitly and the fallback is the store
   * fault — when in doubt the UI must not assert a fact about the protein.
   */
  const isCoverageMiss =
    /residue position|not covered|outside the covered set|no precomputed .*profile/i.test(reason);
  return isCoverageMiss ? "coverage-miss" : "not-configured";
}

/**
 * True when a remote engine still has a route to a result.
 *
 * `pending` is only reachable when one does: `settleUnreachableRemoteEngines` converts a pending
 * engine with no job id to `unavailable` at every terminal FoldX commit, and `resolveRestoredStatus`
 * does the same for a restored bundle — so a `pending` that survives has a live poller.
 *
 * Deriving activity from `isFolding` alone was wrong in the other direction: that flag clears when
 * the *FoldX* leg ends, while `useJobPoller` keeps polling the remote engine for up to ten minutes,
 * so a running engine was rendered "No result — the run ended".
 */
function remoteRunActive(status: RemoteStatus, value: number | null | undefined): boolean {
  return (value ?? null) === null && status === "pending";
}

/**
 * Translates pipeline facts into canonical outcomes for all six engines.
 *
 * This is the single place that decides how a status combination becomes a user-facing state,
 * so adding an engine or a failure mode is a one-file change.
 */
export function buildEngineOutcomes(facts: EngineFacts): EngineOutcome[] {
  const isFolding = Boolean(facts.isFolding);
  const noValue = (v: number | null | undefined) => (v ?? null) === null;

  // A cause is only asserted once the run has settled: while folding, the FoldX flags may still
  // describe the previous run, and claiming a failure mid-flight would be wrong.
  const foldxProblem: EngineProblem | null = isFolding
    ? null
    : facts.foldxBinaryMissing
      ? "binary-missing"
      : facts.foldxRepairFailed
        ? "repair-failed"
        : facts.foldingStatus === "failed" || Boolean(facts.foldingError)
          ? "pipeline-failed"
          : facts.foldingStatus === "unavailable"
            ? "not-configured"
            : null;

  const raspReason = typeof facts.raspReason === "string" ? facts.raspReason : null;

  const observations: EngineObservation[] = [
    {
      id: "foldx",
      value: facts.foldxMean ?? facts.foldxDdg ?? null,
      problem: foldxProblem,
      detail: facts.foldingError ?? null,
      runActive: isFolding,
      // Mirrors the consensus, which excludes FoldX after a failed repair or a missing binary.
      excludeFromConsensus: Boolean(facts.foldxRepairFailed || facts.foldxBinaryMissing),
    },
    {
      id: "dynamut2",
      value: facts.dynamut2 ?? null,
      status: facts.dynamut2Status ?? null,
      problem: absenceProblemFor(getEngine("dynamut2"), facts.dynamut2Status),
      runActive: isFolding || remoteRunActive(facts.dynamut2Status, facts.dynamut2),
    },
    {
      id: "ddmut",
      value: facts.ddmut ?? null,
      status: facts.ddmutStatus ?? null,
      problem: absenceProblemFor(getEngine("ddmut"), facts.ddmutStatus),
      runActive: isFolding || remoteRunActive(facts.ddmutStatus, facts.ddmut),
    },
    {
      id: "rasp",
      value: facts.rasp ?? null,
      // "Not covered" is asserted from the server actually reporting a miss, not from the mere
      // absence of a value while a run is in flight.
      problem: !isFolding && noValue(facts.rasp) && raspReason
        ? classifyRaspMissReason(raspReason)
        : null,
      detail: raspReason,
      runActive: isFolding && noValue(facts.rasp),
    },
    {
      id: "thermompnn",
      value: facts.thermompnn ?? null,
      status: facts.thermompnnStatus ?? null,
      problem: absenceProblemFor(getEngine("thermompnn"), facts.thermompnnStatus),
      detail: facts.thermompnnError ?? null,
      runActive: isFolding || remoteRunActive(facts.thermompnnStatus, facts.thermompnn),
    },
    {
      id: "stabilityoracle",
      value: facts.stabilityoracle ?? null,
      runActive: isFolding && noValue(facts.stabilityoracle),
    },
  ];

  return observations.map(obs => resolveEngineOutcome({ ...obs, hidden: facts.hidePending }));
}

// ---------------------------------------------------------------------------
// Coverage — the fact that a 1-of-6 estimate is not a 6-of-6 estimate
// ---------------------------------------------------------------------------

export interface CoverageSummary {
  /** Engines that returned a value and therefore feed the consensus. */
  computed: number;
  /** Total engines the consensus is designed around. */
  intended: number;
  /** Engines that are structurally unavailable in this deployment (not a per-variant failure). */
  notAvailableInDeployment: number;
  /** Engines still legitimately running. */
  running: readonly EnergyEngineId[];
  /** Engines that returned nothing, with the reason. */
  missing: readonly EngineOutcome[];
  /**
   * True when too few engines returned a value for the consensus to be presented as an
   * ensemble result. Surfaces must change their treatment (not merely their wording) when set.
   */
  insufficient: boolean;
  /** e.g. "1 of 6 engines". */
  label: string;
}

/** Below this many engines, a weighted average is a single-tool estimate, not a consensus. */
export const MIN_ENGINES_FOR_CONSENSUS = 3;

export function summarizeCoverage(outcomes: readonly EngineOutcome[]): CoverageSummary {
  const computed = outcomes.filter(o => o.contributesToConsensus).length;
  const running = outcomes.filter(o => o.state === "running").map(o => o.id);
  const missing = outcomes.filter(o => !o.contributesToConsensus && o.state !== "running");
  const notAvailableInDeployment = outcomes.filter(
    o => o.state === "not-installed" || o.state === "not-covered"
  ).length;

  return {
    computed,
    intended: ENERGY_ENGINES.length,
    notAvailableInDeployment,
    running,
    missing,
    insufficient: computed < MIN_ENGINES_FOR_CONSENSUS,
    label: `${computed} of ${ENERGY_ENGINES.length} engines`,
  };
}

/**
 * A one-sentence, plain-language summary of the run's coverage, for the verdict block.
 * Answers "how much should I trust the number above?" in the same breath as the number.
 */
export function describeCoverage(summary: CoverageSummary): string {
  const { computed, intended } = summary;
  if (computed === 0) return `No engine returned a value (0 of ${intended}).`;
  if (computed === 1) {
    return `Single-engine estimate: 1 of ${intended} engines returned a value, so this is not an ensemble result.`;
  }
  if (summary.insufficient) {
    return `Low agreement support: only ${computed} of ${intended} engines returned a value.`;
  }
  if (computed < intended) {
    return `${computed} of ${intended} engines returned a value.`;
  }
  return `All ${intended} engines returned a value.`;
}

// ---------------------------------------------------------------------------
// Provenance — the structure a ΔΔG was computed on
// ---------------------------------------------------------------------------

export type ProvenanceSource = "experimental" | "alphafold" | "homolog" | "client-provided";

export interface ProvenanceView {
  label: string;
  /** True when the structure is a real experimental or homology template (higher trust). */
  isTemplate: boolean;
  detail: string;
}

/**
 * Maps the four `StructureProvenance.source` values to labels. The previous implementation
 * handled three and fell through to "AlphaFold Prediction", which mislabelled a user-supplied
 * structure as a prediction — a provenance claim that is simply false.
 */
export function describeProvenance(
  source: ProvenanceSource | null | undefined,
  extras: { pdbId?: string; resolution?: number | null; identity?: number | null } = {}
): ProvenanceView {
  const resolved: ProvenanceSource = source ?? "alphafold";
  const bits: string[] = [];
  if (extras.pdbId) bits.push(extras.pdbId.toUpperCase());
  if (extras.resolution != null) bits.push(`${extras.resolution.toFixed(1)} Å`);
  if (extras.identity != null) bits.push(`${extras.identity.toFixed(0)}% identity`);
  const detail = bits.join(" · ");

  switch (resolved) {
    case "experimental":
      return { label: "Experimental structure", isTemplate: true, detail };
    case "homolog":
      return { label: "Structural homolog", isTemplate: true, detail };
    case "client-provided":
      return { label: "Structure supplied by you", isTemplate: false, detail };
    case "alphafold":
    default:
      return { label: "AlphaFold prediction", isTemplate: false, detail };
  }
}

// ---------------------------------------------------------------------------
// Migration guardrail
// ---------------------------------------------------------------------------

/**
 * The ad-hoc status strings this module replaced. They must not reappear as string literals in
 * any Energetics surface: each one either duplicated another, described a state the code never
 * established, or leaked infrastructure naming to a clinical user.
 *
 * Only *unambiguous status labels* belong here. Taxonomy phrases such as "Graph Deep Learning /
 * Transformers" or "ProteinMPNN Embeddings / Deep Learning" are deliberately excluded because
 * they are legitimate `Type`-column text as well as having once been used as status strings —
 * including them would flag correct code. Consolidating those taxonomies onto
 * `ENERGY_ENGINES[].taxonomy` is tracked separately.
 */
export const LEGACY_ENGINE_LABELS: readonly string[] = [
  "Not in Zenodo DB",
  "Upstream Congested",
  "Coverage Limited",
  "Unavailable (No Heuristics)",
  "API Limit / Failed",
  "Skipped by User",
  "Not Installed (Mount Binary)",
  "BioSig Queue / Unavailable",
  "Not Available",
  "Not Computed",
  "Simulation Failed",
  "Biophysical Simulation Failed",
  "Repacking sidechains",
  "Remote NMA Server",
  "Initializing",
  "Standby",
  "Offline",
  "Idle",
  "In Progress",
  "N/A",
];

export interface LegacyLabelHit {
  label: string;
  line: number;
}

/**
 * Removes comments while preserving line numbering, so a hit reports a usable line and a
 * comment that *documents* a legacy label is not itself a violation.
 *
 * MUST be string-aware. The previous implementation was two regexes — `/\/\*[\s\S]*?\*\//g` then
 * `/\/\/.*$/gm` — and both were wrong in ways that made this scanner **blind** rather than noisy:
 *
 *   • `/\/\/.*$/gm` truncates a line at the first `//` *anywhere*, including inside a string
 *     literal. `{ label: "Not in Zenodo DB", href: "https://doi.org/…" }` therefore lost its label
 *     before the scan ran. A mutation test proved it: injecting a legacy label onto a line
 *     containing a DOI URL produced zero hits, while the same literal one line down produced one.
 *     This file's own surface (EnergeticsView) contains ten `//`-bearing string literals.
 *   • the block-comment pass could swallow code following a string containing `/*`.
 *
 * A guard that misses violations is worse than one that over-reports: noise is visible and gets
 * fixed, blindness looks like compliance. So the scan walks the source and copies string literals
 * verbatim before it ever considers a comment.
 *
 * Exported because the source-scanning guards need the same treatment; anything less means the
 * guards disagree with the scanner they call.
 */
export function stripCommentsForScan(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    // A string-like literal is copied verbatim, so a `//` or `/*` inside it is never a comment.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        const ch = source[i];
        if (ch === "\\") {
          out += ch + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += ch;
        i += 1;
        if (ch === quote) break;
      }
      continue;
    }

    if (c === "/" && next === "/") {
      // Line comment: drop to the newline, which the fall-through copies.
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n"; // preserve line numbering
        i += 1;
      }
      i += 2; // consume the closing */
      continue;
    }

    out += c;
    i += 1;
  }

  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns every legacy label present as a **string literal** in `source`, with its 1-based line
 * number.
 *
 * Matching is restricted to quoted text (single, double or backtick, on one line) so that:
 *   • a label embedded in a longer message is still caught ("Repacking sidechains..."),
 *   • an identifier that merely contains a label is not (the old `isAsyncOffline` variable),
 *   • a comment documenting the migration is not.
 *
 * JSX text nodes are out of scope; every legacy label in this codebase was a quoted value in a
 * badge/status object, which is what the guard is designed to protect.
 */
export function findLegacyLabels(source: string): LegacyLabelHit[] {
  const clean = stripCommentsForScan(source);
  const hits: LegacyLabelHit[] = [];
  clean.split("\n").forEach((line, index) => {
    for (const label of LEGACY_ENGINE_LABELS) {
      const quoted = new RegExp(`(["'\`])[^"'\`\\n]*${escapeRegExp(label)}[^"'\`\\n]*\\1`);
      if (quoted.test(line)) hits.push({ label, line: index + 1 });
    }
  });
  return hits;
}
