/**
 * frequencyFormat.ts — how population frequencies, counts and cut-points are printed. One format for
 * every surface, re-exported by `frequencyEvidence.ts`. Pure.
 */

/** A number, or `null` for anything that is not one (undefined, NaN, Infinity). */
function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A frequency as a display string, using enough significant digits to distinguish the values the
 * ACMG cut-points separate.
 *
 * The PM2 boundary (0.01%) is four orders of magnitude below the BA1 boundary (5%), so a single
 * fixed precision either renders every common variant as "0.0%" or the rare ones as scientific
 * noise. Exponential notation is used at and below the PM2 ceiling, which is also how the ClinVar
 * and gnomAD records themselves report these values.
 */
export function formatAlleleFrequency(af: number | null | undefined): string {
  const value = finite(af);
  if (value === null) return "—";
  if (value === 0) return "0";
  if (value < 0.0001) return value.toExponential(2);
  if (value < 0.01) return `${(value * 100).toFixed(3)}%`;
  return `${(value * 100).toFixed(2)}%`;
}

/** `1234567` → `"1,234,567"`, and a non-number → `"—"` so a missing denominator is never a zero. */
export function formatCount(value: number | null | undefined): string {
  const count = finite(value);
  if (count === null) return "—";
  return count.toLocaleString("en-US");
}

/**
 * A cut-point as a percentage with no trailing zeros: 0.0001 → "0.01%", 0.001 → "0.1%", 0.01 → "1%".
 * The one format for thresholds on every surface; the rail and the hero used to print the same
 * ceiling as "≤ 0.01%" and "≤ 0.100%".
 */
export function formatCutPoint(value: number): string {
  return `${Number((value * 100).toPrecision(6))}%`;
}
