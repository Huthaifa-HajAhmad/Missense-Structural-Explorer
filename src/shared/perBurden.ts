/**
 * perBurden.ts — the gene-wise burden test of Pérez-Palma et al. 2020 (Genome Res 30:62,
 * doi 10.1101/gr.252601.119), re-run on current data. A port of `Part-2-burden-analysis.R` in
 * github.com/dlal-group/PERs, parameter for parameter:
 *
 *   • each residue is 1 if it carries ≥1 patient (ClinVar P/LP) missense variant, else 0; the same
 *     for population (gnomAD) missense;
 *   • 9-residue windows (±4) centred every 5 residues, from residue 5 to length − 4;
 *   • per window, a one-sided ("greater") Fisher exact test of patient vs population hits inside vs
 *     outside the window;
 *   • Bonferroni over the windows of the protein; adjusted p < 0.05 is significant; significant
 *     centres no more than 5 apart merge into one region spanning first centre − 4 to last centre + 4.
 *
 * The paper validated its PUBLISHED regions (ClinVar 2019 + HGMD vs gnomAD 2.0.2). This module applies
 * the same procedure to today's ClinVar (no HGMD: licensed) and gnomAD v4, which nobody has validated:
 * gnomAD v4 carries missense at most residues of most genes, so the population side saturates and the
 * test loses power (scripts/hotspot_probe: VHL, which has an expert PM1 hotspot, gets no region).
 * Surfaces must say both things.
 */

export const PER_METHOD = { halfWindow: 4, step: 5, alpha: 0.05 } as const;

export interface PerWindow {
  centre: number;
  start: number;
  end: number;
  /** Residues hit by patient / population variants inside the window. */
  patient: number;
  population: number;
  p: number;
  adjP: number;
}

export interface PerBurdenResult {
  length: number;
  windows: number;
  patientResidues: number;
  populationResidues: number;
  regions: Array<{ start: number; end: number; minAdjP: number }>;
  /** The window with the smallest p, significant or not. */
  best: PerWindow | null;
}

function logChoose(n: number, k: number): number {
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}

/** Lanczos log-gamma; exact enough for hypergeometric tails at protein-length counts. */
function lgamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** One-sided Fisher exact P(X ≥ a) for [[a, c], [b, d]] (rows patient/population, columns in/out). */
export function fisherGreater(a: number, b: number, c: number, d: number): number {
  const r1 = a + c;
  const c1 = a + b;
  const n = a + b + c + d;
  const hi = Math.min(r1, c1);
  const den = logChoose(n, c1);
  let p = 0;
  for (let x = a; x <= hi; x++) p += Math.exp(logChoose(r1, x) + logChoose(n - r1, c1 - x) - den);
  return Math.min(1, p);
}

export function perBurden(patient: Iterable<number>, population: Iterable<number>, length: number): PerBurdenResult {
  const P = new Set([...patient].filter((r) => r >= 1 && r <= length));
  const N = new Set([...population].filter((r) => r >= 1 && r <= length));
  const { halfWindow: h, step, alpha } = PER_METHOD;
  const raw: Omit<PerWindow, "adjP">[] = [];
  for (let centre = 1 + h; centre <= length - h; centre += step) {
    let a = 0;
    let b = 0;
    for (let r = centre - h; r <= centre + h; r++) {
      if (P.has(r)) a++;
      if (N.has(r)) b++;
    }
    raw.push({ centre, start: centre - h, end: centre + h, patient: a, population: b, p: fisherGreater(a, b, P.size - a, N.size - b) });
  }
  const m = raw.length;
  const windows: PerWindow[] = raw.map((w) => ({ ...w, adjP: Math.min(1, w.p * m) }));
  const regions: PerBurdenResult["regions"] = [];
  let open: { first: number; last: number; minAdjP: number } | null = null;
  for (const w of windows.filter((x) => x.adjP < alpha)) {
    if (open && w.centre - open.last <= step) {
      open.last = w.centre;
      open.minAdjP = Math.min(open.minAdjP, w.adjP);
    } else {
      if (open) regions.push({ start: open.first - h, end: open.last + h, minAdjP: open.minAdjP });
      open = { first: w.centre, last: w.centre, minAdjP: w.adjP };
    }
  }
  if (open) regions.push({ start: open.first - h, end: open.last + h, minAdjP: open.minAdjP });
  const best = windows.reduce<PerWindow | null>((acc, w) => (!acc || w.p < acc.p ? w : acc), null);
  return { length, windows: m, patientResidues: P.size, populationResidues: N.size, regions, best };
}
