import { computeStructuralDiff, alignMutantToWt } from "../services/structural-diff.ts";
import { spatialClustering } from "../../src/shared/spatialClustering.ts";

export async function runComputeStructuralDiff({
  wtPdb,
  mutPdb,
  pos,
  chain
}: {
  wtPdb: string;
  mutPdb: string;
  pos: number;
  chain: string;
}) {
  return computeStructuralDiff(wtPdb, mutPdb, pos, chain);
}

export async function runAlignMutantToWt({
  wtPdb,
  mutPdb,
  pos,
  chain,
  alignmentScope
}: {
  wtPdb: string;
  mutPdb: string;
  pos: number;
  chain: string;
  alignmentScope?: "local" | "global";
}) {
  return alignMutantToWt(wtPdb, mutPdb, pos, chain, alignmentScope);
}

/**
 * The Hotspots view's 3D reading (Sivley et al. 2018), off the event loop: SCN1A's 1,236 confident
 * residues take about 5 s of permutations. Returns plain arrays (a Map does not cross the thread).
 */
export async function runSpatialClustering(input: { residues: number[]; coords: number[]; pathogenic: number[]; neutral: number[] }) {
  const result = spatialClustering(input);
  if (!result) return null;
  const scores = [...result.scores].filter((e): e is [number, number] => e[1] !== null);
  // Leave-residue-out self-check in this gene: P/LP residues against gnomAD-only residues.
  const P = new Set(input.pathogenic);
  const pos = scores.filter(([r]) => P.has(r)).map(([, v]) => v);
  const neg = scores.filter(([r]) => !P.has(r) && input.neutral.includes(r)).map(([, v]) => v);
  return { ...result, scores, selfCheck: pos.length && neg.length ? { auroc: aurocOf(pos, neg), pathogenic: pos.length, neutral: neg.length } : null };
}

/** Mann-Whitney AUROC, ties count one half (the benchmark's definition). */
function aurocOf(pos: number[], neg: number[]): number {
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
