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
 *
 * DEFECTS THIS REPLACED (2026-10 audit, doc/PERTURBATION_REVIEW.md, SLC12A4 p.Gln867His)
 *   • The hero led with rank bands: "0 of 3 models rank His in the dispreferred half" and "The
 *     models disagree". ESM-2 and ESMC both gave native Gln nearly all their probability (ΔLLR −5.95
 *     and −6.98: Gln ~380× and ~1,075× as likely as His), so "upper half" and "most preferred" read
 *     the substitution the wrong way round. A rank orders what is left after the native residue; on
 *     its own it says nothing about how strongly the model expects the native. The cross-model
 *     statement is now the DIRECTION each model reads (the sign of its own ΔLLR, beyond an even-odds
 *     mark), stated per model with its own odds — never pooled.
 *   • A near-uniform distribution (SaProt, sequence-only, 4.23 of 4.32 bits) was read as a rank like
 *     any other. It is now `flat`: no preference to read, outside the direction count.
 *   • "Disagree" fired whenever two models fell in different rank bands, including two that agreed.
 *   • A FoldX run that failed read "No FoldX mutant model was built": the pipeline's
 *     `foldingStatus`/`foldingError` never reached the tab.
 *   • ESM3 "drift at sequence index 4" for a variant at residue 867: the peak was printed with no
 *     distance to the variant and no value AT the variant.
 */
import { embeddingSource } from "./embeddingSource";

import { ENGINE_STATE_LABELS } from "./engineStatus";
import { THRESHOLDS, LOCAL_STRUCTURAL_WINDOW, STRUCTURE_COLOUR_BANDS } from "./thresholds/constants";
import { UNMEASURED_BURIAL_ENVIRONMENT } from "./burialEvidence";
import {
  ENTROPY_MARKS,
  EVEN_ODDS_LLR,
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

export type LmCaveat = "fallback-model" | "sequence-only" | "probability-floor" | "inferred-model" | "flat";

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
  },
  flat: {
    label: "Flat distribution",
    detail: "The model spreads its probability almost evenly over the 20 residues here (entropy at or above 95% of the maximum), so it expresses no preference at this site and its rank is not read."
  }
};

/**
 * What one model's own output says about the substitution, in words a non-specialist can act on.
 *   favours-native   ΔLLR ≤ −ln 2: the model rates the native residue at least twice as likely
 *   favours-variant  ΔLLR ≥ +ln 2
 *   even             within a factor of two either way
 *   flat             the distribution is near-uniform, so there is no preference to read
 * The ln 2 and flat marks are app-defined reading aids (EVEN_ODDS_LLR, ENTROPY_MARKS.flat).
 */
export type LmDirection = "favours-native" | "favours-variant" | "even" | "flat";

export interface LmReading {
  id: PerturbationModelId;
  /** Family label for the table row ("SaProt"). */
  family: string;
  /**
   * The model that produced the numbers: the family, or the stand-in's own name ("VESM-150M") when
   * another model served the card. Sentences that attribute a reading use this, never `family`.
   */
  name: string;
  /** What the model reads, in one plain line. */
  description: string;
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
  /** exp(−ΔLLR): how many times as likely the model rates the native residue as the variant. */
  odds: number | null;
  direction: LmDirection | null;
  /** Rank of the native residue in the same distribution (1 = the model's top residue). */
  nativeRank: number | null;
  /** Served-model text for tight spaces ("SaProt_35M_AF2 · Remote"). */
  servedShort: string;
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
  /** The remote provider's refusal, as a code from the engine ("billing", "auth", …). */
  remoteFailure: { provider: string; code: RemoteFailureCode } | null;
  /** That refusal in one plain clause ("Hugging Face has no inference credits left on the saved token"). */
  serviceNote: string | null;
  /** How the site was scored ("masked-marginal"); null on results from before it was recorded. */
  scoringMethod: string | null;
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
  /** One entry per residue; null where the engine measured nothing (never 0). */
  perPosition: Array<{ position: number; value: number | null }>;
  /** Residues with a measurement, of the residues the engine was asked about; null with no scores. */
  coverage: { measured: number; total: number } | null;
  availability: ReadingAvailability;
  servedBy: string | null;
  label: string;
  knowledgeKey: string;
  fallback: boolean;
  drift: number | null;
  driftBand: "none" | "minor" | "moderate" | "major" | null;
  driftResidue: number | null;
  /** The drift AT the variant residue, when the score array covers it. */
  siteDrift: number | null;
  /** Residues between the drift peak and the variant (0 = the peak is the variant). */
  peakDistance: number | null;
  /** AlphaFold DB band for the input confidence ("Confident"); published (Jumper 2021). */
  confidenceBand: string | null;
  templateConfidence: number | null;
  burial: string | null;
  secondaryStructure: string | null;
  /** Present when the local fallback served this result; explains why the remote ESM3 tier did not answer. */
  remoteEngineNote: string | null;
  /** That refusal in one plain clause, from the engine's code ("Biohub refused the saved token"). */
  serviceNote: string | null;
}

