/**
 * modelCalibration.ts — Per-model calibration registry for protein-language-model
 * zero-shot scores.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The perturbation surfaces previously coloured every model's ΔLLR against a single
 * constant, `THRESHOLDS.esm.pathogenic` (-5.0), and averaged raw ΔLLR across models to
 * build a "consensus". Both are wrong, and they are wrong for the same reason: the
 * zero-shot log-likelihood ratio is **model-native**. Its magnitude depends on the
 * model's training objective, parameter count and output vocabulary, so an LLR of -5.0
 * does not mean the same thing in ESM-1b (whose -5.0 is a documented benign cut-point)
 * as it does in SaProt or ESMC.
 *
 * The consequence was visible in the UI: a SaProt ΔLLR of -0.031 and an ESMC-6B ΔLLR of
 * -8.430 were both tested against -5.0, so SaProt rendered green and ESMC red on a scale
 * that was defined for neither. Averaging them (as `computeMultiModelLlr` did) produced a
 * number that is not on any model's scale at all.
 *
 * WHAT THIS MODULE DOES
 * ---------------------
 * It states, per model family, what is actually known. Where a published cut-point
 * exists it is recorded with its citation. Where none exists, `cutPoints.pathogenic`
 * is `null` and the UI is required to render the score as uncalibrated rather than
 * tinting it against a borrowed threshold. `null` here is a deliberate, load-bearing
 * value: it is the difference between "this score is normal" and "this score has never
 * been calibrated", and the two must not look alike.
 *
 * HOW TO FIX A `null` ENTRY
 * -------------------------
 * Calibrate it: score a labelled benchmark (ProteinGym DMS assays, or ClinVar
 * pathogenic/benign) with the model, pick the cut-point that maximises the target
 * metric, and record it here with the benchmark and sample size in `provenance`. The
 * repository already ships the harness for this — `server/services/stability/benchmark-proteingym.ts`
 * computes the rank correlation of predicted scores against experimental DMS scores.
 * Do not fill these in from clinical intuition.
 */

/** Whether a model's raw score may be tested against a fixed cut-point. */
export type CalibrationStatus =
  /** A published or benchmark-derived cut-point exists for this model's own scale. */
  | "calibrated"
  /** The score is on a model-native scale with no established cut-point. */
  | "uncalibrated"
  /** The provider assigns no pathogenicity meaning to the score at all. */
  | "informational";

export interface ModelCutPoints {
  /** ΔLLR at or below which the model is considered to indicate constraint. `null` = no cut-point. */
  pathogenic: number | null;
  /** ΔLLR at or above which the model is considered tolerated. `null` = no cut-point. */
  benign: number | null;
}

export interface ModelCalibration {
  id: string;
  /** Display name matching the perturbation model cards. */
  label: string;
  /** Coarse family, used to group models that share a score scale. */
  family: "esm1b" | "esm2" | "esmc" | "saprot" | "vesm";
  status: CalibrationStatus;
  cutPoints: ModelCutPoints;
  /** Which model this cut-point was actually derived for, when it is borrowed. */
  cutPointSource: string | null;
  /** Latent width of the embedding the model reports shift against. */
  embeddingDim: number | null;
  /** One-line, user-facing statement of what the score does and does not license. */
  note: string;
  /** Citation or benchmark backing `cutPoints`/`status`. */
  provenance: string;
}

/**
 * Model-native embedding widths. These are a property of the architecture, not of the
 * evidence, and they are the reason a raw embedding shift cannot be compared across
 * cards: a 2560-dim cosine distance and a 768-dim Euclidean distance are different
 * quantities that happen to share the label "shift".
 */
export const EMBEDDING_DIMS = {
  saprot35m: 768,
  vesm: 768,
  esm2_650m: 1280,
  saprot650m: 1280,
  esmc6b: 2560
} as const;

/**
 * Keys are stable model identifiers shared with the perturbation model cards.
 *
 * `esm1b` is retained because `THRESHOLDS.esm` still derives -5.0/-2.0 from it and
 * other evidence tabs consume those constants. It is deliberately absent from the
 * perturbation model set, which is precisely the point: the only model family in
 * `CALIBRATIONS` that *is* calibrated does not appear on this tab.
 */
