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
 *
 * PM2 is weighed as Supporting (PP = 1), not Moderate: the ClinGen SVI recommendation for PM2
 * (version 1.0, September 2020) reduces absence from population databases to PM2_Supporting. The
 * code stays "PM2" on the wire; its strength is what the engine weighs it at, and every surface
 * reads that strength from `codeWeight`.
 */
export const WEIGHT = {
  PVS1: 8, PS: 4, PM: 2, PP: 1,
  BA1: -8, BS: -4, BP: -2,
} as const;

export type WeightKey = keyof typeof WEIGHT;

/** The one PM-family code applied below its Richards 2015 strength (ClinGen SVI PM2 recommendation, 2020). */
const isSupportingPm = (code: string) => code === "PM2" || code === "PM2_Supporting";

export function codeWeight(code: string): number {
  if (code === "PVS1") return WEIGHT.PVS1;
  if (isSupportingPm(code)) return WEIGHT.PP;
  if (code === "PVS1_Strong" || code === "PP3_Strong") return WEIGHT.PS;
  if (code === "PVS1_Moderate" || code === "PP3_Moderate" || code === "PP2_Moderate") return WEIGHT.PM;
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
  const nPM = pathogenic.filter(c => (c.code.startsWith("PM") && !isSupportingPm(c.code)) || c.code === "PVS1_Moderate" || c.code === "PP3_Moderate" || c.code === "PP2_Moderate").length;
  const nPP = pathogenic.filter(c => isSupportingPm(c.code) || (c.code.startsWith("PP") && c.code !== "PP3_Strong" && c.code !== "PP3_Moderate" && c.code !== "PP2_Moderate")).length;
  const nBS = benign.filter(c => c.code.startsWith("BS") || c.code === "BP4_Moderate").length;
  const nBP = benign.filter(c => c.code.startsWith("BP") && c.code !== "BP4_Moderate").length;

  // ---- Pathogenic (Richards 2015 Table 5) ----
  // (i) PVS1 AND one of: ≥1 PS, ≥2 PM, 1 PM + 1 PP, ≥2 PP.
  const isPathogenic =
    (nPVS >= 1 && (nPS >= 1 || nPM >= 2 || (nPM >= 1 && nPP >= 1) || nPP >= 2)) ||
    nPS >= 2 ||
    (nPS >= 1 && nPM >= 3) ||
    (nPS >= 1 && nPM >= 2 && nPP >= 2) ||
    (nPS >= 1 && nPM >= 1 && nPP >= 4);

  // ---- Likely Pathogenic ----
  // PVS1 + 1 PM is Richards LP (i). PVS1 + 1 PP is the ClinGen SVI PM2 recommendation's added combination
  // (1 Very strong + 1 Supporting = Likely pathogenic, Sept 2020); without it, lowering PM2 to Supporting
  // would demote every null variant whose only other evidence is rarity. PVS1 + ≥2 PP is Pathogenic above.
  const isLikelyPathogenic =
    !isPathogenic && (
      (nPVS >= 1 && (nPM >= 1 || nPP >= 1)) ||
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
