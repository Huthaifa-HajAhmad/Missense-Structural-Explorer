import { computeStructuralDiff, alignMutantToWt } from "../services/structural-diff.ts";

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
