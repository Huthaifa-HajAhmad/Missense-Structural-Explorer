import type { LmReading, PerturbationEvidence } from "./perturbationEvidence";
import type { PerturbationModelId } from "./perturbationModels";

/**
 * The short readings the Structural perturbation tab and its Evidence Lineage rail both print.
 * They live here, once, so the two panes cannot pick a different model or word a direction differently.
 */

/**
 * The model to show in detail: the preferred one if it has a result; otherwise the first model with a
 * reading, because a flat distribution has no preference to show; otherwise any scored model.
 */
export function selectLmReading(ev: PerturbationEvidence, preferred: PerturbationModelId): LmReading | null {
  return (
    ev.lms.find(l => l.id === preferred && l.availability.state === "computed") ??
    ev.scored.find(l => l.direction !== "flat") ??
    ev.scored[0] ??
    null
  );
}

/** "Favours Ser", "Near even", "No preference" — never red or green, because none of it is an ACMG code. */
export function directionLabel(lm: LmReading, wt: string, mut: string): string | null {
  switch (lm.direction) {
    case "favours-native": return `Favours ${wt}`;
    case "favours-variant": return `Favours ${mut}`;
    case "even": return "Near even";
    case "flat": return "No preference";
    default: return null;
  }
}

/**
 * The hero figure. "N of M" states a majority. With no majority (a tie, or most models near even or
 * flat) the figure says "Split" and the label lists every direction, so a minority never reads as the answer.
 */
export function directionCount(ev: PerturbationEvidence): { figure: string; label: string } {
  const dir = ev.direction;
  if (dir.nScored === 0) return { figure: "—", label: "no language model has scored this substitution yet" };
  const wt = ev.residues.wtLabel || "native";
  const mut = ev.residues.mutLabel || "variant";
  const atResidue = ev.residues.position !== null ? ` at residue ${ev.residues.position}` : "";
  const variantLeads = dir.nFavourVariant > dir.nFavourNative;
  const lead = variantLeads ? dir.nFavourVariant : dir.nFavourNative;
  if (lead * 2 > dir.nScored) {
    const order = variantLeads ? `${mut} over native ${wt}` : `native ${wt} over ${mut}`;
    return { figure: `${lead} of ${dir.nScored}`, label: `models favour ${order}${atResidue}` };
  }
  const parts = [
    dir.nFavourNative > 0 && `${dir.nFavourNative} favour native ${wt}`,
    dir.nFavourVariant > 0 && `${dir.nFavourVariant} favour ${mut}`,
    dir.nEven > 0 && `${dir.nEven} near even`,
    dir.nFlat > 0 && `${dir.nFlat} with no preference`
  ].filter(Boolean);
  return { figure: "Split", label: parts.join(" · ") + atResidue };
}
