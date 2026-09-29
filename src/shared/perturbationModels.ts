/**
 * perturbationModels.ts — Single source of truth for protein-language-model identity on
 * the Structural Perturbation tab.
 *
 * The tab and its inspector pane must agree about which model is selected, what it is
 * called, and what its score means. Previously the tab rebuilt its model array inline
 * while the inspector had no access to it at all, and the display name was derived twice
 * by different rules: the model card fell back to whatever `provenance` string the
 * backend returned, while the tab's own label was computed from `settings.saprotEngine`.
 * The two could therefore disagree about the same card.
 *
 * Everything identity-related now resolves here.
 */

import { MODEL_CALIBRATIONS, resolveModelCalibration, type ModelCalibration } from "./modelCalibration";

export type PerturbationModelId = "saprot" | "esm2" | "esmc";

/**
 * Static, result-independent description of each model. Latency and cold-start figures are
 * taken from the loading narrative the tab already showed, so they stay in one place.
 */
export interface PerturbationModelMeta {
  id: PerturbationModelId;
  /** Short family name, used where space is tight (evidence sentences). */
  familyLabel: string;
  /** Full display name as shown on the model card. */
  cardLabel: string;
  /** What the model is, in one line. */
  description: string;
  /** Settings key holding the credential this model needs. */
  tokenSettingKey: "hfToken" | "biohubApiToken";
  tokenName: string;
}

export const PERTURBATION_MODELS: PerturbationModelMeta[] = [
  {
    id: "saprot",
    familyLabel: "SaProt",
    cardLabel: "SaProt 650M AF2",
    description: "Structure-aware residue and conformation predictor",
    tokenSettingKey: "hfToken",
    tokenName: "Hugging Face Access Token"
  },
  {
    id: "esm2",
    familyLabel: "ESM-2",
    cardLabel: "ESM-2 650M",
    description: "Evolutionary-scale masked language model",
    tokenSettingKey: "hfToken",
    tokenName: "Hugging Face Access Token"
  },
  {
    id: "esmc",
    familyLabel: "ESMC",
    cardLabel: "ESMC 6B / VESM-150M",
    description: "Evolutionary-scale foundation model",
    tokenSettingKey: "biohubApiToken",
    tokenName: "Biohub API Token"
  }
];

/** SaProt's display name depends on which engine served the result, not on the card. */
export function resolveSaprotCardLabel(saprotEngine?: string | null): string {
  if (saprotEngine === "saprot-35m") return "SaProt 35M AF2";
  if (saprotEngine === "remote-hf") return "SaProt (Remote HF)";
  return "SaProt 650M AF2";
}

/**
 * Resolves the display name for a model, preferring what the backend actually reported
 * so the card cannot claim one engine while the numbers came from another.
 */
export function resolveModelDisplayName(
  id: PerturbationModelId,
  options?: { saprotEngine?: string | null; provenance?: string | null }
): string {
  const staticLabel = id === "saprot"
    ? resolveSaprotCardLabel(options?.saprotEngine)
    : PERTURBATION_MODELS.find(m => m.id === id)!.cardLabel;

  const provenance = options?.provenance;
  return provenance && provenance.trim().length > 0 ? provenance : staticLabel;
}

/**
 * True when the reported provenance names a model other than the one the card's
 * calibration row describes.
 *
 * The ESMC card is served by ESMC-6B or by a VESM-150M CPU fallback, and the ESM-2 and
 * SaProt cards have similar fallbacks. When that happens the row's embedding width and
 * calibration note belong to a model that did not produce the number, so the width must
 * be reported as unknown rather than asserted.
 */
export function hasAmbiguousProvenance(calibration: ModelCalibration | null | undefined, provenance?: string | null): boolean {
  if (!calibration || !provenance) return false;
  const p = provenance.toLowerCase();
  const FAMILY_SIGNATURES: Record<string, string[]> = {
    esm1b: ["esm-1b", "esm1b"],
    esm2: ["esm-2", "esm2"],
    esmc: ["esmc"],
    saprot: ["saprot"],
    vesm: ["vesm"]
  };
  const own = FAMILY_SIGNATURES[calibration.family] ?? [];
  const ownPresent = own.some(sig => p.includes(sig));
  const foreignPresent = Object.entries(FAMILY_SIGNATURES)
    .filter(([fam]) => fam !== calibration.family)
    .some(([, sigs]) => sigs.some(sig => p.includes(sig)));
  // Ambiguous when the provenance names a different family, or names none at all while
  // still being informative enough to have been expected to.
  return foreignPresent || (!ownPresent && p.trim().length > 0);
}

/**
 * Which registry row describes the model that actually produced a card's numbers.
 *
 * The calibration row used to be picked from the *settings* engine: with "remote-hf" selected the
 * SaProt card took the 650M row (1280-dim, 650M note) while the payload said the remote tier had
 * served SaProt_35M_AF2 — the server falls back 650M → 35M, and to VESM-150M when SaProt fails
 * entirely. The payload's `provenance` is the record of what ran, so it decides; the settings
 * engine is only a last resort, and a row chosen that way is flagged `inferred`.
 */
