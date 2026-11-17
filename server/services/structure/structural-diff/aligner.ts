/**
 * aligner.ts — Structural superposition, RMSD calculation and PDB coordinate transformation
 */
import { type PdbAtom, parseAtomsFromPdbMaybeAsync } from "../pdb-parser.ts";
import { LOCAL_ALIGNMENT_FIT_WINDOW, LOCAL_STRUCTURAL_WINDOW } from "../../../../src/shared/thresholds.ts";
import { transpose3x3, getKabschTransform } from "./geometry.ts";
import { calculateClashes, calculateLocalSidechainRmsd } from "./contacts.ts";
import {
  type Displacement,
  type PartnerChange,
  applyFit,
  squaredDistance,
  measureFitDeviations,
  transformMutantPdb,
  secondaryMetrics
} from "./alignment-metrics.ts";

export interface StructuralDiffResult {
  rmsd: number;
  localRmsd: number | null;
  windowDisplacements: { resSeq: number; resName: string; displacement: number }[];
  clashes: {
    wtClashCount: number;
    mutClashCount: number;
    diff: number;
  };
}

export function matchCaPairs(wtCas: PdbAtom[], mutCas: PdbAtom[]): { matchedWt: PdbAtom[]; matchedMut: PdbAtom[] } {
  // Strategy 1: Exact match by resSeq AND chain
  let matchedWt: PdbAtom[] = [];
  let matchedMut: PdbAtom[] = [];

  for (const wtCa of wtCas) {
    const mutCa = mutCas.find(a => a.resSeq === wtCa.resSeq && a.chain === wtCa.chain);
    if (mutCa) {
      matchedWt.push(wtCa);
      matchedMut.push(mutCa);
    }
  }

  if (matchedWt.length >= 3) {
    return { matchedWt, matchedMut };
  }

  // Strategy 2: Match by resSeq across primary protein chains (ignoring chain identifier differences e.g. A vs E or blank)
  matchedWt = [];
  matchedMut = [];
  const usedMutIndices = new Set<number>();

  for (const wtCa of wtCas) {
    const mutIdx = mutCas.findIndex((a, idx) => !usedMutIndices.has(idx) && a.resSeq === wtCa.resSeq);
    if (mutIdx !== -1) {
      usedMutIndices.add(mutIdx);
      matchedWt.push(wtCa);
      matchedMut.push(mutCas[mutIdx]);
    }
  }

  if (matchedWt.length >= 3) {
    return { matchedWt, matchedMut };
  }

  // Strategy 3: Sequential index matching (for structures with shifted or renumbered residue sequences)
  matchedWt = [];
  matchedMut = [];
  const minLen = Math.min(wtCas.length, mutCas.length);
  for (let i = 0; i < minLen; i++) {
    matchedWt.push(wtCas[i]);
    matchedMut.push(mutCas[i]);
  }

  return { matchedWt, matchedMut };
}

function matchedCaPairsOrThrow(wtAtoms: PdbAtom[], mutAtoms: PdbAtom[]) {
  const pairs = matchCaPairs(wtAtoms.filter(a => a.name === "CA"), mutAtoms.filter(a => a.name === "CA"));
  if (pairs.matchedWt.length === 0) {
    throw new Error("No matching CA atoms found between WT and mutant structures for alignment.");
  }
  return pairs;
}

export async function computeStructuralDiff(
  wtPdb: string,
  mutPdb: string,
  pos: number,
  chain: string
): Promise<StructuralDiffResult> {
  const wtAtoms = await parseAtomsFromPdbMaybeAsync(wtPdb);
  const mutAtoms = await parseAtomsFromPdbMaybeAsync(mutPdb);
  const { matchedWt, matchedMut } = matchedCaPairsOrThrow(wtAtoms, mutAtoms);
  const n = matchedWt.length;

  const { R, centroidRef: centroidWt, centroidTarget: centroidMut } = getKabschTransform(matchedWt, matchedMut);
  const fitted = (i: number) => applyFit(R, matchedWt[i], centroidWt, centroidMut);

  let sumSqDist = 0;
  for (let i = 0; i < n; i++) {
    sumSqDist += squaredDistance(fitted(i), matchedMut[i]);
  }
  const rmsd = Math.sqrt(sumSqDist / n);

  const windowDisplacements: Displacement[] = [];
  for (let r = pos - LOCAL_STRUCTURAL_WINDOW; r <= pos + LOCAL_STRUCTURAL_WINDOW; r++) {
    const idx = matchedWt.findIndex(a => a.resSeq === r && a.chain === chain);
    if (idx !== -1) {
      const dist = Math.sqrt(squaredDistance(fitted(idx), matchedMut[idx]));
      windowDisplacements.push({ resSeq: r, resName: matchedWt[idx].resName, displacement: parseFloat(dist.toFixed(4)) });
    }
  }

  // Let other requests run between the heavy steps.
  const yieldToEventLoop = () => new Promise<void>(resolve => setImmediate(resolve));
  await yieldToEventLoop();
  const localRmsd = calculateLocalSidechainRmsd(wtAtoms, mutAtoms, pos, chain);
  await yieldToEventLoop();
  const wtClashes = calculateClashes(wtAtoms);
  await yieldToEventLoop();
  const mutClashes = calculateClashes(mutAtoms);

  return {
    rmsd: parseFloat(rmsd.toFixed(4)),
    localRmsd,
    windowDisplacements,
    clashes: {
      wtClashCount: wtClashes,
      mutClashCount: mutClashes,
      diff: mutClashes - wtClashes
    }
  };
}

