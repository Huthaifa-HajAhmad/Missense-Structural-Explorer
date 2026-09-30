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

/**
 * Evidence weights used ONLY to sort criteria into pathogenic (> 0) and benign (< 0) sides; the
 * verdict comes from the Richards et al. 2015 combining rules below, not from a points total.
 * Richards 2015 defines no points (its Table 4 lists criteria). These are not Tavtigian 2020's
 * point scale either (there, benign Supporting is −1, not −2), so never sum them into a score.
 *   PVS1 = 8   PS = 4   PM = 2   PP = 1
 *   BA1  = -8  BS = -4  BP = -2
 */
export const WEIGHT = {
  PVS1: 8, PS: 4, PM: 2, PP: 1,
  BA1: -8, BS: -4, BP: -2,
} as const;

export type WeightKey = keyof typeof WEIGHT;

export function codeWeight(code: string): number {
  if (code === "PVS1") return WEIGHT.PVS1;
  if (code === "PVS1_Strong" || code === "PP3_Strong") return WEIGHT.PS;
  if (code === "PVS1_Moderate" || code === "PP3_Moderate") return WEIGHT.PM;
  if (code.startsWith("PS")) return WEIGHT.PS;
  if (code.startsWith("PM")) return WEIGHT.PM;
  if (code.startsWith("PP")) return WEIGHT.PP;
  if (code === "BA1") return WEIGHT.BA1;
  if (code.startsWith("BS") || code === "BP4_Moderate") return WEIGHT.BS;
  if (code.startsWith("BP")) return WEIGHT.BP;
  return 0;
}

/**
 * Executes Richards 2015 five-tier combinatorial rules against an array of triggered ACMG criteria.
 */
export function classifyVariant(criteria: ACMGItem[]): string {
  // Standalone benign override
  const hasBa1 = criteria.some(c => c.code === "BA1");
  if (hasBa1) return "Benign";

  const pathogenic = criteria.filter(c => codeWeight(c.code) > 0);
  const benign = criteria.filter(c => codeWeight(c.code) < 0);

  const nPVS = pathogenic.filter(c => c.code === "PVS1").length;
  const nPS = pathogenic.filter(c => c.code.startsWith("PS") || c.code === "PVS1_Strong" || c.code === "PP3_Strong").length;
  const nPM = pathogenic.filter(c => c.code.startsWith("PM") || c.code === "PVS1_Moderate" || c.code === "PP3_Moderate").length;
  const nPP = pathogenic.filter(c => c.code.startsWith("PP") && c.code !== "PP3_Strong" && c.code !== "PP3_Moderate").length;
  const nBS = benign.filter(c => c.code.startsWith("BS") || c.code === "BP4_Moderate").length;
  const nBP = benign.filter(c => c.code.startsWith("BP") && c.code !== "BP4_Moderate").length;

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

  if (isPathogenic) return "Pathogenic";
  if (isLikelyPathogenic) return "Likely Pathogenic";
  if (isBenign) return "Benign";
  if (isLikelyBenign) return "Likely Benign";
  return "Variant of Uncertain Significance (VUS)";
}