export interface PerturbationEvidence {
  residues: { wtCode: string; mutCode: string; wtLabel: string; mutLabel: string; position: number | null };
  lms: LmReading[];
  scored: LmReading[];
  /** Families that contributed, and whether they share a scale (they never do across families). */
  scale: { families: string[]; mixed: boolean; llrMin: number | null; llrMax: number | null };
  /**
   * The cross-model statement: how many models read the substitution in each direction, each from
   * its own output. Flat models are counted apart — they have no direction.
   */
  direction: { nScored: number; nFavourNative: number; nFavourVariant: number; nEven: number; nFlat: number };
  /** Rank-band agreement among the non-flat models (rail context only; the hero reads `direction`). */
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
    /** How the mutant model was built, in one line, when the caller recorded it. */
    method: string | null;
    /**
     * pLDDT of the analysed AlphaFold model at the site, with its AlphaFold DB band: geometry built on
     * a low-confidence region describes the model more than the protein. Null for experimental structures.
     */
    inputConfidence: { plddt: number; band: string | null } | null;
    /** Heavy-atom clash counts in each model, for a paired figure; null without a structural comparison. */
    clashCounts: { wt: number; mut: number } | null;
    /** Site contacts the substitution loses and gains; null without a contact comparison. */
    contactChange: { lost: number; gained: number } | null;
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
  /** The FoldX leg's settled state and error, so a failed run is not reported as "not built". */
  foldingStatus?: "success" | "failed" | "unavailable" | null;
  foldingError?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

/** "384×", "1,075×", "1.4×" — odds the way a reader says them. */
export function oddsText(odds: number): string {
  return odds >= 10 ? `${Math.round(odds).toLocaleString("en-GB")}×` : `${odds.toFixed(1)}×`;
}

function shortServed(provenance: string | null, inferred: boolean): string {
  if (!provenance) return inferred ? "model not named" : "";
  const outer = provenance.replace(/\([^)]*\)/g, "").trim();
  const inner = provenance.match(/\(([^)]+)\)/)?.[1] ?? "";
  // "SaProt (SaProt_35M_AF2 - Remote)" → "SaProt_35M_AF2 · Remote"; "ESMC-6B (Remote)" → "ESMC-6B · Remote".
  const parts = inner.split(/\s+-\s+/).filter(Boolean);
  // Keep the outer name unless the parentheses already name the model (a checkpoint id).
  const innerNamesModel = parts.some(x => /_|esm|saprot|vesm/i.test(x));
  return (innerNamesModel ? parts : [outer, ...parts]).filter(Boolean).join(" · ");
}

export type RemoteFailureCode = "billing" | "auth" | "region" | "rate-limit" | "timeout" | "invalid-response" | "unavailable";

const PROVIDER_LABELS: Record<string, string> = { huggingface: "Hugging Face", biohub: "Biohub" };

const SERVICE_NOTES: Record<RemoteFailureCode, (provider: string) => string> = {
  billing: p => `${p} has no inference credits left on the saved token`,
  auth: p => `${p} refused the saved token`,
  region: p => `${p} is not available from this server's region`,
  "rate-limit": p => `${p} is limiting requests and may answer on a later run`,
  timeout: p => `${p} did not answer in time`,
  "invalid-response": p => `${p} returned an incomplete residue distribution, which is not scored`,
  unavailable: p => `${p} did not answer`
};

