/**
 * energeticsEvidence.ts — ONE model of the Energetics (ΔΔG) evidence, rendered by the tab and by its
 * inspector rail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REPLACED
 * ─────────────────────────────────────────────────────────────────────────────
 *   • A "Calibrated probability of destabilization" with a "90% conformal prediction interval" as the
 *     tab's headline. Its per-engine curves (`stacking_config.json`) were typed by hand in
 *     `tools/train_stacker.py` — the dataset download, homology filter and Venn-ABERS steps there are
 *     `pass` or "simulation" — so no number in it was ever fitted to data. The export printed the same
 *     probability bounds as "95% CI" in kcal/mol. Removed, not relabelled: there is nothing to show.
 *   • "Engine-specific calibrated cut-points" in the table footer. Every ΔΔG mark in this app is local
 *     (THRESHOLD_NOTES.foldxDdG says FoldX publishes none; the ML engines' ±1.0 is ours). They are now
 *     drawn dashed and called local marks.
 *   • Two surfaces building the same engine rows with different props and copy (a view and a
 *     "telemetry" inspector that repeated the table, plus a hard-coded "±1.20 kcal/mol (ProTherm)",
 *     "298.15 K / pH 7.0" regardless of the run's conditions, and a "RaSP snapshot" and "Embedding
 *     model" printed for every run whether or not RaSP or any embedding model produced anything).
 *
 * INVARIANTS
 *   • Every engine state comes from `buildEngineOutcomes`; every ΔΔG from `toCanonicalDdg` (positive =
 *     destabilizing, whatever the provider's sign); every call from the engine's own marks
 *     (`classifyRawDdg`). This module adds the SUMMARY and the words, never a second classification.
 *   • ΔΔG feeds no ACMG criterion in this app (grep server/services/prediction/acmg), so there is no
 *     code to read or to show. The finding says so, rather than implying a PP3/PM1 it does not carry.
 *   • Agreement is counted, not averaged into a probability: how many engines that returned a value
 *     sit past their own destabilizing mark. The headline figure is their median ΔΔG, with the range.
 *   • An engine with no value is a state with a reason, never 0 and never "neutral".
 *   • Provenance rows are read from the payload; a dataset or model name is shown only when the engine
 *     that uses it returned a value.
 */

import {
  buildEngineOutcomes,
  classifyRawDdg,
  describeProvenance,
  formatDdg,
  getEngine,
  KJ_PER_KCAL,
  summarizeCoverage,
  ENGINE_STATE_LABELS,
  MIN_ENGINES_FOR_CONSENSUS,
  RASP_BUNDLED_PROTEINS,
  type CoverageSummary,
  type EnergyEngineId,
  type EnergyUnit,
  type EngineFacts,
  type EngineOutcome,
  type ProvenanceSource,
  type RemoteStatus,
} from "./engineStatus.ts";
import type { StructureProvenance } from "./contracts.ts";
import { RASP_SOURCE_LABEL, type RaspCoverage, type RaspSource } from "./raspIndex.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnergeticsGroup = "physics" | "learned" | "lookup";

export const ENERGETICS_GROUP_LABEL: Record<EnergeticsGroup, string> = {
  physics: "Force field",
  learned: "Structure-based machine learning",
  lookup: "Precomputed lookup",
};

export const ENERGETICS_GROUP_NOTE: Record<EnergeticsGroup, string> = {
  physics: "A force-field ΔΔG on a template structure: computed here, or precomputed by ProtVar",
  learned: "Remote servers and local model services, run on the same template",
  lookup: "Read from a precomputed table; no calculation for this run",
};

const ENGINE_GROUP: Record<EnergyEngineId, EnergeticsGroup> = {
  foldx: "physics",
  dynamut2: "learned",
  ddmut: "learned",
  thermompnn: "learned",
  stabilityoracle: "learned",
  rasp: "lookup",
  // It IS FoldX, so it sits beside the local run in the force-field group, where the two are compared.
  protvar: "physics",
};

export type EnergeticsCaveat = "unrepaired-template" | "low-plddt" | "excluded" | "rosetta-surrogate" | "protvar-stand-in";

