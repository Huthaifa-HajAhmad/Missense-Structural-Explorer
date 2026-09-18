import {
  THRESHOLDS,
  countPredictorConcordance,
  PredictorConcordance,
} from "../../../../src/shared/thresholds.ts";
import type { ClinVarData } from "../../external-api/clinvar.ts";
import type { PredictorData, ConservationData } from "../../../../src/shared/contracts.ts";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "../../external-api/gnomad.ts";
import type { UniprotFeaturesResult } from "../../external-api/uniprot.ts";
import { isNullVariant, isInFrameIndel, isIndelInRepeatRegion } from "./syntax.ts";
import type { ACMGItem } from "./classifier.ts";

export interface ACMGEvidenceInput {
  gene: string;
  variant: string;
  clinvar?: Partial<ClinVarData> | ClinVarData | null;
  predictorData?: Partial<PredictorData> | PredictorData | null;
  conservationData?: Partial<ConservationData> | ConservationData | null;
  gnomadConstraint?: GnomadGeneConstraint | {
    missense_z: number | null;
    oe_mis: number | null;
    pli: number | null;
    isPP2Constrained: boolean;
  } | null;
  gnomadFrequency?: GnomadVariantFrequency | {
    maxAF: number | null;
    groupMaxAF: number | null;
    genomeAF: number | null;
    exomeAF: number | null;
    nHomozygous: number | null;
    dataset: string;
    groupMaxAFIsFallback?: boolean;
  } | null;
  acmgWeighting?: "standard" | "conservative" | "strict-structural";
  esm2?: { llr: number | null; verdict: string } | null;
  uniprotFeatures?: { features?: Array<{ type: string; start: number; end: number; description?: string }>; [key: string]: any } | UniprotFeaturesResult | null;
  sequence?: string | null;
  esmcEval?: any | null;
  esm2Eval?: any | null;
  saprotEval?: any | null;
  serviceStatus?: Record<string, string> | any | null;
}

export interface CriteriaEvaluationResult {
  criteria: ACMGItem[];
  available: string[];
  unavailable: string[];
}

/**
 * Evaluates individual ACMG/AMP 2015 criteria rules from multi-source database and predictor inputs.
 */
