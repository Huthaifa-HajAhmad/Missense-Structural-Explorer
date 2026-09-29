/**
 * perturbationEvidence.ts — ONE model for the Structural perturbation tab and its Evidence Lineage
 * rail. Both panes render `buildPerturbationEvidence`; neither computes a reading of its own.
 *
 * ONE QUESTION the tab answers: how do sequence and structure models read this substitution at its
 * own position — and what does that evidence license? Its answer is context. None of these scores
 * is an ACMG input: the rule engine lists the language models as informational in PP3/BP4, and it
 * reads no FoldX term or ESM3 output at all. The model reads that from the engine's own concordance
 * (via `buildPredictorEvidence`) instead of asserting it.
 *
 * INVARIANTS
 *   • ΔLLR is model-native. Values from different model families are never averaged, pooled,
 *     tinted against a cut-point, or turned into a composite. The cross-model statement is the
 *     mutant's WITHIN-model rank, which is scale-free.
 *   • The registry row (embedding width, note, calibration) is the model that SERVED the number —
 *     resolved from the payload's `provenance` — not the model the settings asked for.
 *   • Absence is a state. A missing rank is not rank 1, a missing entropy is not 0 bits, a failed
 *     RMSD is not 0.00 Å, and a Cα displacement on FoldX's rigid backbone is not a measurement.
 *   • Every drawn mark says what it is. None here is published: the rank bands, entropy marks, the
 *     FoldX VdW 2.0 kcal/mol mark and the ESM3 drift bands are app-defined, so they are `local`.
 *   • Physical terms are components of ΔΔG, not stability. Stability lives on the Energetics tab.
 *
 * DEFECTS THIS REPLACED (2026-09 audit, doc/PERTURBATION_REVIEW.md)
 *   • A 0–100 "Local perturbation score" with app-defined weights, a (−ΔLLR−2)/8 transform and
 *     35/65 bands, headlined as a "Consensus verdict". The tab never passed model families to the
 *     pool, so it averaged three model-native ΔLLRs while the rail said "Shared scale: No — mixed";
 *     on FoldX's rigid backbone its Cα term was 0 by construction and pulled it toward "low".
 *   • "Neutral stability" inferred from the VdW clash term alone, printed with the ΔΔG run-to-run
 *     SD as if it were the VdW term's.
 *   • The SaProt card took its row from settings: 650M, "1280-dim", and a note saying its scores
 *     "sit near zero on this variant" beside −6.99 from SaProt_35M_AF2.
 *   • "State: p" — a Foldseek 3Di letter shown as a conformation state; and SaProt runs with no
 *     structure token ("#") not disclosed as sequence-only.
 *   • ESMC's embedding shift labelled cosine (the sidecar computes a Euclidean norm).
 *   • ESM3 "Refinement drift · de novo backbone realignment" for a sequence-embedding distance with
 *     no refinement run; "Confidence HIGH (94.5)" that is the input template's pLDDT; and a
 *     "putative structural impact" line asserted whenever no residue-class rule fired.
 *   • Green/amber tints on RMSD, VdW and ESM3 drift from unsourced local cuts; missing contact
 *     counts printed as 0; ΔSASA of absolute residue area read as burial.
 */

import { ENGINE_STATE_LABELS } from "./engineStatus";
import { THRESHOLDS, LOCAL_STRUCTURAL_WINDOW } from "./thresholds/constants";
import { UNMEASURED_BURIAL_ENVIRONMENT } from "./burialEvidence";
import {
  ENTROPY_MARKS,
  RANK_BANDS,
  describeWithinModelRank,
  rankBand,
  validRank,
  type ModelCalibration,
  type RankBand
} from "./modelCalibration";
import {
  PERTURBATION_MODELS,
  resolveServedModel,
  type PerturbationModelId,
  type ServedModel
} from "./perturbationModels";
import { buildPredictorEvidence } from "./predictorEvidence";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ReadingTone = "neutral" | "muted" | "warning" | "accent";

export type AvailabilityState = "computed" | "pending" | "failed" | "absent";