export const ENERGETICS_CAVEAT_TEXT: Record<EnergeticsCaveat, { label: string; detail: string }> = {
  "unrepaired-template": {
    label: "Unrepaired template",
    detail:
      "FoldX ran on the template without RepairPDB. The FoldX authors recommend repairing a structure before BuildModel; unrepaired clashes and strained rotamers can distort the ΔΔG.",
  },
  "low-plddt": {
    label: "Low pLDDT",
    detail:
      "The AlphaFold model has low confidence (pLDDT < 70) at this residue. Rigid-backbone and structure-based estimates are unreliable in poorly modelled regions.",
  },
  excluded: {
    label: "Not counted",
    detail: "Shown for reference only — excluded from the agreement count.",
  },
  "protvar-stand-in": {
    label: "ProtVar value",
    detail:
      "No local FoldX value exists for this run, and its template is the AlphaFold model, so EBI ProtVar's precomputed FoldX on that model stands in as the one FoldX reading. It is counted once; it is not a second engine.",
  },
  "rosetta-surrogate": {
    label: "Rosetta surrogate",
    detail:
      "RaSP is trained to reproduce Rosetta cartesian_ddg, not experimental ΔΔG, so it inherits Rosetta's errors (Blaabjerg 2023).",
  },
};

/** The marks drawn on an engine's ruler, in canonical kcal/mol. All are local: none is published. */
export interface EnergeticsMark {
  value: number;
  label: string;
  side: "destabilizing" | "stabilizing";
}

export interface EnergeticsReading {
  key: EnergyEngineId;
  name: string;
  /** What the engine is, in one line. */
  description: string;
  /** Method family, for the rail and the knowledge modal. */
  method: string;
  group: EnergeticsGroup;
  outcome: EngineOutcome;
  /** Canonical ΔΔG in kcal/mol, or null. */
  ddg: number | null;
  /** Whether this value is counted in the agreement. */
  counted: boolean;
  /** "Destabilizing" | "Moderately destabilizing" | "Neutral" | "Stabilizing", from the engine's own marks. */
  callLabel: string | null;
  /** Chip tone: red only for a value past the engine's destabilizing mark. */
  callTone: "danger" | "neutral" | "muted";
  /** The engine's own destabilizing mark (canonical kcal/mol). */
  strongMark: number;
  marks: EnergeticsMark[];
  caveats: EnergeticsCaveat[];
  /** One factual line under the name (runs, spread, repair), or null. */
  note: string | null;
  /** Knowledge-modal key in MetricExplanations. */
  knowledgeKey: EnergyEngineId;
}

/**
 * `moderate`: every counted engine sits between its moderate and destabilizing marks. Without it that
 * case fell into `split` and read "the engines disagree" for engines that all agree.
 */
export type AgreementDirection = "destabilizing" | "moderate" | "not-destabilizing" | "split" | "none";

/**
 * The stability verdict, as a CLOSED SET. It is what the server stores as
 * `energetics.consensusVerdict`, what the export and the provenance manifest carry, and what the
 * tab's chip says in shorter words — one rule, `stabilityVerdict`, produces it for all of them.
 *
 * It replaced "High/Moderate/Low Misfolding Risk (…)", which was a threshold on a probability from
 * hand-typed curves (see the header of this file). Re-exported by `thresholds/consensus.ts` as
 * `CONSENSUS_VERDICTS`, where the closed-set guard test reads it.
 */
export const STABILITY_VERDICTS = {
  insufficient: "Insufficient Biophysical Data",
  destabilizing: "Destabilizing (Engines Agree)",
  moderate: "Moderately Destabilizing (Engines Agree)",
  notDestabilizing: "No Destabilization Predicted",
  split: "Engines Disagree",
  singleDestabilizing: "Destabilizing (Single-Engine Estimate)",
  singleModerate: "Moderately Destabilizing (Single-Engine Estimate)",
  singleNotDestabilizing: "No Destabilization (Single-Engine Estimate)",
} as const;

export type StabilityVerdict = (typeof STABILITY_VERDICTS)[keyof typeof STABILITY_VERDICTS];

