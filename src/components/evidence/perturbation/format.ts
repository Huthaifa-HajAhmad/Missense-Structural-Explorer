import { ENTROPY_MARKS } from "../../../shared/modelCalibration";
import { oddsText, type LmReading } from "../../../shared/perturbationEvidence";

/* Short wordings shared by the model cards, the readings table and the residue detail. */

export const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/** "Gln 384× as likely as His" / "His 2.1× as likely as Gln" / "within 2× of each other". */
export function oddsLine(lm: LmReading, wt: string, mut: string): string | null {
  if (lm.odds === null) return null;
  if (lm.direction === "flat") return lm.entropy !== null ? `Near-flat · ${lm.entropy.toFixed(2)} of ${ENTROPY_MARKS.ceiling.toFixed(2)} bits` : "Near-flat distribution";
  if (lm.direction === "favours-variant") return `${mut} ${oddsText(1 / lm.odds)} as likely as ${wt}`;
  if (lm.direction === "even") return `${wt} and ${mut} within 2× of each other`;
  return `${wt} ${oddsText(lm.odds)} as likely as ${mut}`;
}

/** "His 5th of 20 · Gln 1st" — the rank always beside the native's, never alone. */
export function rankLine(lm: LmReading, wt: string, mut: string): string | null {
  if (lm.rank === null) return null;
  return `${mut} ${ordinal(lm.rank)} of 20${lm.nativeRank !== null ? ` · ${wt} ${ordinal(lm.nativeRank)}` : ""}`;
}
