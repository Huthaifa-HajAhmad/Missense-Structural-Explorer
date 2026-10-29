/**
 * spatialClustering.ts — the 3D proximity reading of Sivley et al. 2018 (AJHG, PMID 29455857), one
 * implementation for the server, the Hotspots subtab and the pre-registered benchmark
 * (`scripts/hotspot_benchmark`, decision in doc/HOTSPOT_3D_DECISION.md), so what was benchmarked is
 * what ships.
 *
 *   • Clustering gate. Univariate K: are the pathogenic residues closer together than random residue
 *     sets of the same structure? Bivariate D(t) = K_P(t) − K_N(t): are they closer together than the
 *     population residues, under label permutation of the pooled positions? Each curve is compared with
 *     its permutation median by the Simpson area between them; p is two-tailed, (k + 1) / (n + 1).
 *   • PathProx. At the distance t where the bivariate Z-score is largest, a residue's score is the
 *     share of pathogenic residues within t of it minus the share of population residues within t of
 *     it, with the residue's own entries left out of both sets.
 *
 * INVARIANTS
 * - Every parameter is an argument; the defaults below are the pre-registered ones and nothing else
 *   picks a number. The deviations from the paper (2,000 permutations, a 40-step grid, one protein so
 *   no cross-protein FDR, an AlphaFold model, residues rather than variants) are recorded with the
 *   result, so a screen can state them.
 * - Seeded: the same input gives the same p-values on every machine.
 * - Pure and dependency-free (`src/shared` imports nothing outside itself).
 */

export const SPATIAL_DEFAULTS = { permutations: 2000, steps: 40, seed: 20261028 } as const;

export interface SpatialInput {
  /** Residue numbers of the structure, in the order of `coords`. */
  residues: readonly number[];
  /** Cα coordinates, x y z per residue (length 3 × residues). */
  coords: ArrayLike<number>;
  /** Residues carrying ≥1 pathogenic variant. Numbers absent from `residues` are ignored. */
  pathogenic: readonly number[];
  /** Residues carrying ≥1 population (neutral reference) variant. A residue may be in both sets. */
  neutral: readonly number[];
  permutations?: number;
  steps?: number;
  seed?: number;
}

export interface ClusteringTest {
  /** Simpson area between the observed curve and the permutation median; positive = clustered. */
  area: number;
  p: number;
}

export interface SpatialResult {
  structureResidues: number;
  pathogenicResidues: number;
  neutralResidues: number;
  permutations: number;
  univariate: ClusteringTest;
  bivariate: ClusteringTest;
  /** Both tests p < 0.05 with a positive area (the pre-registered gate). */
  clustered: boolean;
  /** PathProx distance in Å (the bivariate grid point with the largest Z-score), or null when not computable. */
  threshold: number | null;
  /** PathProx score per structure residue, leave-residue-out; null when either set is empty after leaving out. */
  scores: Map<number, number | null>;
}