export interface EnergeticsAgreement {
  direction: AgreementDirection;
  /** The closed-set verdict for this agreement (see `STABILITY_VERDICTS`). */
  verdict: StabilityVerdict;
  /** Engines with a counted value. */
  nCounted: number;
  /** Counted engines at or past their destabilizing mark. */
  destabilizing: EnergeticsReading[];
  /** Counted engines between their supporting and destabilizing marks. */
  moderate: EnergeticsReading[];
  /** Counted engines below their supporting mark (neutral or stabilizing). */
  notDestabilizing: EnergeticsReading[];
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface EnergeticsStructure {
  label: string;
  source: ProvenanceSource | null;
  pdbId: string | null;
  chainId: string | null;
  resolution: number | null;
  identity: number | null;
  /** "Repaired", "Repair reused", "Not repaired (…)", "Repair failed" or null when unknown. */
  repair: string | null;
  repairState: "repaired" | "unrepaired" | "failed" | "unknown";
}

/**
 * Two FoldX values for one substitution, on two templates: the local BuildModel run, and EBI
 * ProtVar's precomputed value on the AlphaFold DB model.
 *
 * It is a CROSS-CHECK, never a second vote. The two differ in template (an experimental complex or a
 * homology model against an AlphaFold monomer) and in pipeline (repair, runs, settings, ProtVar's
 * low-pLDDT trimming), so a gap is not an error bar on either value; it says how template-sensitive
 * FoldX is for this variant. The size rule is local, like every ΔΔG mark here.
 */
export interface FoldxTemplateCheck {
  /** `consistent`: close and in the same band; `differs`: far apart or in different bands; `opposite`: they point in opposite directions. */
  state: "consistent" | "differs" | "opposite";
  /** The local run's ΔΔG, canonical kcal/mol. */
  local: number;
  /** ProtVar's ΔΔG, canonical kcal/mol. */
  protvar: number;
  /** `protvar − local`, canonical kcal/mol. */
  delta: number;
  /** "1YOV:A (experimental, 2.8 Å)" or "the AlphaFold model". */
  localTemplate: string;
  /** "AF-Q13564-F1". */
  protvarTemplate: string;
  /** Both ran on an AlphaFold model, so a gap points at the pipeline rather than the template. */
  sameTemplateKind: boolean;
  /** Whether the local value is excluded from the agreement (its template repair failed). */
  localCounted: boolean;
  headline: string;
  detail: string;
  tone: "neutral" | "warning";
}

/** ProtVar's value standing in as the run's single FoldX reading (see `FOLDX_STAND_IN_RULE`). */
export interface FoldxStandIn {
  model: string | null;
  plddt: number | null;
}

export interface EnergeticsEvidence {
  readings: EnergeticsReading[];
  coverage: CoverageSummary;
  agreement: EnergeticsAgreement;
  /** Engines still calculating. */
  running: EnergeticsReading[];
  /** Engines without a value that are not running. */
  missing: EnergeticsReading[];
  structure: EnergeticsStructure | null;
  /** pLDDT at the residue, only when the template is an AlphaFold model (or its source is unknown). */
  lowPlddt: number | null;
  isFolding: boolean;
  /** Provenance rows the payload actually carries. */
  sources: Array<[string, string]>;
  /** Local FoldX against ProtVar's FoldX, when both returned a value; otherwise null. */
  foldxTemplateCheck: FoldxTemplateCheck | null;
  /** Set when ProtVar's value IS the FoldX reading because no local value exists (AlphaFold template only). */
  foldxStandIn: FoldxStandIn | null;
}

/**
 * ONE FoldX reading counts. Local FoldX is it whenever it has a value. ProtVar's precomputed FoldX
 * counts instead only when the local run has NO value AND the run's template is the AlphaFold model
 * (the model ProtVar computed on), so the value describes the template the rest of the run uses. On an
 * experimental or homology template ProtVar stays a cross-check: it would describe another structure.
 */
export const FOLDX_STAND_IN_RULE =
  "ProtVar's FoldX counts as the FoldX reading only when there is no local value and the template is the AlphaFold model.";

/** The local gap above which two FoldX values are called different: about FoldX's own reported error. */
export const FOLDX_TEMPLATE_DIFFERENCE_KCAL = 1;
/** Below this magnitude a value is "near zero", so a sign difference is not read as opposite directions. */
const FOLDX_NEAR_ZERO_KCAL = 0.5;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface EnergeticsInputs {
  foldingDdG?: number | null;
  foldingStatus?: "success" | "failed" | "unavailable" | null;
  foldingEnergetics?: Record<string, any> | null;
  dynamut2Status?: RemoteStatus;
  ddmutStatus?: RemoteStatus;
  thermompnnStatus?: RemoteStatus;
  thermompnnError?: string | null;
  foldingError?: string | null;
  isFolding?: boolean;
  plddt?: number | null;
  hidePending?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * " (+1.55 to +2.95 kcal/mol)" when the runs differ at the displayed precision, else "".
 *
 * BuildModel's runs land in discrete rotamer states, so an ensemble can be bimodal: SOD1 p.Ala5Val
 * on a repaired template gave 1.55, 1.58, 1.61, 2.90, 2.95. A mean and SD alone hide that two runs
 * disagree with three; the range shows it. Identical runs add nothing, so they add no text.
 */
function runRange(raw: unknown): string {
  const runs = Array.isArray(raw) ? raw.map(num).filter((v): v is number => v !== null) : [];
  if (runs.length < 2) return "";
  const lo = Math.min(...runs);
  const hi = Math.max(...runs);
  if (lo.toFixed(2) === hi.toFixed(2)) return "";
  const signed = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2).replace(/^-/, "−"));
  return ` (${signed(lo)} to ${signed(hi)} kcal/mol)`;
}

/** Signed canonical ΔΔG, "+2.62" / "−0.36", for sentences. */
export function signedDdg(v: number | null, unit: EnergyUnit = "kcal/mol"): string {
  if (v === null) return "—";
  const text = formatDdg(v, unit);
  return v > 0 ? `+${text}` : text.replace(/^-/, "−");
}

