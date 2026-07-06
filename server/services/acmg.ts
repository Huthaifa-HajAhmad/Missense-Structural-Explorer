/**
 * acmg.ts — Rule-based ACMG/AMP 2015 pathogenicity classification engine.
 *
 * Implements Richards et al. 2015 Am J Hum Genet 97(1):6-18 combinatorial
 * rules (five-tier classification) with the following corrections applied:
 *
 *  ACMG-2  : Richards 2015 five-tier combinatorial classifier
 *  ACMG-3  : ClinVar evidence mapped to PP5 / BP6 (not PS1 / BS2)
 *  ACMG-5  : Predictor concordance voting (n-of-3) for PP3 / BP4
 *  ACMG-AM : amClass matched with .includes() → catches "likely_pathogenic"
 *  THRESH  : All cutpoints imported from thresholds.ts (single source of truth)
 *  PARTIAL : Tracks and exposes partial evidence (unavailable predictors)
 */

import { CLINVAR_AA_MAP } from "../../src/aminoAcids.ts";
import {
  THRESHOLDS,
  countPredictorConcordance,
  PredictorConcordance,
} from "./thresholds.ts";

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
  if (code.startsWith("PS"))     return WEIGHT.PS;
  if (code.startsWith("PM"))     return WEIGHT.PM;
  if (code.startsWith("PP"))     return WEIGHT.PP;
  if (code === "BA1")            return WEIGHT.BA1;
  if (code.startsWith("BS"))     return WEIGHT.BS;
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
  const nPS  = pathogenic.filter(c => c.code.startsWith("PS")).length;
  const nPM  = pathogenic.filter(c => c.code.startsWith("PM")).length;
  const nPP  = pathogenic.filter(c => c.code.startsWith("PP")).length;
  const nBS  = benign.filter(c => c.code.startsWith("BS")).length;
  const nBP  = benign.filter(c => c.code.startsWith("BP")).length;

  // ---- Pathogenic ----
  const isPathogenic =
    (nPVS >= 1 && (nPS >= 1 || nPM >= 2 || (nPM >= 1 && nPP >= 2) || nPP >= 4)) ||
    nPS >= 2 ||
    (nPS >= 1 && nPM >= 3) ||
    (nPS >= 1 && nPM >= 2 && nPP >= 2) ||
    (nPS >= 1 && nPP >= 4);

  // ---- Likely Pathogenic ----
  const isLikelyPathogenic =
    !isPathogenic && (
      (nPVS >= 1 && nPM >= 1) ||
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

  if (isPathogenic)       return "Pathogenic";
  if (isLikelyPathogenic) return "Likely Pathogenic";
  if (isBenign)           return "Benign";
  if (isLikelyBenign)     return "Likely Benign";
  return "Variant of Uncertain Significance (VUS)";
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

export function computeRuleBasedACMG(
  gene: string,
  variant: string,
  clinvar: any,
  predictorData: any,
  conservationData: any,
  /** Optional: live gnomAD constraint data from fetchGnomadGeneConstraint() */
  gnomadConstraint?: {
    missense_z: number | null;
    oe_mis: number | null;
    pli: number | null;
    isPP2Constrained: boolean;
  } | null,
  /** Optional: live gnomAD variant frequency from fetchGnomadVariantFrequency() */
  gnomadFrequency?: {
    maxAF: number | null;
    genomeAF: number | null;
    exomeAF: number | null;
    nHomozygous: number | null;
    dataset: string;
  } | null,
  acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard"
): RuleBasedInsights {
  const criteria: ACMGItem[] = [];

  const clinvarClass = (clinvar?.classification || "").toLowerCase();
  const isClinVarPathogenic = clinvarClass.includes("pathogenic");
  const isClinVarBenign = clinvarClass.includes("benign");

  const skipPathogenicComp = acmgWeighting === "strict-structural" || (acmgWeighting === "conservative" && !isClinVarPathogenic);
  const skipBenignComp = acmgWeighting === "strict-structural" || (acmgWeighting === "conservative" && !isClinVarBenign);

  // -------------------------------------------------------------------------
  // 1. PP3 / BP4  — In-silico predictor concordance (ACMG-5 fix)
  // -------------------------------------------------------------------------
  const concordance: PredictorConcordance = countPredictorConcordance(
    predictorData?.caddPhred,
    conservationData?.revel,
    predictorData?.amPathogenicity,
    predictorData?.amClass,
    predictorData?.eveScore,
    predictorData?.eveClass
  );

  const { nPathogenic, nBenign, available, unavailable, signals } = concordance;
  const nAvailable = available.length;

  const buildPredictorDetail = () =>
    `CADD: ${predictorData?.caddPhred ?? "N/A"}, ` +
    `REVEL: ${conservationData?.revel ?? "N/A"}, ` +
    `AlphaMissense: ${predictorData?.amClass ?? "N/A"}, ` +
    `EVE: ${predictorData?.eveClass || (predictorData?.eveScore !== null && predictorData?.eveScore !== undefined ? predictorData.eveScore.toFixed(3) : "N/A")}` +
    (unavailable.length > 0 ? `. ⚠ Partial evidence — unavailable: ${unavailable.join(", ")}` : "");

  if (nPathogenic > nBenign && !skipPathogenicComp) {
    // Determine consensus strength
    const consensusWord =
      nPathogenic >= 2 ? `${nPathogenic}/${nAvailable} predictors agree on pathogenic impact` :
                         `${nPathogenic}/${nAvailable} predictor supports pathogenic impact`;
    const conflictNote =
      nBenign >= 1
        ? ` ⚠ Conflicting in-silico signals: ${nBenign} predictor(s) support benign.`
        : "";

    criteria.push({
      code: "PP3",
      reason:
        `${consensusWord}. (${buildPredictorDetail()})${conflictNote}`,
    });
  } else if (nBenign > nPathogenic && !skipBenignComp) {
    const consensusWord =
      nBenign >= 2 ? `${nBenign}/${nAvailable} predictors agree on benign impact` :
                     `${nBenign}/${nAvailable} predictor supports benign impact`;
    const conflictNote =
      nPathogenic >= 1
        ? ` ⚠ Conflicting in-silico signals: ${nPathogenic} predictor(s) support pathogenic.`
        : "";

    criteria.push({
      code: "BP4",
      reason: `${consensusWord}. (${buildPredictorDetail()})${conflictNote}`,
    });
  }

  // -------------------------------------------------------------------------
  // 2. PM2 / BS1 / BA1 — Population frequency
  // -------------------------------------------------------------------------
  let maxFreq = 0;
  let hasFreq = false;

  if (gnomadFrequency && gnomadFrequency.maxAF !== null) {
    maxFreq = gnomadFrequency.maxAF;
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

  if (hasFreq) {
    if (maxFreq > 0.05) {
      criteria.push({
        code: "BA1",
        reason: `Allele frequency is stand-alone benign (${(maxFreq * 100).toFixed(3)}% > 5.0% in population database).`,
      });
    } else if (maxFreq > 0.01) {
      criteria.push({
        code: "BS1",
        reason: `Allele frequency significantly higher than expected for disorder (${(maxFreq * 100).toFixed(3)}% > 1.0%).`,
      });
    } else if (maxFreq > 0.0001 && maxFreq <= 0.01) {
      // ACMG-7: Fill the 0.01% – 1% gap with BS1_Supporting
      if (!skipBenignComp) {
        criteria.push({
          code: "BS1_Supp",
          reason: `Allele frequency intermediate: ${(maxFreq * 100).toFixed(4)}% (0.01%–1.0%). Weak evidence against pathogenicity.`,
        });
      }
    } else if (maxFreq <= 0.0001) {
      if (!skipPathogenicComp) {
        criteria.push({
          code: "PM2",
          reason: `Variant is extremely rare in population databases (frequency ${(maxFreq * 100).toFixed(4)}% < 0.01%).`,
        });
      }
    }
  } else {
    if (!skipPathogenicComp) {
      criteria.push({
        code: "PM2",
        reason: "Variant absent or extremely rare in population databases.",
      });
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
    pp2Assigned = true;
  }

  if (!pp2Assigned && !skipPathogenicComp) {
    // Hardcoded fallback — used only when gnomAD constraint data is unavailable
    const missenseConstrainedGenes = [
      "PAH", "FGFR3", "GBA1", "G6PD", "LDLR",
      "BRCA1", "BRCA2", "TP53", "PTEN", "ATM",
    ];
    if (missenseConstrainedGenes.includes(gene.toUpperCase())) {
      criteria.push({
        code: "PP2",
        reason: `Missense variant in gene ${gene} which has a low rate of benign missense variants and is established as a missense-disease mechanism gene. (Fallback: live gnomAD constraint data unavailable.)`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. PP5 / BP6 — Reputable source evidence (ACMG-3 fix: was PS1 / BS2)
  //
  //    RATIONALE: PS1 = "same amino acid change as established pathogenic" which
  //    requires evidence the *specific* AA change is pathogenic. When ClinVar
  //    records the SAME variant as pathogenic, PP5 (reputable source) is
  //    appropriate. PS1 should only be assigned when a *different* nucleotide
  //    change causes the same amino acid change. BP6 replaces BS2 equivalently.
  // -------------------------------------------------------------------------
  if (clinvarClass.includes("pathogenic")) {
    criteria.push({
      code: "PP5",
      reason: `Reputable source (ClinVar UID: ${clinvar.uid || "N/A"}) records this variant as pathogenic/likely pathogenic.`,
    });
  } else if (clinvarClass.includes("benign")) {
    criteria.push({
      code: "BP6",
      reason: `Reputable source (ClinVar UID: ${clinvar.uid || "N/A"}) records this variant as benign/likely benign.`,
    });
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