export interface ReadingAvailability {
  state: AvailabilityState;
  /** From ENGINE_STATE_LABELS — never a hand-written status word. */
  label: string;
  reason: string | null;
  action: "switch-saprot-35m" | "retry" | "settings" | null;
}

export type LmCaveat = "fallback-model" | "sequence-only" | "probability-floor" | "inferred-model";

export const LM_CAVEAT_TEXT: Record<LmCaveat, { label: string; detail: string }> = {
  "fallback-model": {
    label: "Fallback model",
    detail: "A different model from the one this row names produced these numbers; its row below describes the model that ran."
  },
  "sequence-only": {
    label: "No structure token",
    detail: "SaProt received no Foldseek 3Di state at this residue ('#'), so its score here is sequence-only."
  },
  "probability-floor": {
    label: "Probability floor",
    detail: "The variant residue was outside the tokens the remote engine returned and was assigned the 1e-9 floor, so ΔLLR is bounded by that floor, not measured."
  },
  "inferred-model": {
    label: "Model inferred",
    detail: "The payload names no model, so the row is taken from your settings rather than from what ran."
  }
};

export interface LmReading {
  id: PerturbationModelId;
  /** Family label for the table row ("SaProt"). */
  family: string;
  /** The model that served the numbers, as the payload names it. */
  servedBy: string | null;
  served: ServedModel;
  calibration: ModelCalibration | null;
  availability: ReadingAvailability;
  llr: number | null;
  wtProb: number | null;
  mutProb: number | null;
  /** P(variant) / P(native) inside the one model — a same-model ratio, needing no calibration. */
  retention: number | null;
  rank: number | null;
  band: RankBand | null;
  bandLabel: string | null;
  rankSentence: string;
  /** Shannon entropy of the model's residue distribution at the site, bits. */
  entropy: number | null;
  preferences: { aa: string; prob: number }[];
  embedding: {
    atSite: number | null;
    window: { position: number; residue: string; shift: number }[];
    metric: "Euclidean distance";
    dim: number | null;
    /** Why no window, when there is none. */
    absentReason: string | null;
  };
  /** Foldseek 3Di letter SaProt paired with the site, or null. "#" = no structure token. */
  structureToken: string | null;
  caveats: LmCaveat[];
  /**
   * Per-tier failure notes, each labelled with the tier that produced it. A fallback has two
   * possible causes (the remote engine, then the local load), and naming only one used to point
   * the reader at the wrong tier.
   */
  diagnostics: { tier: string; text: string }[];
  /** The reason the served model is a fallback, when the payload gives one. */
  fallbackReason: string | null;
  /** Counted by the engine's PP3/BP4 rule (read from predictorEvidence). */
  votes: boolean;
}

export interface Mark {
  value: number;
  label: string;
}

export interface PhysicalReading {
  key: "vdw" | "elec" | "neighbour-rmsd" | "clash" | "ca-max" | "contacts" | "sasa";
  name: string;
  description: string;
  value: number | null;
  text: string;
  unit: string | null;
  /** Display axis, for readings drawn on a ruler. */
  scale: { min: number; max: number } | null;
  marks: Mark[];
  markKind: "local" | "none";
  call: { label: string; tone: ReadingTone } | null;
  note: string | null;
  availability: ReadingAvailability;
}

export interface Esm3Reading {
  availability: ReadingAvailability;
  servedBy: string | null;
  fallback: boolean;
  drift: number | null;
  driftBand: "none" | "minor" | "moderate" | "major" | null;
  driftResidue: number | null;
  templateConfidence: number | null;
  burial: string | null;
  secondaryStructure: string | null;
}