/**
 * A mark or axis end in the DISPLAY unit. Marks are stored in canonical kcal/mol; the table showed
 * "local mark +1.5" and a "−3 … +5 kcal/mol" axis beside values already converted to kJ/mol, so a user
 * on kJ read three different scales as one.
 */
export function markText(kcal: number, unit: EnergyUnit = "kcal/mol", signed = true): string {
  const v = unit === "kJ/mol" ? kcal * KJ_PER_KCAL : kcal;
  const text = Number.isInteger(v) ? String(v) : unit === "kJ/mol" ? v.toFixed(1) : String(v);
  return signed && v > 0 ? `+${text}` : text.replace(/^-/, "−");
}

/** A list read aloud: "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function repairOf(e: Record<string, any> | null | undefined): Pick<EnergeticsStructure, "repair" | "repairState"> {
  if (!e) return { repair: null, repairState: "unknown" };
  if (e.foldxRepairFailed) return { repair: "Repair failed", repairState: "failed" };
  if (e.foldxRepairSkipped) {
    const why =
      e.foldxRepairSkippedReason === "large-structure"
        ? " (large structure)"
        : e.foldxRepairSkippedReason === "alphafold-plddt"
          ? " (pLDDT in B-factors)"
          : e.foldxRepairSkippedReason === "repair-exceeds-budget"
            ? " (repair too slow on this server)"
            : "";
    return { repair: `Not repaired${why}`, repairState: "unrepaired" };
  }
  if (e.foldxRepairCached) return { repair: "Repaired (reused)", repairState: "repaired" };
  if (num(e.foldxMean ?? e.foldx) !== null) return { repair: "Repaired", repairState: "repaired" };
  return { repair: null, repairState: "unknown" };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildEnergeticsEvidence(input: EnergeticsInputs): EnergeticsEvidence {
  const e = input.foldingEnergetics ?? null;
  const isFolding = Boolean(input.isFolding);
  const prov: StructureProvenance | null = (e?.structureProvenance as StructureProvenance | undefined) ?? null;

  const localFoldxMean = num(e?.foldxMean) ?? num(input.foldingDdG);
  const localFoldxDdg = num(e?.foldx) ?? num(input.foldingDdG);
  const protvarValue = num(e?.protvar);
  const protvarPlddt = num(e?.protvarPlddt);
  const protvarModel = typeof e?.protvarModel === "string" ? e.protvarModel : null;
  const standIn: FoldxStandIn | null =
    localFoldxMean === null && localFoldxDdg === null && protvarValue !== null && prov?.source === "alphafold"
      ? { model: protvarModel, plddt: protvarPlddt }
      : null;

  const facts: EngineFacts = {
    foldxMean: standIn ? protvarValue : localFoldxMean,
    foldxDdg: standIn ? protvarValue : localFoldxDdg,
    foldxSd: standIn ? null : num(e?.foldxSd),
    dynamut2: num(e?.dynamut2),
    ddmut: num(e?.ddmut),
    rasp: num(e?.rasp),
    thermompnn: num(e?.thermompnn),
    stabilityoracle: num(e?.stabilityoracle),
    dynamut2Status: input.dynamut2Status,
    ddmutStatus: input.ddmutStatus,
    raspStatus: e?.raspStatus,
    dynamut2Error: typeof e?.dynamut2Error === "string" ? e.dynamut2Error : null,
    ddmutError: typeof e?.ddmutError === "string" ? e.ddmutError : null,
    dynamut2Listening: e?.dynamut2Listening === true,
    ddmutListening: e?.ddmutListening === true,
    raspError: typeof e?.raspError === "string" ? e.raspError : null,
    thermompnnStatus: input.thermompnnStatus,
    stabilityoracleStatus: e?.stabilityoracleStatus,
    stabilityoracleError: typeof e?.stabilityoracleError === "string" ? e.stabilityoracleError : null,
    raspReason: typeof e?.raspReason === "string" ? e.raspReason : null,
    raspCoverage: (e?.raspCoverage as RaspCoverage | undefined) ?? null,
    thermompnnError: input.thermompnnError ?? null,
    foldingError: input.foldingError ?? null,
    foldingStatus: input.foldingStatus ?? null,
    // A local repair failure or missing binary says nothing about ProtVar's value.
    foldxRepairFailed: standIn ? false : Boolean(e?.foldxRepairFailed),
    foldxBinaryMissing: standIn ? false : Boolean(e?.foldxBinaryMissing),
    isFolding,
    structureProvenance: prov,
    hidePending: input.hidePending,
    /**
     * The session-lapse record `foldxService` writes onto the run's energetics when a remote
     * engine collection was refused. Absent on older runs, which resolves to no pause.
     */
    energeticsAuthLapsed:
      (e?.energeticsAuthLapsed as EngineFacts["energeticsAuthLapsed"]) ?? null,
    protvar: num(e?.protvar),
    protvarStatus: e?.protvarStatus,
    protvarReason: typeof e?.protvarReason === "string" ? e.protvarReason : null,
    protvarError: typeof e?.protvarError === "string" ? e.protvarError : null,
  };
  // `protvarPlddt` is the pLDDT at this residue in the model ProtVar's FoldX ran on — ITS model.

  const outcomes = buildEngineOutcomes(facts);
  const coverage = summarizeCoverage(outcomes);

  const source = (prov?.source as ProvenanceSource | undefined) ?? null;
  const plddt = num(input.plddt);
  // pLDDT describes an AlphaFold model. On an experimental or homology template it is a number about
  // a different structure, so it is not a caveat on these values.
  const lowPlddt =
    plddt !== null && plddt < 70 && (source === null || source === "alphafold") ? plddt : null;
  const repair = repairOf(e);

  const runs = num(prov?.foldxRuns);
  const sd = num(e?.foldxSd);

  const allReadings: EnergeticsReading[] = outcomes.map(outcome => {
    const engine = getEngine(outcome.id);
    const has = outcome.canonicalDdg !== null;
    const caveats: EnergeticsCaveat[] = [];
    if (has && outcome.excluded) caveats.push("excluded");
    if (has && outcome.id === "foldx" && standIn) caveats.push("protvar-stand-in");
    if (has && outcome.id === "foldx" && !standIn && repair.repairState === "unrepaired") caveats.push("unrepaired-template");
    if (outcome.id === "protvar" || (outcome.id === "foldx" && standIn)) {
      // ProtVar always ran on an AlphaFold model, so its own pLDDT is the one that applies.
      if (has && protvarPlddt !== null && protvarPlddt < 70) caveats.push("low-plddt");
    } else if (has && lowPlddt !== null && outcome.id !== "rasp") caveats.push("low-plddt");
    if (has && outcome.id === "rasp") caveats.push("rosetta-surrogate");

    let note: string | null = null;
    if (outcome.id === "foldx" && has && standIn) {
      note =
        `Precomputed by EBI ProtVar with FoldX on ${protvarModel ?? "the AlphaFold DB model"}` +
        `${protvarPlddt !== null ? ` (pLDDT ${protvarPlddt.toFixed(1)} at this residue)` : ""}. ` +
        "No local FoldX value exists for this run; it stands in because the template is the AlphaFold model.";
    } else if (outcome.id === "foldx" && has) {
      const parts: string[] = [];
      if (runs !== null) parts.push(`Mean of ${runs} BuildModel runs${runRange(e?.rawDdGs)}`);
      if (sd !== null) parts.push(`run-to-run spread ${formatDdg(sd)}, not an error bar`);
      if (outcome.excluded) parts.push(outcome.reason);
      note = parts.length ? parts.join("; ") + "." : null;
    } else if (outcome.id === "protvar" && has) {
      note =
        `Precomputed by EBI ProtVar with FoldX on ${protvarModel ?? "the AlphaFold DB model"}` +
        `${protvarPlddt !== null ? ` (pLDDT ${protvarPlddt.toFixed(1)} at this residue)` : ""}. ` +
        "Shown as a cross-check: it is FoldX again, on a different template, so it is not counted as a second engine.";
    } else if (outcome.id === "rasp" && has) {
      const src = e?.raspSource as RaspSource | undefined;
      note = src
        ? `From the ${RASP_SOURCE_LABEL[src]} table${src === "experimental" ? "; positions follow the authors' structure numbering" : ""}.`
        : null;
    }

    const risk = outcome.risk;
    const callLabel = has ? (outcome.excluded ? "Not counted" : risk?.label ?? null) : null;
    const callTone: EnergeticsReading["callTone"] = !has || outcome.excluded ? "muted" : risk?.id === "high" ? "danger" : "neutral";

    const marks: EnergeticsMark[] = [
      { value: engine.stabilizingCut, label: `${engine.stabilizingCut} stabilizing (local)`, side: "stabilizing" },
      { value: engine.supportingCut, label: `+${engine.supportingCut} moderately destabilizing (local)`, side: "destabilizing" },
      { value: engine.strongCut, label: `+${engine.strongCut} destabilizing (local)`, side: "destabilizing" },
    ];

    return {
      key: outcome.id,
      name: engine.name,
      description: engine.summary,
      method: engine.taxonomy,
      group: ENGINE_GROUP[outcome.id],
      outcome,
      ddg: outcome.canonicalDdg,
      counted: outcome.contributesToConsensus,
      callLabel,
      callTone,
      strongMark: engine.strongCut,
      marks,
      caveats,
      note,
      knowledgeKey: outcome.id,
    };
  });

  /**
   * ProtVar's row sits right after FoldX, where the two are compared. When its value IS the FoldX
   * reading it is not shown a second time.
   */
  const readings: EnergeticsReading[] = [
    ...allReadings.filter(r => r.key === "foldx"),
    ...allReadings.filter(r => r.key === "protvar" && !standIn),
    ...allReadings.filter(r => r.key !== "foldx" && r.key !== "protvar"),
  ];

  const counted = readings.filter(r => r.counted && r.ddg !== null);
  const destabilizing = counted.filter(r => r.outcome.risk?.id === "high");
  const moderate = counted.filter(r => r.outcome.risk?.id === "moderate");
  const notDestabilizing = counted.filter(r => r.outcome.risk?.id === "neutral" || r.outcome.risk?.id === "stabilizing");
  const values = counted.map(r => r.ddg as number);

  let direction: AgreementDirection;
  if (counted.length === 0) direction = "none";
  else if (destabilizing.length === counted.length) direction = "destabilizing";
  else if (moderate.length === counted.length) direction = "moderate";
  else if (destabilizing.length === 0 && moderate.length === 0) direction = "not-destabilizing";
  else direction = "split";

  const agreement: EnergeticsAgreement = {
    direction,
    verdict: stabilityVerdict(direction, counted.length),
    nCounted: counted.length,
    destabilizing,
    moderate,
    notDestabilizing,
    median: medianOf(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };

  const structure: EnergeticsStructure | null = prov
    ? (() => {
        const view = describeProvenance(source, {
          pdbId: prov.pdbId,
          resolution: prov.resolution,
          identity: prov.identity,
        });
        return {
          label: view.label,
          source,
          pdbId: prov.pdbId ? prov.pdbId.toUpperCase() : null,
          chainId: prov.chainId ?? null,
          resolution: num(prov.resolution),
          identity: num(prov.identity),
          ...repair,
        };
      })()
    : null;

  const sources: Array<[string, string]> = [];
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) sources.push([label, value.trim()]);
    else if (typeof value === "number" && Number.isFinite(value)) sources.push([label, String(value)]);
  };
  if (structure) {
    add("Template", structure.pdbId ? `${structure.pdbId}${structure.chainId ? `:${structure.chainId}` : ""}` : structure.label);
    add("AlphaFold DB", prov?.afdbVersion);
  }
  const foldxHas = !standIn && readings[0]?.ddg !== null;
  if (foldxHas) {
    add("FoldX version", prov?.foldxVersion);
    add("FoldX runs", runs ?? undefined);
    add("Random seed", num(prov?.seed) ?? undefined);
  }
  const raspSrc = e?.raspSource as RaspSource | undefined;
  if (readings.find(r => r.key === "rasp")?.ddg !== null && raspSrc) add("RaSP table", RASP_SOURCE_LABEL[raspSrc]);
  if (protvarValue !== null) add("ProtVar model", protvarModel ?? undefined);
  add("Model digest", typeof prov?.modelSha === "string" ? prov.modelSha.slice(0, 12) : undefined);

  const localReading = readings.find(r => r.key === "foldx");
  const foldxTemplateCheck =
    !standIn && localReading?.ddg != null && protvarValue !== null
      ? buildFoldxTemplateCheck({
          local: localReading.ddg,
          localCounted: localReading.counted,
          protvar: protvarValue,
          protvarModel,
          structure,
          repairState: repair.repairState,
        })
      : null;

  return {
    readings,
    coverage,
    agreement,
    // The run's state is about the engines that can count; a reference row keeps its own state in
    // the table but never holds the stage "running" or reports it "failed".
    running: readings.filter(r => r.outcome.state === "running" && !r.outcome.engine.referenceOnly),
    missing: readings.filter(r => r.ddg === null && r.outcome.state !== "running" && !r.outcome.engine.referenceOnly),
    structure,
    lowPlddt,
    isFolding,
    sources,
    foldxTemplateCheck,
    foldxStandIn: standIn,
  };
}

