/**
 * clinvarClassification.ts — one reading of a ClinVar germline classification string.
 *
 * A substring test is wrong here: `"Conflicting interpretations of pathogenicity"` (and the newer
 * `"Conflicting classifications of pathogenicity"`) contains "pathogenic". A conflicting record is
 * uncertain evidence, so it is neither pathogenic nor benign for any criterion that reads ClinVar
 * (PS1, the conservative-weighting gate, the landscape context).
 */
export type ClinvarClass = "plp" | "blb" | "other";

export function classifyClinvar(significance: unknown): ClinvarClass {
  const s = String(significance ?? "").toLowerCase();
  if (s.includes("conflicting")) return "other";
  const path = s.includes("pathogenic");
  const benign = s.includes("benign");
  if (path && !benign) return "plp";
  if (benign && !path) return "blb";
  return "other";
}