export const MODEL_CALIBRATIONS: Record<string, ModelCalibration> = {
  esm1b: {
    id: "esm1b",
    label: "ESM-1b",
    family: "esm1b",
    status: "calibrated",
    cutPoints: { pathogenic: -7.5, benign: -5.0 },
    cutPointSource: "ESM-1b (Brandes et al. 2023, Nature Genetics)",
    embeddingDim: null,
    note:
      "The only cut-point in this registry derived for the model it is applied to. " +
      "ESM-1b is not one of the models evaluated on the perturbation tab.",
    provenance: "Brandes, N., et al. (2023). Genome-wide prediction of disease variant effects with a deep protein language model. Nature Genetics."
  },

  esm2_650m: {
    id: "esm2_650m",
    label: "ESM-2 650M",
    family: "esm2",
    status: "uncalibrated",
    cutPoints: { pathogenic: null, benign: null },
    cutPointSource: null,
    embeddingDim: EMBEDDING_DIMS.esm2_650m,
    note:
      "Masked-marginal LLR on a model-native scale. No published pathogenic/benign " +
      "cut-point exists for ESM-2; the ±0.5 nat resolution that separated the borrowed " +
      "ESM-1b cut-points is below the noise floor of this model's own output.",
    provenance:
      "Lin, Z., et al. (2023). Evolutionary-scale prediction of atomic-level protein structure with a language model. Science. " +
      "Meier, J., et al. (2021). Language models enable zero-shot prediction of the effects of mutations on protein function. NeurIPS."
  },

  esmc6b: {
    id: "esmc6b",
    label: "ESMC 6B",
    family: "esmc",
    status: "uncalibrated",
    cutPoints: { pathogenic: null, benign: null },
    cutPointSource: null,
    embeddingDim: EMBEDDING_DIMS.esmc6b,
    note:
      "Masked-marginal LLR on a 2560-dim model-native scale. Biohub publish the scoring " +
      "procedure and per-position entropy but no pathogenicity cut-point.",
    provenance:
      "EvolutionaryScale / Biohub (2024). ESMC: an open protein language model. " +
      "The published mutation-scoring cookbook computes LLR and a deleterious fraction without defining a clinical threshold."
  },

  saprot650m: {
    id: "saprot650m",
    label: "SaProt 650M AF2",
    family: "saprot",
    status: "uncalibrated",
    cutPoints: { pathogenic: null, benign: null },
    cutPointSource: null,
    embeddingDim: EMBEDDING_DIMS.saprot650m,
    note:
      "Structure-conditioned LLR. SaProt's discriminative power comes from re-ranking " +
      "substitutions within one Foldseek-tokenised backbone, not from the absolute " +
      "magnitude of its LLR — which is why its scores sit near zero on this variant.",
    provenance:
      "Su, J., et al. (2024). SaProt: Protein Language Modeling with Structure-aware Vocabulary. ICLR."
  },

  saprot35m: {
    id: "saprot35m",
    label: "SaProt 35M AF2",
    family: "saprot",
    status: "uncalibrated",
    cutPoints: { pathogenic: null, benign: null },
    cutPointSource: null,
    embeddingDim: EMBEDDING_DIMS.saprot35m,
    note:
      "Distilled 35M sibling of SaProt 650M, offered for speed rather than accuracy. " +
      "Same model-native scale, same absence of a cut-point.",
    provenance: "Su, J., et al. (2024). SaProt. ICLR."
  },

  vesm150m: {
    id: "vesm150m",
    label: "VESM-150M",
    family: "vesm",
    status: "informational",
    cutPoints: { pathogenic: null, benign: null },
    cutPointSource: null,
    embeddingDim: EMBEDDING_DIMS.vesm,
    note:
      "Co-distilled lightweight model reported for continuity with the decision-support " +
      "pipeline. Informational only: it is excluded from ACMG concordance voting.",
    provenance: "Ntranos Lab (2024). VESM: Co-distilled Variant Effect Language Models for Efficient Fitness Prediction."
  }
};

/**
 * Maps a UI model id (as used by the perturbation cards) plus the active SaProt engine
 * onto a calibration entry. Kept as a function rather than a lookup so the SaProt
 * engine setting cannot silently select the wrong registry row.
 */
export function resolveModelCalibration(
  modelId: "saprot" | "esm2" | "esmc" | string,
  options?: { saprotEngine?: string | null }
): ModelCalibration | null {
  if (modelId === "saprot") {
    return options?.saprotEngine === "saprot-35m"
      ? MODEL_CALIBRATIONS.saprot35m
      : MODEL_CALIBRATIONS.saprot650m;
  }
  if (modelId === "esm2") return MODEL_CALIBRATIONS.esm2_650m;
  if (modelId === "esmc") return MODEL_CALIBRATIONS.esmc6b;
  return null;
}