/** The template a local FoldX value was computed on, in words, for the cross-check. */
function describeLocalTemplate(structure: EnergeticsStructure | null): { text: string; alphafold: boolean } {
  if (!structure) return { text: "the local template", alphafold: false };
  if (structure.source === "alphafold") return { text: "the AlphaFold model", alphafold: true };
  const id = structure.pdbId ? `${structure.pdbId}${structure.chainId ? `:${structure.chainId}` : ""}` : null;
  const kind = structure.source === "homolog" ? "homology template" : structure.source === "client-provided" ? "supplied structure" : "experimental";
  const res = structure.resolution !== null ? `, ${structure.resolution.toFixed(1)} Å` : "";
  return { text: id ? `${id} (${kind}${res})` : `the ${kind} structure`, alphafold: false };
}

function buildFoldxTemplateCheck(args: {
  local: number;
  localCounted: boolean;
  protvar: number;
  protvarModel: string | null;
  structure: EnergeticsStructure | null;
  repairState: EnergeticsStructure["repairState"];
}): FoldxTemplateCheck {
  const { local, protvar, protvarModel, structure, repairState } = args;
  const delta = protvar - local;
  const localBand = classifyRawDdg("foldx", local)?.id;
  const protvarBand = classifyRawDdg("foldx", protvar)?.id;
  const opposite =
    Math.sign(local) !== Math.sign(protvar) &&
    Math.abs(local) >= FOLDX_NEAR_ZERO_KCAL &&
    Math.abs(protvar) >= FOLDX_NEAR_ZERO_KCAL;
  const state: FoldxTemplateCheck["state"] = opposite
    ? "opposite"
    : Math.abs(delta) >= FOLDX_TEMPLATE_DIFFERENCE_KCAL || localBand !== protvarBand
      ? "differs"
      : "consistent";

  const tpl = describeLocalTemplate(structure);
  const protvarTemplate = protvarModel ?? "the AlphaFold DB model";
  const gap = `${Math.abs(delta).toFixed(2)} kcal/mol`;
  const headline =
    state === "opposite"
      ? "The two FoldX values point in opposite directions."
      : state === "differs"
        ? `The two FoldX values differ by ${gap}.`
        : `The two FoldX values are close (${gap} apart).`;

  const parts = [`FoldX on ${tpl.text} gave ${signedDdg(local)}; ProtVar's FoldX on ${protvarTemplate} gave ${signedDdg(protvar)}.`];
  parts.push(
    tpl.alphafold
      ? "Both ran on an AlphaFold model, so a gap points at the pipeline (repair, number of runs, FoldX settings) rather than the template."
      : "They differ in template and pipeline (and ProtVar models a single chain), so the gap is not an error bar on either value; it shows how template-sensitive FoldX is for this variant."
  );
  if (repairState === "unrepaired" && !tpl.alphafold) parts.push("The local template was not repaired, which can add to the gap.");
  if (!args.localCounted) parts.push("The local value is not counted in the agreement.");

  return {
    state,
    local,
    protvar,
    delta,
    localTemplate: tpl.text,
    protvarTemplate,
    sameTemplateKind: tpl.alphafold,
    localCounted: args.localCounted,
    headline,
    detail: parts.join(" "),
    tone: state === "consistent" ? "neutral" : "warning",
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** Maps an agreement onto the closed verdict set. A single engine is always named as one. */
export function stabilityVerdict(direction: AgreementDirection, nCounted: number): StabilityVerdict {
  const single = nCounted === 1;
  switch (direction) {
    case "none":
      return STABILITY_VERDICTS.insufficient;
    case "destabilizing":
      return single ? STABILITY_VERDICTS.singleDestabilizing : STABILITY_VERDICTS.destabilizing;
    case "moderate":
      return single ? STABILITY_VERDICTS.singleModerate : STABILITY_VERDICTS.moderate;
    case "not-destabilizing":
      return single ? STABILITY_VERDICTS.singleNotDestabilizing : STABILITY_VERDICTS.notDestabilizing;
    case "split":
    default:
      return STABILITY_VERDICTS.split;
  }
}

export const AGREEMENT_CHIP: Record<AgreementDirection, { label: string; tone: "danger" | "neutral" | "muted" }> = {
  destabilizing: { label: "Destabilizing", tone: "danger" },
  moderate: { label: "Moderately destabilizing", tone: "neutral" },
  "not-destabilizing": { label: "No destabilization", tone: "neutral" },
  split: { label: "Engines disagree", tone: "neutral" },
  none: { label: "No ΔΔG", tone: "muted" },
};

export interface EnergeticsSummary {
  lead: string;
  rest: string[];
  /** "warning" when the reader must reconcile something (disagreement, a single engine, a caveat). */
  tone: "neutral" | "warning";
}

/** The one finding sentence, and the facts that qualify it. */
export function energeticsSummary(ev: EnergeticsEvidence, unit: EnergyUnit = "kcal/mol"): EnergeticsSummary {
  const { agreement: a, coverage } = ev;
  const rest: string[] = [];
  let tone: EnergeticsSummary["tone"] = "neutral";
  const named = (rs: EnergeticsReading[]) => listNames(rs.map(r => r.name));
  const withValue = (r: EnergeticsReading) => `${r.name} (${signedDdg(r.ddg, unit)})`;
  /**
   * "Returned" and "counted" are two different counts (an excluded FoldX value returned but does not
   * count), so the sentence says both whenever they differ — the fact tile beside it must not
   * contradict this sentence on the same screen.
   */
  const returnedCount = ev.readings.filter(r => r.ddg !== null && !r.outcome.engine.referenceOnly).length;
  const countedTail = returnedCount !== a.nCounted ? `, ${a.nCounted} of them counted in the agreement` : "";

  let lead: string;
  switch (a.direction) {
    case "none":
      lead = ev.running.length > 0 || ev.isFolding
        ? "No engine has returned a ΔΔG yet."
        : "No stability engine returned a ΔΔG for this variant.";
      break;
    case "destabilizing":
      lead = a.nCounted === 1
        ? `Only ${withValue(a.destabilizing[0])} returned a value, and it is past its destabilizing mark.`
        : `All ${a.nCounted} engines that returned a value predict destabilization.`;
      break;
    case "moderate":
      lead = a.nCounted === 1
        ? `Only ${withValue(a.moderate[0])} returned a value; it is past its moderate mark but not its destabilizing mark.`
        : `All ${a.nCounted} engines that returned a value sit between their moderate and destabilizing marks.`;
      break;
    case "not-destabilizing":
      lead = a.nCounted === 1
        ? `Only ${withValue(a.notDestabilizing[0])} returned a value, and it predicts no destabilization.`
        : `None of the ${a.nCounted} engines that returned a value predicts destabilization.`;
      break;
    case "split":
    default: {
      tone = "warning";
      const past = a.destabilizing.length ? a.destabilizing : a.moderate;
      const others = a.nCounted - past.length;
      lead = `The engines disagree: ${listNames(past.map(withValue))} ${past.length === 1 ? "is" : "are"} past ${
        a.destabilizing.length ? "the destabilizing" : "the moderate"
      } mark; ${others === 1 ? "one other is not" : `the other ${others} are not`}.`;
      break;
    }
  }

  if (a.nCounted > 0 && a.nCounted < MIN_ENGINES_FOR_CONSENSUS) {
    tone = "warning";
    rest.push(
      `${returnedCount} of ${coverage.intended} engines returned a value${countedTail} — too few to read as agreement.`
    );
  } else if (a.nCounted > 0) {
    rest.push(`${returnedCount} of ${coverage.intended} engines returned a value${countedTail}.`);
  }

  if (ev.foldxTemplateCheck) {
    if (ev.foldxTemplateCheck.state !== "consistent") tone = "warning";
    rest.push(
      `${ev.foldxTemplateCheck.headline} ProtVar's FoldX on the AlphaFold model is a cross-check, not a second engine.`
    );
  }
  const caveated = [...a.destabilizing, ...a.moderate].filter(r => r.caveats.includes("unrepaired-template"));
  if (caveated.length) {
    rest.push(`${named(caveated)} ran on an unrepaired template, which can distort its ΔΔG.`);
  }
  if (ev.lowPlddt !== null && a.nCounted > 0) {
    tone = "warning";
    rest.push(`The AlphaFold model is low-confidence here (pLDDT ${ev.lowPlddt.toFixed(1)}).`);
  }
  return { lead, rest, tone };
}

/**
 * The same agreement, from a bare energetics record — for the report and the plain-text export,
 * which hold no engine statuses. Values only; a missing engine is simply not counted.
 */
export function energeticsAgreementText(energetics: Record<string, any> | null | undefined, unit: EnergyUnit = "kcal/mol"): string | null {
  if (!energetics) return null;
  const ev = buildEnergeticsEvidence({ foldingEnergetics: energetics });
  if (ev.agreement.nCounted === 0) return null;
  const s = energeticsSummary(ev, unit);
  const median = ev.agreement.nCounted > 1 ? ` Median ${signedDdg(ev.agreement.median, unit)}.` : "";
  return `${s.lead}${median} ${s.rest.join(" ")}`.trim();
}

/** Reason copy for an engine without a value, with the one fact a curator needs about RaSP. */
export function absenceText(r: EnergeticsReading): string {
  return r.outcome.reason || ENGINE_STATE_LABELS[r.outcome.state];
}

export { RASP_BUNDLED_PROTEINS };

/** Groups readings in display order. */
export function groupEnergeticsReadings(readings: EnergeticsReading[]): Array<{ group: EnergeticsGroup; rows: EnergeticsReading[] }> {
  const order: EnergeticsGroup[] = ["physics", "learned", "lookup"];
  return order
    .map(group => ({ group, rows: readings.filter(r => r.group === group) }))
    .filter(g => g.rows.length > 0);
}

/** Fixed ΔΔG window the rulers share, in kcal/mol; values beyond sit on the edge as hollow marks. */
export const DDG_AXIS = { min: -3, max: 5 } as const;