function readRemoteFailure(raw: any): LmReading["remoteFailure"] {
  return typeof raw?.provider === "string" && raw.code in SERVICE_NOTES ? { provider: raw.provider, code: raw.code } : null;
}

const computed = (): ReadingAvailability => ({ state: "computed", label: ENGINE_STATE_LABELS.computed, reason: null, action: null });

function lmAvailability(id: PerturbationModelId, data: any): ReadingAvailability {
  if (!data) {
    return { state: "absent", label: ENGINE_STATE_LABELS["no-result"], reason: "This analysis returned no evaluation for this model.", action: "retry" };
  }
  if (data.loading) {
    return { state: "pending", label: ENGINE_STATE_LABELS.running, reason: null, action: null };
  }
  if (data.error) {
    // The adapters set `status` ("timeout", "offline", "unauthorized", …) at the call that failed; the
    // error text is for people and is kept in Engine notes.
    const timeout = data.status === "timeout";
    const warming = data.status === "warming_up" || data.status === "offline";
    const noKey = data.status === "unauthorized" || data.remoteFailure?.code === "auth";
    return {
      state: "failed",
      label: warming ? ENGINE_STATE_LABELS["upstream-busy"] : timeout ? ENGINE_STATE_LABELS.failed : ENGINE_STATE_LABELS["upstream-error"],
      reason: warming
        ? "The model server did not answer. It may still be starting or may be offline."
        : timeout
          ? id === "saprot"
            ? "SaProt timed out. The 35M checkpoint answers in seconds on CPU."
            : "The model timed out."
          : noKey
            ? "The provider refused the request — check the access token in Settings."
            : "The model returned no result for this variant. Engine notes record the error.",
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
  if (typeof data?.embeddingNote === "string" && data.embeddingNote.trim()) return data.embeddingNote.trim();
  const p = typeof data?.provenance === "string" ? data.provenance : "";
  return /remote|cloud|serverless|hf/i.test(p)
    ? "The remote engine scores through a masked-token API that returns no per-residue embeddings; the local engine returns the ±10-residue window."
    : "This model returned no per-residue shift window for this position.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Language models
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The rank sentence, qualified by what a rank cannot say on its own: on a flat distribution it
 * orders near-equal values, and when the native residue holds most of the probability it orders
 * the leftovers.
 */
function rankSentence(
  rank: number | null,
  entropy: number | null,
  flat: boolean,
  wtProb: number | null,
  nativeRank: number | null,
  wtLabel: string
): string {
  const wt = wtLabel || "the native residue";
  if (flat && entropy !== null) {
    return `This model spreads its probability almost evenly across the 20 residues here (${entropy.toFixed(2)} of ${ENTROPY_MARKS.ceiling.toFixed(2)} bits), so it expresses no preference at this site. Its rank${rank !== null ? ` (${rank} of 20)` : ""} orders near-equal values and is not read.`;
  }
  const base = describeWithinModelRank(rank, entropy);
  if (wtProb !== null && wtProb >= 0.5 && nativeRank === 1) {
    return `${base} ${wt} itself takes ${(wtProb * 100).toFixed(0)}% of the model's probability here, so this rank orders residues the model gives little weight to — read the odds against ${wt}, not the rank.`;
  }
  return base;
}

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
  const atSite = ok ? finite(data.embeddingShift) : null;

  const token = ok && typeof data.conformationState === "string" && data.conformationState.trim() ? data.conformationState.trim() : null;

  const llr = ok ? finite(data.llr) : null;
  const flat = entropy !== null && entropy >= ENTROPY_MARKS.flat;
  const direction: LmDirection | null =
    llr === null ? null : flat ? "flat" : llr <= -EVEN_ODDS_LLR ? "favours-native" : llr >= EVEN_ODDS_LLR ? "favours-variant" : "even";
  const nativeIdx = prefs.findIndex(p => p.aa === residues.wtCode);
  const nativeRank = nativeIdx >= 0 ? nativeIdx + 1 : null;

  const caveats: LmCaveat[] = [];
  if (ok && served.fallback) caveats.push("fallback-model");
  if (ok && served.inferred) caveats.push("inferred-model");
  if (ok && id === "saprot" && !served.fallback && token === "#") caveats.push("sequence-only");
  if (ok && mutProb !== null && mutProb <= 1.1e-9) caveats.push("probability-floor");
  if (flat) caveats.push("flat");

  const diagnostics: { tier: string; text: string }[] = [];
  const remoteNote = typeof data?.remoteEngineNote === "string" && data.remoteEngineNote.trim()
    ? data.remoteEngineNote.trim()
    : typeof data?.hfError === "string" && data.hfError.trim() ? data.hfError.trim() : null;
  const fallbackReason = typeof data?.fallbackReason === "string" && data.fallbackReason.trim() ? data.fallbackReason.trim() : null;
  if (remoteNote) diagnostics.push({ tier: "Remote engine", text: remoteNote });
  if (fallbackReason) diagnostics.push({ tier: id === "saprot" ? "Local SaProt candidates" : "Local engine", text: fallbackReason });
  if (availability.state === "failed" && data?.error) diagnostics.push({ tier: "Engine error", text: String(data.error) });
  const remoteFailure = readRemoteFailure(data?.remoteFailure);

  return {
    id,
    family: meta.familyLabel,
    name: served.fallback && served.calibration ? served.calibration.label : meta.familyLabel,
    description: meta.description,
    servedBy: provenance,
    served,
    calibration: served.calibration,
    availability,
    llr,
    wtProb,
    mutProb,
    retention: wtProb !== null && mutProb !== null && wtProb > 0 ? mutProb / wtProb : null,
    odds: llr !== null ? Math.exp(-llr) : null,
    direction,
    nativeRank,
    servedShort: shortServed(provenance, served.inferred),
    rank,
    band,
    bandLabel: band ? RANK_BANDS.find(b => b.band === band)!.label : null,
    rankSentence: ok ? rankSentence(rank, entropy, flat, wtProb, nativeRank, residues.wtLabel) : "",
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
    remoteFailure,
    serviceNote: remoteFailure ? SERVICE_NOTES[remoteFailure.code](PROVIDER_LABELS[remoteFailure.provider] ?? remoteFailure.provider) : null,
    scoringMethod: ok && typeof data.scoringMethod === "string" ? data.scoringMethod : null,
    votes
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Physical terms (FoldX, rigid backbone)
// ─────────────────────────────────────────────────────────────────────────────

function absent(reason: string): ReadingAvailability {
  return { state: "absent", label: ENGINE_STATE_LABELS["no-result"], reason, action: null };
}

/** Why there is no FoldX model, resolved in the order the Energetics engine outcome uses. */
function foldxAbsenceReason(fe: any, isFolding: boolean, status?: string | null, error?: string | null): string {
  if (isFolding) return "FoldX is still modelling the mutant.";
  if (fe?.foldxBinaryMissing) return "FoldX is not installed on this server.";
  if (fe?.foldxRepairFailed) return "FoldX could not repair the template structure, so no mutant model was built.";
  if (status === "failed" || error) return `The FoldX run failed${error ? `: ${String(error).trim().replace(/\.$/, "")}` : ""}.`;
  if (status === "unavailable") return "FoldX is not configured on this deployment.";
  return "No FoldX mutant model was built for this variant.";
}

function buildPhysical(
  fe: any,
  diff: any,
  metrics: any,
  isFolding: boolean,
  foldingStatus?: string | null,
  foldingError?: string | null,
  site?: any
): PerturbationEvidence["physical"] {
  const hasFe = Boolean(fe) && (finite(fe.vdw) !== null || finite(fe.electrostatics) !== null);
  // Stated by the caller that built the pair; a zero RMSD is the fallback for snapshots that predate it.
  const buildModel = diff?.mutantModel === "foldx-buildmodel";
  const rigid = buildModel || (Boolean(diff) && finite(diff.rmsd) === 0);
  const method = buildModel
    ? "FoldX BuildModel: the wild-type backbone is kept and side chains near the site are repacked"
    : rigid
      ? "Backbone positions identical in both models (RMSD 0); how the mutant was built was not recorded"
      : null;
  const sitePlddt = site?.bFactorKind === "plddt" ? finite(site?.plddt) : null;
  const inputConfidence = sitePlddt !== null ? { plddt: sitePlddt, band: plddtBand(sitePlddt) } : null;
  const raw = Array.isArray(fe?.rawDdGs) ? fe.rawDdGs.filter((v: unknown) => finite(v) !== null) : [];
  const runs = raw.length > 0 ? raw.length : finite(fe?.structureProvenance?.foldxRuns);
  const sd = finite(fe?.foldxSd);
  const runsIdentical = (runs ?? 0) > 1 && sd !== null && sd < 0.001;

  if (!hasFe && !diff && !metrics) {
    return {
      available: false,
      rigidBackbone: false,
      method: null,
      inputConfidence,
      clashCounts: null,
      contactChange: null,
      runs: null,
      runsIdentical: false,
      readings: [],
      reason: foldxAbsenceReason(fe, isFolding, foldingStatus, foldingError)
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
      description: `Side-chain heavy atoms of residues within ±${LOCAL_STRUCTURAL_WINDOW} of the site after local backbone superposition — how differently the neighbours pack in the variant model.`,
      value: nRmsd,
      text: nRmsd !== null ? nRmsd.toFixed(2) : "—",
      unit: "Å",
      scale: null,
      marks: [],
      markKind: "none",
      call: null,
      // The run's own wild type isolates the substitution; the input template also carries RepairPDB's moves.
      note:
        nRmsd === null
          ? null
          : fe?.localSidechainRmsdReference === "foldx-paired"
            ? "Against FoldX's paired wild type from the same run"
            : "Against the template before RepairPDB, so the repair's side-chain moves are included",
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

  const wtClashes = finite(diff?.clashes?.wtClashCount);
  const mutClashes = finite(diff?.clashes?.mutClashCount);
  return { available: true, rigidBackbone: rigid, method, inputConfidence,
    clashCounts: wtClashes !== null && mutClashes !== null ? { wt: wtClashes, mut: mutClashes } : null,
    contactChange: lost !== null && gained !== null ? { lost, gained } : null,
    runs: runs ?? null, runsIdentical, readings, reason: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// ESM3 (exploratory)
// ─────────────────────────────────────────────────────────────────────────────

/** AlphaFold DB's published band for a pLDDT value (exclusive lower edges, as Mol* draws them). */
function plddtBand(v: number | null): string | null {
  if (v === null) return null;
  return STRUCTURE_COLOUR_BANDS.plddt.find(b => v > b.min)?.label ?? null;
}

function buildEsm3(e: any, position: number | null): Esm3Reading | null {
  if (!e) return null;
  const source = embeddingSource(e.provenance);
  const remoteFailure = readRemoteFailure(e.remoteFailure);
  const identity = {
    servedBy: source.recorded, label: source.label, knowledgeKey: source.topic, fallback: source.fallback,
    serviceNote: remoteFailure ? SERVICE_NOTES[remoteFailure.code](PROVIDER_LABELS[remoteFailure.provider] ?? remoteFailure.provider) : null
  };
  const remoteEngineNote = typeof e.remoteEngineNote === "string" && e.remoteEngineNote.trim() ? e.remoteEngineNote.trim() : null;
  if (e.error) {
    return {
      availability: { state: "failed", label: ENGINE_STATE_LABELS["upstream-error"], reason: "The embedding engine returned no per-residue scores for this variant. Engine notes record the error.", action: "settings" },
      ...identity, perPosition: [], coverage: null, drift: null, driftBand: null, driftResidue: null,
      siteDrift: null, peakDistance: null, confidenceBand: null,
      templateConfidence: null, burial: null, secondaryStructure: null,
      remoteEngineNote: remoteEngineNote ?? String(e.error)
    };
  }
  // One score per residue, index i ↔ residue i + 1 (the route rejects a length mismatch). The VESM
  // fallback writes −1 outside its window: a sentinel, not a distance.
  const raw: unknown[] = Array.isArray(e.perturbationScores) ? e.perturbationScores : [];
  const perPosition = raw.map((v, index) => {
    const value = finite(v);
    return { position: index + 1, value: value !== null && value >= 0 ? value : null };
  });
  const scores = perPosition.map(p => p.value).filter((v): v is number => v !== null);
  const drift = scores.length ? Math.max(...scores) : null;
  const atSite = position !== null && position >= 1 && position <= raw.length ? finite(raw[position - 1]) : null;
  const driftResidue = finite(e.maxDriftResidue);
  const plddt = finite(e.confidence?.plddt);
  const t = THRESHOLDS.esm3Drift;
  const driftBand = drift === null ? null : drift < t.none ? "none" : drift < t.minor ? "minor" : drift < t.moderate ? "moderate" : "major";
  const envs: string[] = Array.isArray(e.microenvironments) ? e.microenvironments : [];
  const ss = envs.find(x => /helix|sheet|loop/i.test(x)) ?? null;
  const burialRaw = envs.find(x => !/helix|sheet|loop/i.test(x)) ?? null;
  return {
    availability: drift !== null ? computed() : absent(`${source.label}: no per-residue scores were returned.`),
    perPosition,
    coverage: perPosition.length ? { measured: perPosition.filter(p => p.value !== null).length, total: perPosition.length } : null,
    ...identity,
    drift,
    driftBand,
    driftResidue,
    siteDrift: atSite !== null && atSite >= 0 ? atSite : null,
    peakDistance: driftResidue !== null && position !== null ? Math.abs(driftResidue - position) : null,
    confidenceBand: plddtBand(plddt),
    templateConfidence: plddt,
    burial: burialRaw && burialRaw !== UNMEASURED_BURIAL_ENVIRONMENT ? burialRaw : null,
    secondaryStructure: ss,
    remoteEngineNote
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

/** The predictor-concordance keys these models travel under in the PP3/BP4 rule. */
const CONCORDANCE_KEY: Record<PerturbationModelId, string> = { saprot: "saprot", esm2: "esm2_3b", esmc: "vesm" };

/**
 * Deduplicates readings served by the exact same fallback checkpoint (e.g. VESM-150M serving both
 * ESM-2 and ESMC when remote tiers fail) so one checkpoint is counted once in cross-model direction,
 * rank agreement, and the headline finding.
 *
 * When `vesm150m` serves multiple cards, the ESMC / VESM card (`id === "esmc"`) is kept as the
 * representative because VESM-150M is its native local tier; `ev.lms` and `ev.scored` still retain
 * every card so per-card caveat callouts and rows render in full.
 */
function deduplicateServedModels(scored: LmReading[]): LmReading[] {
  const order: Record<PerturbationModelId, number> = { saprot: 0, esmc: 1, esm2: 2 };
  const sorted = [...scored].sort((a, b) => {
    const aFallback = a.served.fallback ? 1 : 0;
    const bFallback = b.served.fallback ? 1 : 0;
    if (aFallback !== bFallback) return aFallback - bFallback;
    return order[a.id] - order[b.id];
  });
  const seenKeys = new Set<string>();
  const keptIds = new Set<PerturbationModelId>();
  for (const item of sorted) {
    const key = item.served.registryKey;
    if (key && item.served.fallback) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    } else if (key) {
      seenKeys.add(key);
    }
    keptIds.add(item.id);
  }
  return scored.filter(item => keptIds.has(item.id));
}

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
  const distinctScored = deduplicateServedModels(scored);

  const families = Array.from(new Set(distinctScored.map(l => l.calibration?.family).filter((f): f is NonNullable<typeof f> => Boolean(f))));
  const llrs = distinctScored.map(l => l.llr).filter((v): v is number => v !== null);

  // A flat model has no preference to rank, so it stays out of the band agreement too.
  const ranked = distinctScored.filter(l => l.band !== null && l.direction !== "flat");
  const nLeast = ranked.filter(l => l.band === "least").length;
  const nLower = ranked.filter(l => l.band === "lower").length;
  const bands = new Set(ranked.map(l => l.band));

  return {
    residues: { ...input.residues, position: pos },
    lms,
    scored,
    direction: {
      nScored: distinctScored.length,
      nFavourNative: distinctScored.filter(l => l.direction === "favours-native").length,
      nFavourVariant: distinctScored.filter(l => l.direction === "favours-variant").length,
      nEven: distinctScored.filter(l => l.direction === "even").length,
      nFlat: distinctScored.filter(l => l.direction === "flat").length
    },
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
    physical: buildPhysical(
      input.foldingEnergetics,
      input.structuralDiff,
      input.metrics,
      Boolean(input.isFolding),
      input.foldingStatus,
      input.foldingError,
      r.disruptionPredictor
    ),
    esm3: buildEsm3(r.esm3Eval, pos),
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

/** "SaProt", "SaProt and ESM-2", "SaProt, ESM-2 and ESMC". */
export function listModels(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Gln 384× as likely as His in ESM-2" — one model's own odds, never pooled. */
function oddsClause(l: LmReading, wt: string, mut: string): string {
  if (l.odds === null) return `${l.name}: no ΔLLR`;
  if (l.direction === "favours-variant") return `${mut} ${oddsText(1 / l.odds)} as likely as ${wt} in ${l.name}`;
  if (l.direction === "even") return `${wt} and ${mut} within a factor of two in ${l.name}`;
  return `${wt} ${oddsText(l.odds)} as likely as ${mut} in ${l.name}`;
}

/**
 * The finding: which way each model reads the substitution, from its own output.
 *
 * The cross-model statement is a count of directions, which needs no shared scale. Magnitudes are
 * given per model as odds ("Gln 384× as likely as His in ESM-2") — the ΔLLR restated, never pooled.
 * A flat model is named as having no preference, not counted for either side.
 */
export function perturbationFinding(ev: PerturbationEvidence): { headline: string; predicate: string } {
  const mut = ev.residues.mutLabel || "the variant residue";
  const wt = ev.residues.wtLabel || "the native residue";
  const distinct = deduplicateServedModels(ev.scored);
  const by = (dir: LmDirection) => distinct.filter(l => l.direction === dir);
  const native = by("favours-native");
  const variant = by("favours-variant");
  const even = by("even");
  const flat = by("flat");
  const read = distinct.filter(l => l.direction !== null && l.direction !== "flat");

  let headline: string;
  if (distinct.length === 0) {
    headline = ev.pending ? "The language models are still running" : "No language model scored this substitution";
  } else if (read.length === 0) {
    headline = flat.length > 0
      ? `No model shows a preference at this site: ${flat.length === 1 ? `${flat[0].name}'s distribution is` : "every distribution is"} near-flat`
      : `${distinct.length} language model${distinct.length === 1 ? "" : "s"} answered without a ΔLLR`;
  } else if (native.length === read.length) {
    headline = `${listModels(native.map(l => l.name))} ${native.length === 1 ? "favours" : "favour"} native ${wt} over ${mut}`;
  } else if (variant.length === read.length) {
    headline = `${listModels(variant.map(l => l.name))} ${variant.length === 1 ? "rates" : "rate"} ${mut} at least as likely as native ${wt}`;
  } else if (even.length === read.length) {
    headline = `${listModels(even.map(l => l.name))} ${even.length === 1 ? "rates" : "rate"} ${wt} and ${mut} about equally`;
  } else {
    const parts: string[] = [];
    if (native.length) parts.push(`${listModels(native.map(l => l.name))} favour${native.length === 1 ? "s" : ""} ${wt}`);
    if (variant.length) parts.push(`${listModels(variant.map(l => l.name))} favour${variant.length === 1 ? "s" : ""} ${mut}`);
    if (even.length) parts.push(`${listModels(even.map(l => l.name))} ${even.length === 1 ? "is" : "are"} near even`);
    headline = `The models split: ${parts.join("; ")}`;
  }

  const parts: string[] = [];
  if (read.length) parts.push(`${read.map(l => oddsClause(l, wt, mut)).join(", ")} — each on its own model's scale`);
  if (flat.length && read.length) {
    parts.push(`${listModels(flat.map(l => l.name))} ${flat.length === 1 ? "spreads its" : "spread their"} probability almost evenly here, so ${flat.length === 1 ? "it has" : "they have"} no preference to read`);
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
    ? `${parts.join("; ")}. None of this is calibrated pathogenicity evidence`
    : "These scores are context for curation, not calibrated pathogenicity evidence";
  return { headline, predicate };
}
