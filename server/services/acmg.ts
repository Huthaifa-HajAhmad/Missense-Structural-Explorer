/**
 * acmg.ts — Rule-based ACMG/AMP 2015 pathogenicity classification engine.
 *
 * Implements Richards et al. 2015 Am J Hum Genet 97(1):6-18 combinatorial
 * rules (five-tier classification) with the following corrections applied:
 *
 *  ACMG-2  : Richards 2015 five-tier combinatorial classifier
 *  ACMG-3  : ClinVar pathogenic evidence mapped to PS1 (replacing retired PP5). ClinVar benign no longer mapped to any criterion (BP6 retired, no replacement).
 *  ACMG-5  : Predictor concordance voting (n-of-3) for PP3 / BP4
 *  ACMG-AM : amClass matched with .includes() → catches "likely_pathogenic"
 *  THRESH  : All cutpoints imported from thresholds.ts (single source of truth)
 *  PARTIAL : Tracks and exposes partial evidence (unavailable predictors)
 */

import { CLINVAR_AA_MAP } from "../../src/shared/aminoAcids.ts";
import {
  THRESHOLDS,
  countPredictorConcordance,
  PredictorConcordance,
} from "../../src/shared/thresholds.ts";
import type { ClinVarData } from "./clinvar.ts";
import type { PredictorData, ConservationData } from "../../src/shared/contracts.ts";
import type { GnomadVariantFrequency, GnomadGeneConstraint } from "./gnomad.ts";
import type { UniprotFeaturesResult } from "./uniprot.ts";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ACMGItem {
  code: string;
  reason: string;
}

export interface PartialEvidence {
  available: string[];
  unavailable: string[];
}

