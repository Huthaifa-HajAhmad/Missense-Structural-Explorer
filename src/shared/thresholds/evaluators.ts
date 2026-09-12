import { THRESHOLDS } from "./constants.ts";

export type PredictorSignal = "pathogenic" | "benign" | "vus" | "unavailable";

export function evaluateAlphaGenomeAvi(
  alphagenome?: {
    aviPhred?: number | null;
    acmgStrength?: string | null;
  } | null
): PredictorSignal {
  if (!alphagenome) return "unavailable";
  const phred = alphagenome.aviPhred;
  if (phred === null || phred === undefined || isNaN(phred) || phred < 0) return "unavailable";
  if (phred >= THRESHOLDS.alphagenome.pathogenicSupporting) return "pathogenic";
  if (phred <= THRESHOLDS.alphagenome.benign) return "benign";
  return "vus";
}

export function evaluateRevel(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.revel.pathogenicStrong) return "pathogenic";
  if (score <= THRESHOLDS.revel.benign) return "benign";
  return "vus";
}

export function evaluateCadd(phred: number | null | undefined): PredictorSignal {
  if (phred === null || phred === undefined) return "unavailable";
  if (phred >= THRESHOLDS.cadd.pathogenicStrong) return "pathogenic";
  if (phred <= THRESHOLDS.cadd.benign) return "benign";
  return "vus";
}

export function evaluateAlphaMissense(
  score: number | null | undefined,
  cls: string | null | undefined
): PredictorSignal {
  const hasCls = cls !== null && cls !== undefined && cls !== "";
  const hasScore = score !== null && score !== undefined;
  if (!hasCls && !hasScore) return "unavailable";

  if (cls) {
    const lc = cls.toLowerCase();
    if (lc.includes(THRESHOLDS.alphaMissense.pathogenicClass)) return "pathogenic";
    if (lc.includes(THRESHOLDS.alphaMissense.benignClass)) return "benign";
  }
  if (score !== null && score !== undefined) {
    if (score >= THRESHOLDS.alphaMissense.pathogenicStrong) return "pathogenic";
    if (score <= THRESHOLDS.alphaMissense.benign) return "benign";
  }
  return "vus";
}

export function evaluateBayesdel(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.bayesdel.pathogenic) return "pathogenic";
  if (score <= THRESHOLDS.bayesdel.benign) return "benign";
  return "vus";
}

export function evaluateEsm(llr: number | null | undefined): PredictorSignal {
  // ESM-2 3B, ESM-C, and SaProt 650M do not have peer-reviewed clinical classification thresholds,
  // so they are treated as purely informational VUS signals.
  if (llr === null || llr === undefined) return "unavailable";
  return "vus";
}

export function evaluateEsm1b(llr: number | null | undefined): PredictorSignal {
  // ESM-1b clinical thresholds sourced from Brandes et al., 2023 (Nature Genetics)
  if (llr === null || llr === undefined) return "unavailable";
  if (llr <= THRESHOLDS.esm1b.pathogenic) return "pathogenic";
  if (llr >= THRESHOLDS.esm1b.benign) return "benign";
  return "vus";
}

export function evaluateGpnStar(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score <= THRESHOLDS.gpnStar.pathogenic) return "pathogenic";
  if (score >= THRESHOLDS.gpnStar.benign) return "benign";
  return "vus";
}

export function evaluateMetaRnn(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.metaRnn.pathogenic) return "pathogenic";
  if (score < THRESHOLDS.metaRnn.benign) return "benign";
  return "vus";
}

export function evaluateClinPred(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.clinPred.pathogenic) return "pathogenic";
  if (score < THRESHOLDS.clinPred.benign) return "benign";
  return "vus";
}

export function evaluateEigen(phred: number | null | undefined): PredictorSignal {
  if (phred === null || phred === undefined) return "unavailable";
  if (phred >= THRESHOLDS.eigen.pathogenic) return "pathogenic";
  if (phred < THRESHOLDS.eigen.benign) return "benign";
  return "vus";
}

export function evaluateDann(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score >= THRESHOLDS.dann.pathogenic) return "pathogenic";
  if (score <= 0.5) return "benign";
  return "vus";
}

export function evaluatePopEve(score: number | null | undefined): PredictorSignal {
  if (score === null || score === undefined) return "unavailable";
  if (score < 0) {
    if (score <= THRESHOLDS.popEve.pathogenicSupporting) return "pathogenic";
    if (score >= THRESHOLDS.popEve.benignLlr) return "benign";
    return "vus";
  }
  if (score >= THRESHOLDS.popEve.pathogenicNormalized) return "pathogenic";
  if (score <= THRESHOLDS.popEve.benignNormalized) return "benign";
  return "vus";
}

export function evaluateSplicePredictor(
  spliceProximity?: { distance: number; isNearSpliceSite: boolean } | null,
  spliceai?: { ds_ag: number | null; ds_al: number | null; ds_dg: number | null; ds_dl: number | null; max_ds: number | null } | null,
  dbscsnv?: { ada_score: number | null; rf_score: number | null } | null
): PredictorSignal {
  const isNear = spliceProximity?.isNearSpliceSite ?? false;
  const maxDs = spliceai?.max_ds ?? 0;
  const isSpliceAIPathogenic = maxDs >= 0.10;
  const isDbscsnvPathogenic = (dbscsnv?.ada_score != null && dbscsnv.ada_score >= THRESHOLDS.dbscsnv.spliceAltering) ||
                             (dbscsnv?.rf_score != null && dbscsnv.rf_score >= THRESHOLDS.dbscsnv.spliceAltering);

  if (isNear || isSpliceAIPathogenic || isDbscsnvPathogenic) {
    return "pathogenic";
  }

  if ((spliceProximity === undefined || spliceProximity === null) &&
      (spliceai === undefined || spliceai === null) &&
      (dbscsnv === undefined || dbscsnv === null)) {
    return "unavailable";
  }

  const dist = spliceProximity?.distance ?? Infinity;
  const hasSpliceAI = spliceai?.max_ds != null;
  const isSpliceAIBenign = hasSpliceAI ? (spliceai!.max_ds! <= 0.02) : null;

  const hasDbscsnv = dbscsnv?.ada_score != null || dbscsnv?.rf_score != null;
  const isDbscsnvBenign = hasDbscsnv
    ? ((dbscsnv?.ada_score ?? 0) < THRESHOLDS.dbscsnv.spliceAltering && (dbscsnv?.rf_score ?? 0) < THRESHOLDS.dbscsnv.spliceAltering)
    : null;

  if (dist > 10 && isSpliceAIBenign !== false && isDbscsnvBenign !== false
      && (isSpliceAIBenign === true || isDbscsnvBenign === true)) {
    return "benign";
  }

  if (isSpliceAIBenign === null && isDbscsnvBenign === null) {
    return "unavailable";
  }

  return "vus";
}