export interface ServedModel {
  registryKey: keyof typeof MODEL_CALIBRATIONS | null;
  calibration: ModelCalibration | null;
  /** True when the provenance names a model other than the card's own family (a fallback tier). */
  fallback: boolean;
  /** True when no provenance string named a model and the row was taken from settings. */
  inferred: boolean;
  engine: "remote" | "local" | "unknown";
}

export function resolveServedModel(
  id: PerturbationModelId,
  provenance?: string | null,
  saprotEngine?: string | null
): ServedModel {
  const p = (provenance ?? "").toLowerCase();
  const engine: ServedModel["engine"] = /remote|cloud|serverless|japanfold/.test(p)
    ? "remote"
    : /local|cpu|sidecar/.test(p)
      ? "local"
      : "unknown";
  let key: ServedModel["registryKey"] = null;
  if (/vesm/.test(p)) key = "vesm150m";
  else if (/saprot/.test(p)) key = /35m/.test(p) ? "saprot35m" : /650m/.test(p) ? "saprot650m" : null;
  else if (/esmc/.test(p)) key = "esmc6b";
  else if (/esm-?2|esm2/.test(p)) key = /650m/.test(p) ? "esm2_650m" : /t33/.test(p) ? "esm2_650m" : null;

  if (key) {
    const calibration = MODEL_CALIBRATIONS[key];
    const ownFamily = id === "saprot" ? "saprot" : id === "esm2" ? "esm2" : "esmc";
    return { registryKey: key, calibration, fallback: calibration.family !== ownFamily, inferred: false, engine };
  }
  // ESM-2 of unstated size, or no provenance at all: fall back to the card's own row, flagged.
  const calibration = resolveModelCalibration(id, { saprotEngine });
  return {
    registryKey: calibration ? (calibration.id as ServedModel["registryKey"]) : null,
    calibration,
    fallback: false,
    inferred: true,
    engine
  };
}

/** Reads the analysis result's per-model evaluations without assuming their shape. */
export interface PerturbationEvaluations {
  saprot?: any;
  esm2?: any;
  esmc?: any;
  esm3?: any;
}

export function extractPerturbationEvaluations(result: any): PerturbationEvaluations {
  return {
    saprot: result?.saprotEval ?? undefined,
    esm2: result?.esm2Eval ?? undefined,
    esmc: result?.esmcEval ?? undefined,
    esm3: result?.esm3Eval ?? undefined
  };
}

/** Models that produced a usable (non-error, non-empty) result. */
export function selectActiveEvaluations(
  evaluations: PerturbationEvaluations
): { id: PerturbationModelId; data: any }[] {
  return (["saprot", "esm2", "esmc"] as PerturbationModelId[])
    .map(id => ({ id, data: evaluations[id] }))
    .filter(entry => Boolean(entry.data) && !entry.data.error);
}

/** The evaluation tuple the pooled-LLR helper expects. */
export function toPooledEvaluationList(evaluations: PerturbationEvaluations): any[] {
  return [evaluations.esmc, evaluations.esm2, evaluations.saprot].filter(Boolean);
}

/** Calibration row for a model, honouring the SaProt engine setting. */
export function calibrationFor(
  id: PerturbationModelId,
  saprotEngine?: string | null
): ModelCalibration | null {
  return resolveModelCalibration(id, { saprotEngine });
}

/**
 * All contributing models plus their calibrations, for the inspector's registry section.
 * Unavailable models are included so the pane can state why a model is absent rather
 * than silently omitting it.
 */
export function describeModelRoster(
  evaluations: PerturbationEvaluations,
  saprotEngine?: string | null
): {
  id: PerturbationModelId;
  meta: PerturbationModelMeta;
  calibration: ModelCalibration | null;
  available: boolean;
  llr: number | null;
  displayName: string;
  /** Null when the serving engine is uncertain, so no width may be asserted. */
  embeddingDim: number | null;
  provenanceAmbiguous: boolean;
  provenance: string | null;
}[] {
  return PERTURBATION_MODELS.map(meta => {
    const data = evaluations[meta.id];
    const available = Boolean(data) && !data?.error;
    const provenance = typeof data?.provenance === "string" ? data.provenance : null;
    const calibration = calibrationFor(meta.id, saprotEngine);
    const provenanceAmbiguous = available && hasAmbiguousProvenance(calibration, provenance);

    return {
      id: meta.id,
      meta,
      calibration,
      available,
      // A NaN reaching here would render as "ΔLLR NaN", so it is excluded like any other gap.
      llr: available && typeof data?.llr === "number" && Number.isFinite(data.llr) ? data.llr : null,
      displayName: resolveModelDisplayName(meta.id, { saprotEngine, provenance }),
      embeddingDim: provenanceAmbiguous ? null : (calibration?.embeddingDim ?? null),
      provenanceAmbiguous,
      provenance
    };
  });
}