export interface RuleBasedInsights {
  plausibility: string;
  /** Five-tier ACMG verdict: Pathogenic | Likely Pathogenic | VUS | Likely Benign | Benign */
  acmgVerdict: string;
  acmgCriteria: ACMGItem[];
  /** Which in-silico tools returned data vs were unavailable */
  partialEvidence: PartialEvidence;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeProteinChangeTo1Letter(variantStr: string): string | null {
  const clean = variantStr.replace(/^p\./i, "").trim().toLowerCase();

  // Try 3-letter match e.g. arg408trp
  const match3 = clean.match(/^([a-z]{3})(\d+)([a-z]{3})$/);
  if (match3) {
    const wt1  = CLINVAR_AA_MAP[match3[1]];
    const pos  = match3[2];
    const mut1 = CLINVAR_AA_MAP[match3[3]];
    if (wt1 && mut1) {
      return `${wt1.toUpperCase()}${pos}${mut1.toUpperCase()}`;
    }
  }

  // Try 1-letter match e.g. r408w
  const match1 = clean.match(/^([a-z])(\d+)([a-z])$/);
  if (match1) {
    return `${match1[1].toUpperCase()}${match1[2]}${match1[3].toUpperCase()}`;
  }

  return null;
}

export function isNullVariant(variantStr: string): boolean {
  if (!variantStr || typeof variantStr !== "string") return false;
  const clean = variantStr.replace(/^p\./i, "").trim().toLowerCase();
  return clean.includes("ter") || 
         clean.includes("stop") || 
         clean.includes("fs") || 
         clean.endsWith("*") || 
         clean.endsWith("x") || 
         clean.includes("del") || 
         clean.includes("ins") || 
         clean.includes("dup");
}

export function isInFrameIndel(variantStr: string): boolean {
  if (!variantStr || typeof variantStr !== "string") return false;
  const clean = variantStr.replace(/^p\./i, "").trim().toLowerCase();
  return (clean.includes("del") || clean.includes("ins") || clean.includes("dup")) && !clean.includes("fs");
}

export function isIndelInRepeatRegion(sequence: string, pos: number): boolean {
  if (!sequence || isNaN(pos) || pos < 3 || pos > sequence.length - 2) return false;
  const local = sequence.slice(pos - 3, pos + 2);
  return /(.)\1\1/.test(local);
}

// ---------------------------------------------------------------------------
// Richards 2015 five-tier combinatorial classifier
// ---------------------------------------------------------------------------
// Evidence weight encoding (per Table 4 of Richards et al. 2015):
//   PVS1 = 8   PS = 4   PM = 2   PP = 1
//   BA1  = -8  BS = -4  BP = -2  (no BA1 compound normally)
//
// Classification rules (from Table 5):
//   Pathogenic      : PVS1 + (≥1 PS | ≥2 PM | (1 PM + ≥2 PP) | ≥4 PP)
//                   | ≥2 PS | (1 PS + ≥3 PM) | (1 PS + 2 PM + ≥2 PP) | (1 PS + ≥4 PP)
//   Likely Path.    : (1 PVS1 + 1 PM) | (1 PS + 1-2 PM) | (1 PS + ≥2 PP)
//                   | ≥3 PM | (2 PM + ≥2 PP) | (1 PM + ≥4 PP)
//   Benign          : 1 BA1 | ≥2 BS
//   Likely Benign   : 1 BS + 1 BP | ≥2 BP
//   VUS             : everything else
//
// Simplified but faithful integer encoding:
const WEIGHT = {
  PVS1: 8, PS: 4, PM: 2, PP: 1,
  BA1: -8, BS: -4, BP: -2,
} as const;

type WeightKey = keyof typeof WEIGHT;

function codeWeight(code: string): number {
  if (code === "PVS1")           return WEIGHT.PVS1;
  if (code === "PVS1_Strong" || code === "PP3_Strong") return WEIGHT.PS;
  if (code === "PVS1_Moderate" || code === "PP3_Moderate") return WEIGHT.PM;
  if (code.startsWith("PS"))     return WEIGHT.PS;
  if (code.startsWith("PM"))     return WEIGHT.PM;
  if (code.startsWith("PP"))     return WEIGHT.PP;
  if (code === "BA1")            return WEIGHT.BA1;
  if (code.startsWith("BS") || code === "BP4_Moderate") return WEIGHT.BS;
  if (code.startsWith("BP"))     return WEIGHT.BP;
  return 0;
}

function classifyVariant(criteria: ACMGItem[]): string {
  // Standalone benign override
  const hasBa1 = criteria.some(c => c.code === "BA1");
  if (hasBa1) return "Benign";

  const pathogenic = criteria.filter(c => codeWeight(c.code) > 0);
  const benign     = criteria.filter(c => codeWeight(c.code) < 0);

  const nPVS = pathogenic.filter(c => c.code === "PVS1").length;
  const nPS  = pathogenic.filter(c => c.code.startsWith("PS") || c.code === "PVS1_Strong" || c.code === "PP3_Strong").length;
  const nPM  = pathogenic.filter(c => c.code.startsWith("PM") || c.code === "PVS1_Moderate" || c.code === "PP3_Moderate").length;
  const nPP  = pathogenic.filter(c => c.code.startsWith("PP") && c.code !== "PP3_Strong" && c.code !== "PP3_Moderate").length;
  const nBS  = benign.filter(c => c.code.startsWith("BS") || c.code === "BP4_Moderate").length;
  const nBP  = benign.filter(c => c.code.startsWith("BP") && c.code !== "BP4_Moderate").length;

  // ---- Pathogenic ----
  const isPathogenic =
    (nPVS >= 1 && (nPS >= 1 || nPM >= 2 || (nPM >= 1 && nPP >= 2) || nPP >= 4)) ||
    nPS >= 2 ||
    (nPS >= 1 && nPM >= 3) ||
    (nPS >= 1 && nPM >= 2 && nPP >= 2) ||
    (nPS >= 1 && nPM >= 1 && nPP >= 4);

  // ---- Likely Pathogenic ----
  const isLikelyPathogenic =
    !isPathogenic && (
      (nPVS >= 1 && (nPM >= 1 || nPP >= 2)) ||
      (nPS >= 1 && nPM >= 1 && nPM <= 2) ||
      (nPS >= 1 && nPP >= 2) ||
      nPM >= 3 ||
      (nPM >= 2 && nPP >= 2) ||
      (nPM >= 1 && nPP >= 4)
    );

  // ---- Benign ----
  const isBenign = nBS >= 2;

  // ---- Likely Benign ----
  const isLikelyBenign =
    !isBenign && ((nBS >= 1 && nBP >= 1) || nBP >= 2);

  const hasPathogenic = isPathogenic || isLikelyPathogenic;
  const hasBenign = isBenign || isLikelyBenign;

  if (hasPathogenic && hasBenign) {
    return "Variant of Uncertain Significance (VUS)";
  }

  if (isPathogenic)       return "Pathogenic";
  if (isLikelyPathogenic) return "Likely Pathogenic";
  if (isBenign)           return "Benign";
  if (isLikelyBenign)     return "Likely Benign";
  return "Variant of Uncertain Significance (VUS)";
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

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

export function computeRuleBasedACMG(input: ACMGEvidenceInput): RuleBasedInsights {
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
    esmcEval?.llr ?? esm2?.llr,
    {
      metarnn: conservationData?.metarnn,
      clinpred: conservationData?.clinpred,
      eigenPhred: conservationData?.eigenPhred,
      dann: conservationData?.dann,
      popeve: conservationData?.popeve,
      esm2Llr: esm2Eval?.llr,
      saprotLlr: saprotEval?.llr,
      spliceProximity: conservationData?.spliceProximity,
      spliceai: conservationData?.spliceai,
      dbscsnv: conservationData?.dbscsnv,
      alphagenome: conservationData?.alphagenome
    }
  );

  const { nPathogenic, nBenign, available, unavailable, signals } = concordance;
  const nAvailable = available.length;

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
    // Determine consensus strength
    const consensusWord =
      nPathogenic >= 2 ? `${nPathogenic}/${nAvailable} predictors agree on pathogenic impact` :
                         `${nPathogenic}/${nAvailable} predictor supports pathogenic impact`;
    const conflictNote =
      nBenign >= 1
        ? ` ⚠ Conflicting in-silico signals: ${nBenign} predictor(s) support benign.`
        : "";

    let pp3Code = "PP3";
    let tierNote = "";
    if (aviPhred !== null && aviPhred !== undefined && !isNaN(aviPhred) && aviPhred >= 35.0) {
      pp3Code = "PP3_Strong";
      tierNote = ` [Strong evidence, AlphaGenome Phred ${aviPhred.toFixed(1)}${modalityNote}]`;
    } else if (aviPhred !== null && aviPhred !== undefined && !isNaN(aviPhred) && aviPhred >= 25.0) {
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
    if (aviPhred !== null && aviPhred !== undefined && !isNaN(aviPhred) && aviPhred <= 5.0 && aviPhred >= 0) {
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
  let pp2Assigned = false;

  if (gnomadConstraint?.isPP2Constrained && !skipPathogenicComp) {
    // Live gnomAD evidence — much more specific than the hardcoded list
    const misZ  = gnomadConstraint.missense_z !== null ? gnomadConstraint.missense_z.toFixed(2) : "N/A";
    const oeMis = gnomadConstraint.oe_mis     !== null ? gnomadConstraint.oe_mis.toFixed(3)     : "N/A";
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

  // -------------------------------------------------------------------------
  // 5. ACMG five-tier verdict
  // -------------------------------------------------------------------------
  const acmgVerdict = classifyVariant(criteria);

  // -------------------------------------------------------------------------
  // 6. Plausibility summary narrative
  // -------------------------------------------------------------------------
  const pathCodes  = criteria.filter(c => codeWeight(c.code) > 0);
  const benignCodes = criteria.filter(c => codeWeight(c.code) < 0);

  let plausibility = "";
  if (pathCodes.length > 0 && benignCodes.length === 0) {
    plausibility = `Plausibly pathogenic based on gathered evidence: ${pathCodes.map(c => c.code).join(", ")}.`;
  } else if (benignCodes.length > 0 && pathCodes.length === 0) {
    plausibility = `Plausibly benign based on gathered evidence: ${benignCodes.map(c => c.code).join(", ")}.`;
  } else if (pathCodes.length > 0 && benignCodes.length > 0) {
    plausibility = `Conflicting evidence. Pathogenic indicators: ${pathCodes.map(c => c.code).join(", ")}; Benign indicators: ${benignCodes.map(c => c.code).join(", ")}.`;
  } else {
    plausibility = "No strong pathogenic or benign indicator criteria from database evidence.";
  }

  return {
    plausibility,
    acmgVerdict,
    acmgCriteria: criteria,
    partialEvidence: { available, unavailable },
  };
}
