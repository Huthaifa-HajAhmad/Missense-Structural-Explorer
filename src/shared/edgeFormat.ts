/**
 * edgeFormat.ts — how a predictor's calibrated cut-points (its band edges) and axis ticks are printed.
 * The Score scales and the Strength bands both use these, so one edge reads the same way on both.
 */

/** A number with trailing zeros removed ("0.29" for 0.290), for axis ticks. Values of 10 or more keep one decimal. */
export function fmtTick(n: number): string {
  return Math.abs(n) >= 10 ? n.toFixed(1) : Number(n.toFixed(3)).toString();
}

/**
 * One tool's edges keep one number of decimals, as its calibration publishes them: REVEL reads
 * "0.290" beside "0.644", not "0.29". Values of 10 or more keep one decimal (CADD "25.3").
 */
export function edgeFormatter(values: number[]): (n: number) => string {
  const decimals = Math.max(0, ...values.filter(v => Math.abs(v) < 10).map(v => (fmtTick(v).split(".")[1] ?? "").length));
  return (n: number) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(decimals));
}