export interface AlignedStructuralDiffResult {
  alignedMutPdb: string;
  globalRmsd: number;
  localWindowRmsd: number;
  windowRadius: number;
  alignmentScope?: "local" | "global";
  displacements: Displacement[];
  lostContacts: number;
  gainedContacts: number;
  contactChanges: PartnerChange[];
  lostHBonds: number;
  gainedHBonds: number;
  hBondChanges: PartnerChange[];
  wtSasa: number;
  mutSasa: number;
  sasaChange: number;
  wtChi1: number | null;
  mutChi1: number | null;
  chi1Deviation: number | null;
}

/**
 * The CA pairs the rotation is fitted on. A local request fits the pocket window only, and only
 * when it holds at least 4 pairs; otherwise the whole chain is used. The metrics must report
 * the fit actually applied, not the one requested.
 */
function selectFitPairs(
  matchedWt: PdbAtom[],
  matchedMut: PdbAtom[],
  pos: number,
  requestedScope: "local" | "global"
): { fitWt: PdbAtom[]; fitMut: PdbAtom[]; appliedScope: "local" | "global" } {
  if (requestedScope === "local") {
    // Shared with the 3D view, which states the fitted window beside the RMSD it produces.
    const localIndices: number[] = [];
    for (let i = 0; i < matchedWt.length; i++) {
      if (Math.abs(matchedWt[i].resSeq - pos) <= LOCAL_ALIGNMENT_FIT_WINDOW) localIndices.push(i);
    }
    if (localIndices.length >= 4) {
      return {
        fitWt: localIndices.map(i => matchedWt[i]),
        fitMut: localIndices.map(i => matchedMut[i]),
        appliedScope: "local"
      };
    }
  }
  return { fitWt: matchedWt, fitMut: matchedMut, appliedScope: "global" };
}

export async function alignMutantToWt(
  wtPdb: string,
  mutPdb: string,
  pos: number,
  chain: string,
  alignmentScope: "local" | "global" = "local"
): Promise<AlignedStructuralDiffResult> {
  const wtAtoms = await parseAtomsFromPdbMaybeAsync(wtPdb);
  const mutAtoms = await parseAtomsFromPdbMaybeAsync(mutPdb);
  const { matchedWt, matchedMut } = matchedCaPairsOrThrow(wtAtoms, mutAtoms);

  const { fitWt, fitMut, appliedScope } = selectFitPairs(matchedWt, matchedMut, pos, alignmentScope);
  const { R, centroidRef: centroidWt, centroidTarget: centroidMut } = getKabschTransform(fitWt, fitMut);
  const inverseR = transpose3x3(R); // maps mutant -> WT frame

  const { globalRmsd, localWindowRmsd, displacements, displacementByResidue } =
    measureFitDeviations(matchedWt, matchedMut, pos, inverseR, centroidWt, centroidMut);
  const alignedMutPdb = transformMutantPdb(mutPdb, inverseR, centroidMut, centroidWt, displacementByResidue);

  // Dynamic chain detection for WT and mutant models
  const wtCas = wtAtoms.filter(a => a.name === "CA");
  const mutCas = mutAtoms.filter(a => a.name === "CA");
  const wtChain = wtCas.find(a => a.resSeq === pos)?.chain || (wtCas[0]?.chain ?? chain);
  const mutChain = mutCas.find(a => a.resSeq === pos)?.chain || (mutCas[0]?.chain ?? wtChain);

  return {
    alignedMutPdb,
    globalRmsd: parseFloat(globalRmsd.toFixed(4)),
    localWindowRmsd: parseFloat(localWindowRmsd.toFixed(4)),
    windowRadius: LOCAL_STRUCTURAL_WINDOW,
    alignmentScope: appliedScope,
    displacements,
    ...secondaryMetrics(wtAtoms, mutAtoms, pos, wtChain, mutChain)
  };
}