/**
 * True when a model's LLR may be tested against a fixed cut-point.
 *
 * Callers must branch on this rather than on a numeric threshold, because the whole
 * defect being fixed is a comparison against a number that was never valid.
 */
export function isCalibrated(calibration: ModelCalibration | null | undefined): boolean {
  return calibration?.status === "calibrated" && calibration.cutPoints.pathogenic !== null;
}

/**
 * Classifies a raw LLR, returning `"uncalibrated"` instead of guessing when the model
 * has no cut-point. Returning a verdict here would silently reintroduce the bug.
 */
export function classifyLlr(
  llr: number | null | undefined,
  calibration: ModelCalibration | null | undefined
): "pathogenic" | "benign" | "intermediate" | "uncalibrated" | "unavailable" {
  if (llr === null || llr === undefined || Number.isNaN(llr)) return "unavailable";
  if (!isCalibrated(calibration)) return "uncalibrated";

  const { pathogenic, benign } = calibration!.cutPoints;
  if (pathogenic !== null && llr <= pathogenic) return "pathogenic";
  if (benign !== null && llr >= benign) return "benign";
  return "intermediate";
}

/**
 * Rank-derived context that stays comparable across models.
 *
 * `mutRank` is the mutant's rank among the 20 canonical substitutions at that position,
 * computed inside the model's own output distribution. It is scale-free, which makes it
 * the one cross-model statement this module can make without a calibration study. This
 * is the honest replacement for the cross-family LLR mean.
 */
export function describeWithinModelRank(
  mutRank: number | null | undefined,
  positionalEntropy?: number | null
): string {
  if (mutRank === null || mutRank === undefined || Number.isNaN(mutRank)) {
    return "Mutant rank unavailable for this model.";
  }

  // The producer defaults a missing rank to 0 or 1, so only an in-range value is
  // reported as a rank. Clamping silently would turn "no data" into "rank 1", i.e. the
  // strongest possible claim of preference.
  if (!Number.isFinite(mutRank) || mutRank < 1 || mutRank > 20) {
    return `Mutant rank unavailable for this model (reported ${mutRank}, which is outside the canonical 1-20 range).`;
  }

  const rank = Math.round(mutRank);

  /**
   * Rank is stated ordinally and never as a percentile. A "top N%" reading is ambiguous
   * for a preference ranking -- the best residue is both "1st of 20" and "the 20th most
   * preferred" -- and an earlier revision of this function inverted it, describing the
   * model's *least* preferred substitution as "top 5%". Ordinal wording cannot be
   * misread in either direction.
   */
  const ordinal = (n: number): string => {
    const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    return `${n}${suffix}`;
  };

  let standing: string;
  if (rank <= 3) standing = "among the model's most preferred substitutions at this position";
  else if (rank <= 10) standing = "in the upper half of the model's preferences at this position";
  else if (rank <= 17) standing = "dispreferred relative to most of the alternatives";
  else standing = "among the model's least preferred substitutions at this position";

  const entropyNote =
    positionalEntropy !== null && positionalEntropy !== undefined && !Number.isNaN(positionalEntropy)
      ? positionalEntropy >= 2.5
        ? " High positional entropy means this site tolerates substitution broadly, so a low rank here is weaker evidence than the same rank at a rigid site."
        : positionalEntropy <= 1.0
          ? " Low positional entropy means this site is strongly constrained, so a low rank here is stronger evidence."
          : ""
      : "";

  return `Ranked ${ordinal(rank)} of 20 by model preference (${20 - rank} of the other 19 canonical substitutions rank above it) — ${standing}.${entropyNote}`;
}

/**
 * Detects when a set of models contributing to a pooled score do not share a scale.
 *
 * Pooling is only meaningful within a family. Where families differ, the pool is
 * reported as mixed and the UI must not present it as a single calibrated number.
 */
export function describeScaleHomogeneity(
  calibrations: (ModelCalibration | null | undefined)[]
): { homogeneous: boolean; families: string[]; sufficient: boolean } {
  const families = Array.from(
    new Set(
      calibrations
        .filter((c): c is ModelCalibration => Boolean(c))
        .map(c => c.family)
    )
  );
  /**
   * "Shared scale" is only a meaningful question for a pool of two or more models. With
   * zero or one contributing model there is nothing to share, and reporting that as a
   * homogeneous (success-coloured) state previously put a green "Yes" beside "Models
   * contributing 0".
   */
  return { homogeneous: families.length <= 1, families, sufficient: calibrations.filter(Boolean).length >= 2 };
}