export interface PerturbationEvidence {
  residues: { wtCode: string; mutCode: string; wtLabel: string; mutLabel: string; position: number | null };
  lms: LmReading[];
  scored: LmReading[];
  /** Families that contributed, and whether they share a scale (they never do across families). */
  scale: { families: string[]; mixed: boolean; llrMin: number | null; llrMax: number | null };
  consensus: {
    nRanked: number;
    nLeast: number;
    nLower: number;
    nUpperOrMost: number;
    /** Every ranked model places the variant in the same band. */
    agree: boolean;
    band: RankBand | null;
  };
  physical: {
    available: boolean;
    rigidBackbone: boolean;
    runs: number | null;
    runsIdentical: boolean;
    readings: PhysicalReading[];
    reason: string | null;
  };
  esm3: Esm3Reading | null;
  engine: { informational: boolean; counted: string[] };
  pending: boolean;
}

export interface PerturbationEvidenceInput {
  result: any;
  residues: { wtCode: string; mutCode: string; wtLabel: string; mutLabel: string };
  foldingEnergetics?: any;
  structuralDiff?: any;
  metrics?: any;
  saprotEngine?: string | null;
  isFolding?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

const computed = (): ReadingAvailability => ({ state: "computed", label: ENGINE_STATE_LABELS.computed, reason: null, action: null });

function lmAvailability(id: PerturbationModelId, data: any): ReadingAvailability {
  if (!data) {
    return { state: "absent", label: ENGINE_STATE_LABELS["no-result"], reason: "This analysis returned no evaluation for this model.", action: "retry" };
  }
  if (data.loading) {
    return { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null };
  }
  if (data.error) {
    const msg = String(data.error);
    const timeout = /timeout|timed out/i.test(msg);
    const warming = data.status === "warming_up" || /warming|initiali[sz]ing/i.test(msg);
    const noKey = /token|api key|unauthori[sz]ed|401|403/i.test(msg);
    return {
      state: "failed",
      label: warming ? ENGINE_STATE_LABELS["upstream-busy"] : timeout ? ENGINE_STATE_LABELS.failed : ENGINE_STATE_LABELS["upstream-error"],
      reason: warming
        ? "The model server is still loading weights."
        : timeout
          ? id === "saprot"
            ? "SaProt timed out. The 35M checkpoint answers in seconds on CPU."
            : "The model timed out."
          : noKey
            ? "The provider refused the request — check the access token in Settings."
            : msg,
      action: timeout && id === "saprot" ? "switch-saprot-35m" : noKey ? "settings" : "retry"
    };
  }
  if (finite(data.llr) === null) {
    return { state: "absent", label: ENGINE_STATE_LABELS["no-result"], reason: "The model answered without a ΔLLR for this substitution.", action: "retry" };
  }
  return computed();
}

function embeddingAbsentReason(data: any, hasWindow: boolean): string | null {
  if (hasWindow) return null;
  const p = typeof data?.provenance === "string" ? data.provenance : "";
  return /remote|cloud|serverless|hf/i.test(p)
    ? "The remote engine scores through a masked-token API that returns no per-residue embeddings; the local engine returns the ±10-residue window."
    : "This model returned no per-residue shift window for this position.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Language models
// ─────────────────────────────────────────────────────────────────────────────

function buildLm(
  id: PerturbationModelId,
  data: any,
  saprotEngine: string | null | undefined,
  residues: PerturbationEvidenceInput["residues"],
  votes: boolean
): LmReading {
  const meta = PERTURBATION_MODELS.find(m => m.id === id)!;
  const provenance = typeof data?.provenance === "string" && data.provenance.trim() ? data.provenance.trim() : null;
  const served = resolveServedModel(id, provenance, saprotEngine);
  const availability = lmAvailability(id, data);
  const ok = availability.state === "computed";

  const prefs: { aa: string; prob: number }[] = ok && Array.isArray(data.preferences)
    ? data.preferences
        .filter((p: any) => p && typeof p.aa === "string" && finite(p.prob) !== null)
        .map((p: any) => ({ aa: p.aa.toUpperCase(), prob: p.prob }))
        .sort((a: any, b: any) => b.prob - a.prob)
    : [];

  const wtProb = ok ? finite(data.wtProbability) : null;
  const mutProb = ok ? finite(data.mutProbability) : null;
  const rank = ok ? validRank(data.mutRank) : null;
  const band = rankBand(rank);
  const entropyRaw = ok ? finite(data.positionalEntropy) : null;
  // 0 bits with a spread distribution is the producers' old default, not a measurement.
  const entropy = entropyRaw !== null && !(entropyRaw === 0 && prefs.length > 1 && prefs[0].prob < 0.999) ? entropyRaw : null;

  const window = ok && Array.isArray(data.localShiftMap)
    ? data.localShiftMap.filter((d: any) => finite(d?.shift) !== null && finite(d?.position) !== null)
    : [];
  const atSite = window.length > 0 ? finite(data.embeddingShift) : null;

  const token = ok && typeof data.conformationState === "string" && data.conformationState.trim() ? data.conformationState.trim() : null;

  const caveats: LmCaveat[] = [];
  if (ok && served.fallback) caveats.push("fallback-model");
  if (ok && served.inferred) caveats.push("inferred-model");
  if (ok && id === "saprot" && !served.fallback && token === "#") caveats.push("sequence-only");
  if (ok && mutProb !== null && mutProb <= 1.1e-9) caveats.push("probability-floor");

  const diagnostics: { tier: string; text: string }[] = [];
  const remoteNote = typeof data?.remoteEngineNote === "string" && data.remoteEngineNote.trim()
    ? data.remoteEngineNote.trim()
    : typeof data?.hfError === "string" && data.hfError.trim() ? data.hfError.trim() : null;
  const fallbackReason = typeof data?.fallbackReason === "string" && data.fallbackReason.trim() ? data.fallbackReason.trim() : null;
  if (remoteNote) diagnostics.push({ tier: "Remote engine", text: remoteNote });
  if (fallbackReason) diagnostics.push({ tier: id === "saprot" ? "Local SaProt candidates" : "Local engine", text: fallbackReason });

  return {
    id,
    family: meta.familyLabel,
    servedBy: provenance,
    served,
    calibration: served.calibration,
    availability,
    llr: ok ? finite(data.llr) : null,
    wtProb,
    mutProb,
    retention: wtProb !== null && mutProb !== null && wtProb > 0 ? mutProb / wtProb : null,
    rank,
    band,
    bandLabel: band ? RANK_BANDS.find(b => b.band === band)!.label : null,
    rankSentence: ok ? describeWithinModelRank(rank, entropy) : "",
    entropy,
    preferences: prefs,
    embedding: {
      atSite,
      window,
      metric: "Euclidean distance",
      dim: served.inferred ? null : (served.calibration?.embeddingDim ?? null),
      absentReason: ok ? embeddingAbsentReason(data, window.length > 0) : null
    },
    structureToken: id === "saprot" && !served.fallback ? token : null,
    caveats,
    diagnostics,
    fallbackReason,
    votes
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Physical terms (FoldX, rigid backbone)
// ─────────────────────────────────────────────────────────────────────────────

function absent(reason: string): ReadingAvailability {
  return { state: "absent", label: ENGINE_STATE_LABELS["no-result"], reason, action: null };
}

function buildPhysical(fe: any, diff: any, metrics: any, isFolding: boolean): PerturbationEvidence["physical"] {
  const hasFe = Boolean(fe) && (finite(fe.vdw) !== null || finite(fe.electrostatics) !== null);
  const rigid = Boolean(diff) && finite(diff.rmsd) === 0;
  const raw = Array.isArray(fe?.rawDdGs) ? fe.rawDdGs.filter((v: unknown) => finite(v) !== null) : [];
  const runs = raw.length > 0 ? raw.length : finite(fe?.structureProvenance?.foldxRuns);
  const sd = finite(fe?.foldxSd);
  const runsIdentical = (runs ?? 0) > 1 && sd !== null && sd < 0.001;

  if (!hasFe && !diff && !metrics) {
    return {
      available: false,
      rigidBackbone: false,
      runs: null,
      runsIdentical: false,
      readings: [],
      reason: isFolding
        ? "FoldX is still modelling the mutant."
        : fe?.foldxBinaryMissing
          ? "FoldX is not installed on this server."
          : fe?.foldxRepairFailed
            ? "FoldX could not repair the template, so no mutant model was built."
            : "No FoldX mutant model was built for this variant."
    };
  }

  const vdw = finite(fe?.vdw);
  const clashMark = THRESHOLDS.vdwClash.significantClash;
  const elec = finite(fe?.electrostatics);
  const nRmsd = finite(fe?.localSidechainRmsd);
  const clash = finite(diff?.clashes?.diff);
  const disps: number[] = Array.isArray(diff?.windowDisplacements)
    ? diff.windowDisplacements.map((d: any) => finite(d?.displacement)).filter((v: number | null): v is number => v !== null)
    : [];
  const caMax = disps.length > 0 ? Math.max(...disps) : null;
  const lost = finite(metrics?.lostContacts);
  const gained = finite(metrics?.gainedContacts);
  const dSasa = finite(metrics?.deltaSasa);

  const pending = isFolding ? { state: "pending" as const, label: ENGINE_STATE_LABELS.running, reason: null, action: null } : null;

  const readings: PhysicalReading[] = [
    {
      key: "vdw",
      name: "Van der Waals clash term",
      description: "FoldX Van der Waals clash energy, mutant − wild type. One component of ΔΔG.",
      value: vdw,
      text: vdw !== null ? signed(vdw, 2) : "—",
      unit: "kcal/mol",
      scale: { min: -1, max: Math.max(4, vdw !== null ? Math.ceil(vdw + 0.5) : 4) },
      marks: [{ value: clashMark, label: `${clashMark.toFixed(1)} kcal/mol · local clash mark` }],
      markKind: "local",
      call: vdw === null ? null : vdw > clashMark
        ? { label: "Above clash mark", tone: "warning" }
        : { label: "Below clash mark", tone: "neutral" },
      note: runs ? `Mean of ${runs} BuildModel run${runs === 1 ? "" : "s"}` : null,
      availability: vdw !== null ? computed() : pending ?? absent("FoldX returned no energy terms.")
    },
    {
      key: "elec",
      name: "Electrostatics term",
      description: "FoldX electrostatic energy, mutant − wild type. One component of ΔΔG.",
      value: elec,
      text: elec !== null ? signed(elec, 2) : "—",
      unit: "kcal/mol",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: null,
      availability: elec !== null ? computed() : pending ?? absent("FoldX returned no energy terms.")
    },
    {
      key: "neighbour-rmsd",
      name: "Neighbour side-chain RMSD",
      description: `Side-chain heavy atoms of residues within ±${LOCAL_STRUCTURAL_WINDOW} of the site after local backbone superposition — how far FoldX repacked the neighbours.`,
      value: nRmsd,
      text: nRmsd !== null ? nRmsd.toFixed(2) : "—",
      unit: "Å",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: null,
      availability: nRmsd !== null ? computed() : pending ?? absent("Not measured for this model.")
    },
    {
      key: "clash",
      name: "Atomic clash count",
      description: "Heavy-atom clashes in the mutant model minus the wild type.",
      value: clash,
      text: clash !== null ? (clash > 0 ? `+${clash}` : String(clash)) : "—",
      unit: null,
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: diff?.clashes ? `${diff.clashes.wtClashCount} → ${diff.clashes.mutClashCount}` : null,
      availability: clash !== null ? computed() : pending ?? absent("No structural comparison was run.")
    },
    {
      key: "ca-max",
      name: "Max Cα displacement",
      description: `Largest Cα shift within ±${LOCAL_STRUCTURAL_WINDOW} residues after superposition.`,
      value: rigid ? null : caMax,
      text: !rigid && caMax !== null ? caMax.toFixed(2) : "—",
      unit: "Å",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: null,
      availability: rigid
        ? { state: "absent", label: "Not measured", reason: "FoldX builds the mutant on the wild-type backbone, so Cα positions are identical by construction. A zero here would describe the method, not the protein.", action: null }
        : caMax !== null ? computed() : pending ?? absent("No structural comparison was run.")
    },
    {
      key: "contacts",
      name: "Residue contacts",
      description: "Residues with a heavy atom within 4 Å of the site (±1 neighbours excluded), lost / gained.",
      value: lost !== null && gained !== null ? gained - lost : null,
      text: lost !== null && gained !== null ? `−${lost} / +${gained}` : "—",
      unit: null,
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: lost !== null && gained !== null ? `Net ${gained - lost > 0 ? "+" : gained - lost < 0 ? "−" : ""}${Math.abs(gained - lost)}` : null,
      availability: lost !== null && gained !== null ? computed() : pending ?? absent("No contact comparison was run.")
    },
    {
      key: "sasa",
      name: "Residue SASA change",
      description: "Absolute solvent-accessible area of the site residue, mutant − wild type. Tracks side-chain size as much as exposure.",
      value: dSasa,
      text: dSasa !== null ? signed(dSasa, 1) : "—",
      unit: "Å²",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      note: null,
      availability: dSasa !== null ? computed() : pending ?? absent("No surface-area comparison was run.")
    }
  ];

  return { available: true, rigidBackbone: rigid, runs: runs ?? null, runsIdentical, readings, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// ESM3 (exploratory)
// ─────────────────────────────────────────────────────────────────────────────

function buildEsm3(e: any): Esm3Reading | null {
  if (!e) return null;
  if (e.error) {
    return {
      availability: { state: "failed", label: ENGINE_STATE_LABELS["upstream-error"], reason: String(e.error), action: "settings" },
      servedBy: null, fallback: false, drift: null, driftBand: null, driftResidue: null,
      templateConfidence: null, burial: null, secondaryStructure: null
    };
  }
  const scores: number[] = Array.isArray(e.perturbationScores) ? e.perturbationScores.filter((v: unknown) => finite(v) !== null) : [];
  const drift = scores.length ? Math.max(...scores) : null;
  const t = THRESHOLDS.esm3Drift;
  const driftBand = drift === null ? null : drift < t.none ? "none" : drift < t.minor ? "minor" : drift < t.moderate ? "moderate" : "major";
  const envs: string[] = Array.isArray(e.microenvironments) ? e.microenvironments : [];
  const ss = envs.find(x => /helix|sheet|loop/i.test(x)) ?? null;
  const burialRaw = envs.find(x => !/helix|sheet|loop/i.test(x)) ?? null;
  const provenance = typeof e.provenance === "string" ? e.provenance : null;
  return {
    availability: drift !== null ? computed() : absent("ESM3 returned no per-residue scores."),
    servedBy: provenance,
    fallback: Boolean(provenance && /vesm/i.test(provenance)),
    drift,
    driftBand,
    driftResidue: finite(e.maxDriftResidue),
    templateConfidence: finite(e.confidence?.plddt),
    burial: burialRaw && burialRaw !== UNMEASURED_BURIAL_ENVIRONMENT ? burialRaw : null,
    secondaryStructure: ss
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

/** The predictor-concordance keys these models travel under in the PP3/BP4 rule. */
const CONCORDANCE_KEY: Record<PerturbationModelId, string> = { saprot: "saprot", esm2: "esm2_3b", esmc: "vesm" };

export function buildPerturbationEvidence(input: PerturbationEvidenceInput): PerturbationEvidence {
  const r = input.result ?? {};
  const pos = finite(r?.metadata?.residueIndex);

  // Whether a model votes is the engine's decision; read it from the engine's own concordance.
  let voteByKey = new Map<string, boolean>();
  try {
    const pe = buildPredictorEvidence({ result: r });
    voteByKey = new Map(pe.readings.map(x => [x.key, x.votes]));
  } catch {
    /* A payload too sparse for the predictor model: treat as not counted (the engine's default). */
  }

  const dataFor: Record<PerturbationModelId, any> = { saprot: r.saprotEval, esm2: r.esm2Eval, esmc: r.esmcEval };
  const lms = (["saprot", "esm2", "esmc"] as PerturbationModelId[]).map(id =>
    buildLm(id, dataFor[id], input.saprotEngine, input.residues, voteByKey.get(CONCORDANCE_KEY[id]) ?? false)
  );
  const scored = lms.filter(l => l.availability.state === "computed");

  const families = Array.from(new Set(scored.map(l => l.calibration?.family).filter((f): f is NonNullable<typeof f> => Boolean(f))));
  const llrs = scored.map(l => l.llr).filter((v): v is number => v !== null);

  const ranked = scored.filter(l => l.band !== null);
  const nLeast = ranked.filter(l => l.band === "least").length;
  const nLower = ranked.filter(l => l.band === "lower").length;
  const bands = new Set(ranked.map(l => l.band));

  return {
    residues: { ...input.residues, position: pos },
    lms,
    scored,
    scale: {
      families,
      mixed: families.length > 1,
      llrMin: llrs.length ? Math.min(...llrs) : null,
      llrMax: llrs.length ? Math.max(...llrs) : null
    },
    consensus: {
      nRanked: ranked.length,
      nLeast,
      nLower,
      nUpperOrMost: ranked.length - nLeast - nLower,
      agree: ranked.length > 0 && bands.size === 1,
      band: bands.size === 1 ? (ranked[0]?.band ?? null) : null
    },
    physical: buildPhysical(input.foldingEnergetics, input.structuralDiff, input.metrics, Boolean(input.isFolding)),
    esm3: buildEsm3(r.esm3Eval),
    engine: {
      informational: lms.every(l => !l.votes),
      counted: lms.filter(l => l.votes).map(l => l.family)
    },
    pending: lms.some(l => l.availability.state === "pending") || Boolean(input.isFolding)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding
// ─────────────────────────────────────────────────────────────────────────────

const BAND_PHRASE: Record<RankBand, string> = {
  least: "among the three least-preferred residues",
  lower: "in the dispreferred half",
  upper: "in the upper half of preferences",
  most: "among the three most-preferred residues"
};

export function perturbationFinding(ev: PerturbationEvidence): { headline: string; predicate: string } {
  const { mutLabel, wtLabel } = ev.residues;
  const mut = mutLabel || "The variant residue";
  const wt = wtLabel || "the native residue";
  const c = ev.consensus;

  let headline: string;
  if (ev.scored.length === 0) {
    headline = ev.pending ? "The language models are still running" : "No language model scored this substitution";
  } else if (c.nRanked === 0) {
    headline = `${ev.scored.length} language model${ev.scored.length === 1 ? "" : "s"} scored ${mut}, but none returned a residue rank`;
  } else if (c.agree && c.band) {
    headline = `${c.nRanked === 1 ? "One model places" : c.nRanked === 2 ? "Both models place" : `All ${c.nRanked} models place`} ${mut} ${BAND_PHRASE[c.band]} at this position`;
  } else {
    headline = `The models disagree on ${mut}: ${c.nLeast + c.nLower} of ${c.nRanked} rank it in the dispreferred half`;
  }

  const parts: string[] = [];
  if (ev.scale.llrMin !== null && ev.scale.llrMax !== null) {
    const lo = ev.scale.llrMin, hi = ev.scale.llrMax;
    const range = lo === hi ? `${signed(lo, 2)} nats` : `${signed(lo, 1)} to ${signed(hi, 1)} nats`;
    parts.push(
      hi < 0
        ? `each scores it below native ${wt} (ΔLLR ${range}, each on its own model's scale)`
        : `ΔLLR ${range}, each on its own model's scale`
    );
  }
  const vdw = ev.physical.readings.find(x => x.key === "vdw");
  if (vdw?.value != null) {
    parts.push(
      vdw.value > THRESHOLDS.vdwClash.significantClash
        ? `FoldX places the substitution above the local clash mark (VdW ${vdw.text} kcal/mol)`
        : `FoldX finds no clash above the local mark (VdW ${vdw.text} kcal/mol)`
    );
  }
  const predicate = parts.length
    ? `${parts.join("; ")}. Neither is calibrated pathogenicity evidence`
    : "These scores are context for curation, not calibrated pathogenicity evidence";
  return { headline, predicate };
}
