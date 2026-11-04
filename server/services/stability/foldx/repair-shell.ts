/**
 * repair-shell.ts — which residues the local ("fix-shell") repair may move, and the file FoldX needs for it.
 *
 * FoldX `RepairPDB --fix-residues-file=fix.txt` repairs the whole structure but keeps the residues listed
 * in `fix.txt` where they are. So the file lists every residue we do NOT want to move: the complement of
 * the region around the variant. (`--mutate-residues-file`, the obvious flag for this, switches FoldX 5.1
 * onto a different, simplified repair routine even when it is given every residue. It gave answers up to
 * 0.73 kcal/mol away from RepairPDB, so it is not used. See doc/FOLDX_LOCAL_SHELL_BENCH_2026-11-02.md.)
 *
 * The region that may move is:
 *   1. every residue that has a heavy atom within 15 Å of a heavy atom of the variant residue, and the
 *      residues just before and after the variant in the sequence; and
 *   2. when that region has fewer than 25 residues (a loose or disordered segment, where few residues are
 *      close in space), every residue of the same chain within 14 residue numbers of the variant.
 *
 * The rule is identical on every machine and is the whole definition of the `fix-shell:r15-seq14:v1` mode:
 * change any number here and the mode id in `src/shared/foldxRepairMode.ts` must change with it.
 */
import { AMINO_ACID_3_TO_1 } from "../../../../src/shared/aminoAcids.ts";
import {
  FIX_SHELL_MIN_SPHERE,
  FIX_SHELL_RADIUS_A,
  FIX_SHELL_SEQUENCE_BUFFER
} from "../../../../src/shared/foldxRepairMode.ts";

export interface FixShellTarget {
  chain: string;
  resSeq: number;
  insCode: string;
}

/** What the plan came to, kept in the result so a reader can see how much was allowed to move. */
export interface FixShellSummary {
  radiusA: number;
  sequenceBuffer: number;
  /** Residues in the sphere (plus the variant's sequence neighbours), before any sequence buffer. */
  sphereResidues: number;
  /** Residues FoldX may move. */
  movableResidues: number;
  totalResidues: number;
  /** True when the sphere was small and the sequence buffer was added. */
  sequenceBufferApplied: boolean;
}

export interface FixShellPlan {
  summary: FixShellSummary;
  /** Content of `fix.txt` ("MA1,IA2,...;"), or null when nothing is left to fix (everything may move). */
  fixResiduesFile: string | null;
}

interface Residue {
  id: string;
  chain: string;
  resSeq: number;
  insCode: string;
  resName: string;
  /** x, y, z of each heavy atom, flat. */
  xyz: number[];
}

function readResidues(cleanedPdb: string): Residue[] {
  const byId = new Map<string, Residue>();
  for (const line of cleanedPdb.split(/\r?\n/)) {
    if (!line.startsWith("ATOM")) continue;
    const atomName = line.slice(12, 16).trim().toUpperCase();
    if (atomName.startsWith("H")) continue; // heavy atoms only
    const chain = line[21] ?? " ";
    const resSeq = parseInt(line.slice(22, 26), 10);
    const x = parseFloat(line.slice(30, 38));
    const y = parseFloat(line.slice(38, 46));
    const z = parseFloat(line.slice(46, 54));
    if (!Number.isFinite(resSeq) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const insCode = (line[26] ?? " ").trim();
    const id = `${chain}${resSeq}${insCode}`;
    let residue = byId.get(id);
    if (!residue) {
      residue = { id, chain, resSeq, insCode, resName: line.slice(17, 20).trim().toUpperCase(), xyz: [] };
      byId.set(id, residue);
    }
    residue.xyz.push(x, y, z);
  }
  return [...byId.values()];
}

/**
 * The region around `target` that may move, and the `fix.txt` for everything else. Null when `target` has
 * no heavy atoms in `cleanedPdb` (the caller has already checked that the residue exists).
 */
export function planFixShell(cleanedPdb: string, target: FixShellTarget): FixShellPlan | null {
  const residues = readResidues(cleanedPdb);
  const variant = residues.find(r => r.chain === target.chain && r.resSeq === target.resSeq && r.insCode === target.insCode);
  if (!variant) return null;

  const limit2 = FIX_SHELL_RADIUS_A * FIX_SHELL_RADIUS_A;
  const near = (r: Residue): boolean => {
    for (let i = 0; i < r.xyz.length; i += 3) {
      for (let j = 0; j < variant.xyz.length; j += 3) {
        const dx = r.xyz[i] - variant.xyz[j];
        const dy = r.xyz[i + 1] - variant.xyz[j + 1];
        const dz = r.xyz[i + 2] - variant.xyz[j + 2];
        if (dx * dx + dy * dy + dz * dz <= limit2) return true;
      }
    }
    return false;
  };

  const movable = new Set<string>();
  for (const r of residues) {
    const neighbourInSequence = r.chain === variant.chain && Math.abs(r.resSeq - variant.resSeq) <= 1;
    if (neighbourInSequence || near(r)) movable.add(r.id);
  }
  const sphereResidues = movable.size;

  const sequenceBufferApplied = sphereResidues < FIX_SHELL_MIN_SPHERE;
  if (sequenceBufferApplied) {
    for (const r of residues) {
      if (r.chain === variant.chain && Math.abs(r.resSeq - variant.resSeq) <= FIX_SHELL_SEQUENCE_BUFFER) movable.add(r.id);
    }
  }

  // A residue FoldX has no one-letter code for cannot be named in the file, so it is left free to move.
  const fixed = residues
    .filter(r => !movable.has(r.id) && AMINO_ACID_3_TO_1[r.resName])
    .map(r => `${AMINO_ACID_3_TO_1[r.resName]}${r.id}`);

  return {
    summary: {
      radiusA: FIX_SHELL_RADIUS_A,
      sequenceBuffer: FIX_SHELL_SEQUENCE_BUFFER,
      sphereResidues,
      movableResidues: movable.size,
      totalResidues: residues.length,
      sequenceBufferApplied
    },
    fixResiduesFile: fixed.length > 0 ? `${fixed.join(",")};` : null
  };
}