/** mulberry32: small, fast, seedable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a: Int32Array, rand: () => number): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
}

/** The paper's range: minimum observed distance to half the maximum (to the maximum when min > max / 2). */
function grid(distances: Float64Array, steps: number): number[] | null {
  if (!distances.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of distances) {
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const top = lo < hi / 2 ? hi / 2 : hi;
  if (!(top > lo)) return null;
  return Array.from({ length: steps + 1 }, (_, s) => lo + ((top - lo) * s) / steps);
}

/** Bin of a distance on the grid: the first grid point ≥ d, or -1 beyond the grid. */
function binOf(d: number, g: number[]): number {
  if (d > g[g.length - 1]) return -1;
  let lo = 0;
  let hi = g.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g[mid] >= d) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function cumulative(counts: Float64Array, pairs: number): Float64Array {
  const out = new Float64Array(counts.length);
  let run = 0;
  for (let i = 0; i < counts.length; i++) {
    run += counts[i];
    out[i] = pairs > 0 ? run / pairs : 0;
  }
  return out;
}

function simpson(ys: ArrayLike<number>, h: number): number {
  let n = ys.length;
  if (n < 3) return 0;
  if (n % 2 === 0) n -= 1;
  let s = ys[0] + ys[n - 1];
  for (let i = 1; i < n - 1; i++) s += (i % 2 ? 4 : 2) * ys[i];
  return (h / 3) * s;
}

function median(values: Float64Array): number {
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function twoTailed(obs: number, nulls: Float64Array): number {
  let lo = 0;
  let hi = 0;
  for (const v of nulls) {
    if (v <= obs) lo++;
    if (v >= obs) hi++;
  }
  return Math.min(1, (2 * (Math.min(lo, hi) + 1)) / (nulls.length + 1));
}

/** Observed vs permuted K curves → Simpson-area test. `curves` holds permutations × gridLength values. */
function areaTest(observed: Float64Array, curves: Float64Array[], h: number): { test: ClusteringTest; med: Float64Array } {
  const len = observed.length;
  const med = new Float64Array(len);
  const column = new Float64Array(curves.length);
  for (let s = 0; s < len; s++) {
    for (let p = 0; p < curves.length; p++) column[p] = curves[p][s];
    med[s] = median(column);
  }
  const area = (c: ArrayLike<number>) => simpson(Array.from(c, (v, s) => v - med[s]), h);
  const nulls = Float64Array.from(curves, area);
  const obs = area(observed);
  return { test: { area: obs, p: twoTailed(obs, nulls) }, med };
}

export function spatialClustering(input: SpatialInput): SpatialResult | null {
  const permutations = input.permutations ?? SPATIAL_DEFAULTS.permutations;
  const steps = input.steps ?? SPATIAL_DEFAULTS.steps;
  const rand = rng(input.seed ?? SPATIAL_DEFAULTS.seed);
  const n = input.residues.length;
  const index = new Map(input.residues.map((r, i) => [r, i]));
  const P = [...new Set(input.pathogenic)].filter((r) => index.has(r)).map((r) => index.get(r)!);
  const N = [...new Set(input.neutral)].filter((r) => index.has(r)).map((r) => index.get(r)!);
  // Sivley 2018 needed ≥3 pathogenic positions; fewer cannot form a distance distribution.
  if (P.length < 3 || N.length < 3) return null;

  const D = new Float32Array(n * n);
  const c = input.coords;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(c[3 * i] - c[3 * j], c[3 * i + 1] - c[3 * j + 1], c[3 * i + 2] - c[3 * j + 2]);
      D[i * n + j] = d;
      D[j * n + i] = d;
    }

  // ── Univariate: P against random residue sets of the same size ──
  const pPairs = new Float64Array((P.length * (P.length - 1)) / 2);
  for (let a = 0, k = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++) pPairs[k++] = D[P[a] * n + P[b]];
  const ug = grid(pPairs, steps);
  if (!ug) return null;
  const uh = ug[1] - ug[0];
  const uBins = new Int16Array(n * n);
  for (let i = 0; i < n * n; i++) uBins[i] = binOf(D[i], ug);
  const kOf = (set: ArrayLike<number>) => {
    const counts = new Float64Array(ug.length);
    let pairs = 0;
    for (let a = 0; a < set.length; a++)
      for (let b = a + 1; b < set.length; b++) {
        pairs++;
        const bin = uBins[set[a] * n + set[b]];
        if (bin >= 0) counts[bin]++;
      }
    return cumulative(counts, pairs);
  };
  const all = Int32Array.from({ length: n }, (_, i) => i);
  const uCurves: Float64Array[] = [];
  for (let p = 0; p < permutations; p++) {
    shuffle(all, rand);
    uCurves.push(kOf(all.subarray(0, P.length)));
  }
  const univariate = areaTest(kOf(P), uCurves, uh).test;

  // ── Bivariate: K_P − K_N under label permutation of the pooled positions ──
  const pool = Int32Array.from([...P, ...N]);
  const m = pool.length;
  const pooled = new Float64Array((m * (m - 1)) / 2);
  for (let a = 0, k = 0; a < m; a++) for (let b = a + 1; b < m; b++) pooled[k++] = D[pool[a] * n + pool[b]];
  const bg = grid(pooled, steps);
  if (!bg) return null;
  const bh = bg[1] - bg[0];
  const pairBins = new Int16Array(pooled.length);
  for (let k = 0; k < pooled.length; k++) pairBins[k] = binOf(pooled[k], bg);
  const pairsP = (P.length * (P.length - 1)) / 2;
  const pairsN = (N.length * (N.length - 1)) / 2;
  const isP = new Uint8Array(m);
  const dOf = () => {
    const cp = new Float64Array(bg.length);
    const cn = new Float64Array(bg.length);
    for (let a = 0, k = 0; a < m; a++)
      for (let b = a + 1; b < m; b++, k++) {
        const bin = pairBins[k];
        if (bin < 0) continue;
        if (isP[a] && isP[b]) cp[bin]++;
        else if (!isP[a] && !isP[b]) cn[bin]++;
      }
    const kp = cumulative(cp, pairsP);
    const kn = cumulative(cn, pairsN);
    return kp.map((v, s) => v - kn[s]);
  };
  for (let a = 0; a < m; a++) isP[a] = a < P.length ? 1 : 0;
  const dObs = dOf();
  const labels = Uint8Array.from(isP);
  const order = Int32Array.from({ length: m }, (_, i) => i);
  const bCurves: Float64Array[] = [];
  for (let p = 0; p < permutations; p++) {
    shuffle(order, rand);
    for (let a = 0; a < m; a++) isP[order[a]] = labels[a];
    bCurves.push(dOf());
  }
  const bivariate = areaTest(dObs, bCurves, bh).test;

  // PathProx t: the grid point with the largest bivariate Z-score.
  let threshold: number | null = null;
  let best = -Infinity;
  for (let s = 0; s < bg.length; s++) {
    let mean = 0;
    for (const cv of bCurves) mean += cv[s];
    mean /= bCurves.length;
    let v = 0;
    for (const cv of bCurves) v += (cv[s] - mean) ** 2;
    const sd = Math.sqrt(v / Math.max(1, bCurves.length - 1));
    if (!(sd > 0)) continue;
    const z = (dObs[s] - mean) / sd;
    if (z > best) {
      best = z;
      threshold = bg[s];
    }
  }

  const scores = new Map<number, number | null>();
  for (let i = 0; i < n; i++) {
    if (threshold === null) {
      scores.set(input.residues[i], null);
      continue;
    }
    let pn = 0;
    let pk = 0;
    let nn = 0;
    let nk = 0;
    for (const j of P) if (j !== i) { pn++; if (D[i * n + j] <= threshold) pk++; }
    for (const j of N) if (j !== i) { nn++; if (D[i * n + j] <= threshold) nk++; }
    scores.set(input.residues[i], pn && nn ? pk / pn - nk / nn : null);
  }

  return {
    structureResidues: n,
    pathogenicResidues: P.length,
    neutralResidues: N.length,
    permutations,
    univariate,
    bivariate,
    clustered: univariate.p < 0.05 && univariate.area > 0 && bivariate.p < 0.05 && bivariate.area > 0,
    threshold,
    scores,
  };
}