export function evaluateAcmgCriteria(input: ACMGEvidenceInput): CriteriaEvaluationResult {
  const {
    gene,
    variant,
    clinvar = null,
    predictorData = null,
    conservationData = null,
    gnomadConstraint = null,
    gnomadFrequency = null,
    acmgWeighting = "standard",
    esm2 = null,
    uniprotFeatures = null,
    sequence = null,
    esmcEval = null,
    esm2Eval = null,
    saprotEval = null,
    serviceStatus = null
  } = input;
  const criteria: ACMGItem[] = [];

  const clinvarClass = (clinvar?.classification || "").toLowerCase();
  const isClinVarPathogenic = clinvarClass.includes("pathogenic");
  const isClinVarBenign = clinvarClass.includes("benign");

  const skipPathogenicComp = acmgWeighting === "strict-structural" || (acmgWeighting === "conservative" && !isClinVarPathogenic);
  const skipBenignComp = acmgWeighting === "strict-structural" || (acmgWeighting === "conservative" && !isClinVarBenign);

  // -------------------------------------------------------------------------
  // PVS1 — Null variant in a gene where LOF is a known mechanism of disease
  // -------------------------------------------------------------------------
  const isLofIntolerant = gnomadConstraint?.pli !== null && gnomadConstraint?.pli !== undefined && gnomadConstraint.pli >= 0.9;
  const isLofGene = isLofIntolerant;
  
  if (isNullVariant(variant) && !isInFrameIndel(variant) && isLofGene && !skipPathogenicComp) {
    const mutMatch = variant.match(/(\d+)/);
    const pos = mutMatch ? parseInt(mutMatch[1], 10) : null;
    const seqLen = sequence ? sequence.length : null;

    let nmdPredicted = true;
    let nmdNote = "nonsense-mediated decay (NMD) is predicted to occur.";

    if (pos && seqLen) {
      // Predict NMD absence if variant falls in the last exon / last 50 aa or 10% C-terminal of the protein
      const threshold = Math.max(50, Math.round(seqLen * 0.1));
      if (pos >= seqLen - threshold) {
        nmdPredicted = false;
        nmdNote = `nonsense-mediated decay (NMD) is not predicted to occur because the variant at position ${pos}/${seqLen} falls in the C-terminal region.`;
      }
    }

    if (nmdPredicted) {
      criteria.push({
        code: "PVS1",
        reason: `PVS1 (Very Strong): Null variant (${variant}) in gene ${gene} where loss-of-function is an established mechanism of disease. ${nmdNote}`
      });
    } else {
      // Check if variant overlaps a functional domain, active site, binding site
      let isCriticalDomain = false;
      if (uniprotFeatures?.features && Array.isArray(uniprotFeatures.features) && pos) {
        isCriticalDomain = uniprotFeatures.features.some((f: any) => {
          const type = (f.type || "").toLowerCase();
          const start = f.start;
          const end = f.end;
          return (type.includes("domain") || type.includes("site") || type.includes("active") || type.includes("binding")) &&
                 pos >= start && pos <= end;
        });
      }

      if (isCriticalDomain) {
        criteria.push({
          code: "PVS1_Strong",
          reason: `PVS1_Strong (Strong): C-terminal null variant (${variant}) in gene ${gene} where NMD is not predicted to occur, but residue falls within an established functional domain/site.`
        });
      } else {
        criteria.push({
          code: "PVS1_Moderate",
          reason: `PVS1_Moderate (Moderate): C-terminal null variant (${variant}) in gene ${gene} where NMD is not predicted to occur, and no critical domain overlap is confirmed.`
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // ACMG-3: Map ClinVar database status directly to standard ACMG codes (PS1)
  // -------------------------------------------------------------------------
  if (clinvar?.hasOtherPathogenicVariantSameAA && !skipPathogenicComp) {
    criteria.push({
      code: "PS1",
      reason: `Same amino acid change as a previously established pathogenic variant in ClinVar database (different nucleotide change).`
    });
  }

  // -------------------------------------------------------------------------
  // 1. PP3 / BP4  — In-silico predictor concordance (ACMG-5 fix)
  // -------------------------------------------------------------------------
  const concordance: PredictorConcordance = countPredictorConcordance(
    predictorData?.caddPhred,
    conservationData?.revel,
    predictorData?.amPathogenicity,
    predictorData?.amClass,
    conservationData?.bayesdel,
    /**
     * This positional argument is labelled "ESM-1b" and evaluated with ESM-1b's
     * documented cut-points (-7.5 / -5.0), so it must receive an ESM-1b score. It was
     * being fed `esmcEval?.llr ?? esm2?.llr`, which made an ESMC ΔLLR of ~-8.4 render as
     * "ESM-1b: pathogenic". ESMC, ESM-2 and SaProt have no published cut-points on their
     * own scales and travel through `extra` below, which is evaluated as informational.
     */
    conservationData?.esm1b ?? null,
    {
      metarnn: conservationData?.metarnn,
      clinpred: conservationData?.clinpred,
      eigenPhred: conservationData?.eigenPhred,
      dann: conservationData?.dann,
      popeve: conservationData?.popeve,
      esm2Llr: esm2Eval?.llr,
      saprotLlr: saprotEval?.llr,
      alphagenome: conservationData?.alphagenome
    }
  );

  const { nPathogenic, nBenign, nVus, available, unavailable, signals } = concordance;
  const nActiveAvailable = nPathogenic + nBenign + nVus;
  const nAvailable = nActiveAvailable > 0 ? nActiveAvailable : available.length;

  const buildPredictorDetail = () =>
    `CADD: ${predictorData?.caddPhred ?? "N/A"}, ` +
    `REVEL: ${conservationData?.revel ?? "N/A"}, ` +
    `AlphaMissense: ${predictorData?.amClass ?? "N/A"}, ` +
    `popEVE: ${signals.popeve ? signals.popeve.toUpperCase() : "N/A"}, ` +
    `BayesDel: ${conservationData?.bayesdel ?? "N/A"}, ` +
    (conservationData?.alphagenome?.aviPhred !== undefined && conservationData?.alphagenome?.aviPhred !== null
      ? `AlphaGenome: ${conservationData.alphagenome.aviPhred.toFixed(1)} Phred (${conservationData.alphagenome.topModality ?? "Multimodal"}), `
      : "") +
    `ESMC LLR: ${esmcEval?.llr !== undefined && esmcEval?.llr !== null ? esmcEval.llr.toFixed(2) : (esm2?.llr !== undefined && esm2?.llr !== null ? esm2.llr.toFixed(2) : "N/A")}, ` +
    `ESM-2 3B LLR: ${esm2Eval?.llr !== undefined && esm2Eval?.llr !== null ? esm2Eval.llr.toFixed(2) : "N/A"}, ` +
    `SaProt LLR: ${saprotEval?.llr !== undefined && saprotEval?.llr !== null ? saprotEval.llr.toFixed(2) : "N/A"}` +
    (unavailable.length > 0 ? `. ⚠ Partial evidence — unavailable: ${unavailable.join(", ")}` : "");

  const aviPhred = conservationData?.alphagenome?.aviPhred;
  const topModality = conservationData?.alphagenome?.topModality;
  const modalityNote = topModality ? ` (${topModality} modality)` : "";

  if (nPathogenic > nBenign && !skipPathogenicComp) {
    const consensusWord =
      nPathogenic >= 2 ? `${nPathogenic}/${nAvailable} predictors agree on pathogenic impact` :
                         `${nPathogenic}/${nAvailable} predictor supports pathogenic impact`;
    const conflictNote =
      nBenign >= 1
        ? ` ⚠ Conflicting in-silico signals: ${nBenign} predictor(s) support benign.`
        : "";

    let pp3Code = "PP3";
    let tierNote = "";
    if (aviPhred !== null && aviPhred !== undefined && !isNaN(aviPhred) && aviPhred >= THRESHOLDS.alphagenome.pathogenicStrong) {
      pp3Code = "PP3_Strong";
      tierNote = ` [Strong evidence, AlphaGenome Phred ${aviPhred.toFixed(1)}${modalityNote}]`;
    } else if (aviPhred !== null && aviPhred !== undefined && !isNaN(aviPhred) && aviPhred >= THRESHOLDS.alphagenome.pathogenicModerate) {
      pp3Code = "PP3_Moderate";
      tierNote = ` [Moderate evidence, AlphaGenome Phred ${aviPhred.toFixed(1)}${modalityNote}]`;
    }

    criteria.push({
      code: pp3Code,
      reason:
        `${consensusWord}${tierNote}. (${buildPredictorDetail()})${conflictNote}`,
    });
  } else if (nBenign > nPathogenic && !skipBenignComp) {
    const consensusWord =
      nBenign >= 2 ? `${nBenign}/${nAvailable} predictors agree on benign impact` :
                     `${nBenign}/${nAvailable} predictor supports benign impact`;
    const conflictNote =
      nPathogenic >= 1
        ? ` ⚠ Conflicting in-silico signals: ${nPathogenic} predictor(s) support pathogenic.`
        : "";

    let bp4Code = "BP4";
    let tierNote = "";
    if (aviPhred !== null && aviPhred !== undefined && !isNaN(aviPhred) && aviPhred <= THRESHOLDS.alphagenome.benignModerate && aviPhred >= 0) {
      bp4Code = "BP4_Moderate";
      tierNote = ` [Moderate evidence, AlphaGenome Phred ${aviPhred.toFixed(1)}${modalityNote}]`;
    }

    criteria.push({
      code: bp4Code,
      reason: `${consensusWord}${tierNote}. (${buildPredictorDetail()})${conflictNote}`,
    });
  }

  // -------------------------------------------------------------------------
  // 2. PM2 / BS1 / BA1 — Population frequency
  // -------------------------------------------------------------------------
  let maxFreq = 0;
  let hasFreq = false;

  const isGnomadTimeoutOrError = serviceStatus?.gnomadFrequency === "timeout" || serviceStatus?.gnomadFrequency === "error";

  if (isGnomadTimeoutOrError) {
    if (!unavailable.includes("GNOMAD_FREQUENCY")) {
      unavailable.push("GNOMAD_FREQUENCY (timeout/error — PM2 withheld)");
    }
  } else if (gnomadFrequency && gnomadFrequency.groupMaxAF !== null) {
    maxFreq = gnomadFrequency.groupMaxAF;
    hasFreq = true;
  } else if (gnomadFrequency && gnomadFrequency.maxAF !== null) {
    maxFreq = gnomadFrequency.maxAF;
    hasFreq = true;
  } else if (serviceStatus?.gnomadFrequency === "not_found") {
    // Confirmed queried in gnomAD and explicitly absent from population reference
    maxFreq = 0;
    hasFreq = true;
  } else if (clinvar?.alleleFrequencies && Array.isArray(clinvar.alleleFrequencies)) {
    for (const freq of clinvar.alleleFrequencies) {
      if (freq.value !== null && freq.value !== undefined) {
        hasFreq = true;
        const val = parseFloat(String(freq.value));
        if (!isNaN(val) && val > maxFreq) {
          maxFreq = val;
        }
      }
    }
  }

  if (hasFreq && !isGnomadTimeoutOrError) {
    const fallbackSuffix = gnomadFrequency?.groupMaxAFIsFallback
      ? " (note: groupMaxAF fell back to global maxAF due to low population counts)"
      : "";

    if (maxFreq > 0.05) {
      criteria.push({
        code: "BA1",
        reason: `Allele frequency is stand-alone benign (${(maxFreq * 100).toFixed(3)}% > 5.0% in population database)${fallbackSuffix}.`,
      });
    } else if (maxFreq > 0.01) {
      criteria.push({
        code: "BS1",
        reason: `Allele frequency significantly higher than expected for disorder (${(maxFreq * 100).toFixed(3)}% > 1.0%)${fallbackSuffix}.`,
      });
    } else {
      // PM2 inheritance-mode awareness (dominant: < 0.01%, recessive: < 0.1%)
      let pm2Threshold = 0.0001; // Default 0.01%
      let inheritanceModeText = "dominant/unknown";
      if (gnomadConstraint?.pli !== null && gnomadConstraint?.pli !== undefined) {
        if (gnomadConstraint.pli < 0.9) {
          pm2Threshold = 0.001; // 0.1% for recessive
          inheritanceModeText = "likely recessive (pLI < 0.9)";
        } else {
          inheritanceModeText = "likely dominant (pLI ≥ 0.9)";
        }
      }

      if (maxFreq <= pm2Threshold) {
        if (!skipPathogenicComp) {
          criteria.push({
            code: "PM2",
            reason: `Variant is extremely rare in population databases (frequency ${(maxFreq * 100).toFixed(4)}% ≤ ${(pm2Threshold * 100).toFixed(2)}% threshold for ${inheritanceModeText} inheritance)${fallbackSuffix}.`,
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // BS2 — Observed in homozygous state in healthy population reference
  // -------------------------------------------------------------------------
  if (
    gnomadFrequency &&
    gnomadFrequency.nHomozygous !== null &&
    gnomadFrequency.nHomozygous !== undefined &&
    gnomadFrequency.nHomozygous >= 2 &&
    !skipBenignComp
  ) {
    criteria.push({
      code: "BS2",
      reason: `Observed in homozygous state in ${gnomadFrequency.nHomozygous} individuals in gnomAD general population reference cohort, arguing against fully penetrant severe pathogenic disease causality.`
    });
  }

  // -------------------------------------------------------------------------
  // PM1 — Mutational hotspot and/or critical and well-established functional domain
  // -------------------------------------------------------------------------
  if (uniprotFeatures?.features && !skipPathogenicComp) {
    const posMatch = variant.match(/\d+/);
    const pos = posMatch ? parseInt(posMatch[0], 10) : NaN;
    if (!isNaN(pos)) {
      const criticalFeature = uniprotFeatures.features.find((f: any) => {
        const matchesType = ["Active site", "Binding site", "Metal binding", "Disulfide bond"].includes(f.type);
        return matchesType && pos >= f.start && pos <= f.end;
      });

      if (criticalFeature) {
        criteria.push({
          code: "PM1",
          reason: `Variant resides within a critical functional domain/hotspot: ${criticalFeature.type} (${criticalFeature.description || "curated site"}) spanning residues ${criticalFeature.start}–${criticalFeature.end}.`
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. PP2 — Missense constraint (ACMG-6: live gnomAD constraint preferred)
  // -------------------------------------------------------------------------
  if (gnomadConstraint?.isPP2Constrained && !skipPathogenicComp) {
    const misZ  = typeof gnomadConstraint.missense_z === "number" ? gnomadConstraint.missense_z.toFixed(2) : "N/A";
    const oeMis = typeof gnomadConstraint.oe_mis === "number"     ? gnomadConstraint.oe_mis.toFixed(3)     : "N/A";
    criteria.push({
      code: "PP2",
      reason:
        `Missense variant in gnomAD-constrained gene ${gene} ` +
        `(missense Z-score: ${misZ}, observed/expected: ${oeMis}). ` +
        `Low rate of benign missense variants supports pathogenic missense mechanism.`,
    });
  }

  // -------------------------------------------------------------------------
  // BP1 — Missense variant in gene where primarily truncating variants cause disease
  // -------------------------------------------------------------------------
  if (isLofIntolerant && gnomadConstraint?.isPP2Constrained === false && !isNullVariant(variant) && !skipBenignComp) {
    const misZ  = gnomadConstraint.missense_z !== null && gnomadConstraint.missense_z !== undefined ? gnomadConstraint.missense_z.toFixed(2) : "N/A";
    const oeMis = gnomadConstraint.oe_mis     !== null && gnomadConstraint.oe_mis     !== undefined ? gnomadConstraint.oe_mis.toFixed(3)     : "N/A";
    criteria.push({
      code: "BP1",
      reason: `Missense variant in gene ${gene} with high loss-of-function intolerance (pLI: ${gnomadConstraint.pli}) but lacking significant missense constraint (missense Z: ${misZ}, oe_mis: ${oeMis}). Truncating/loss-of-function variants are the primary established disease mechanism.`
    });
  }

  // -------------------------------------------------------------------------
  // PM4 / BP3 — In-frame Indels in repeat vs non-repeat regions
  // -------------------------------------------------------------------------
  if (isInFrameIndel(variant)) {
    const match = variant.match(/\d+/);
    const pos = match ? parseInt(match[0], 10) : NaN;
    const isRepeat = sequence ? isIndelInRepeatRegion(sequence, pos) : false;
    
    if (isRepeat) {
      if (!skipBenignComp) {
        criteria.push({
          code: "BP3",
          reason: `In-frame indel (${variant}) located within a repetitive sequence region.`
        });
      }
    } else {
      if (!skipPathogenicComp) {
        criteria.push({
          code: "PM4",
          reason: `In-frame length-changing indel (${variant}) in a non-repetitive sequence region.`
        });
      }
    }
  }

  return {
    criteria,
    available,
    unavailable
  };
}
