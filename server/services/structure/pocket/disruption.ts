import { parseAtomsFromPdb, type PdbAtom } from "../pdb-parser.ts";
import { PACKING_NEIGHBOUR_BANDS } from "../../../../src/shared/burialEvidence.ts";
import { executeSasaEval } from "../sasa-runner.ts";
import { evaluateDisruptionRules } from "./disruption-rules.ts";

export interface DisruptionPrediction {
  structureLabel?: string;
  level: "high" | "low" | "unknown";
  reason: string;
  /**
   * pLDDT of the target Cα — ONLY when the structure is an AlphaFold model. For a crystal structure
   * the B column is a temperature factor, and it used to be returned here: NAE1 p.Asp116Gly showed
   * "pLDDT 94.5 (Very High)" for 1YOV's B-factor, and the Energetics consensus down-weighted FoldX
   * for every crystal residue whose B-factor was under 70 Å².
   */
  plddt: number | null;
  /** The target Cα's raw B column and what it holds. */
  bFactor?: number | null;
  bFactorKind?: "plddt" | "temperature-factor" | "unknown";
  burialStatus?: "core" | "surface" | "boundary";
  neighborCount?: number;
  sasa?: number;
  rsa?: number;
  /** Why accessibility was not measured. The step used to fail silently to "no value". */
  sasaUnavailableReason?: string;
}

interface StructRange {
  chain: string;
  start: number;
  end: number;
  type: "helix" | "sheet";
}

export async function runSasaEval(
  wtPdbText: string,
  chain: string,
  position: number
): Promise<{ sasa: number; rsa: number; burialStatus: "core" | "surface" | "boundary" } | { error: string }> {
  const result = await executeSasaEval(wtPdbText, chain, position);
  if (result.status === "success") {
    return {
      sasa: result.sasa,
      rsa: result.rsa,
      burialStatus: result.burialStatus
    };
  }
  return { error: result.message };
}

function extractFirstModel(wtPdbText: string): { lines: string[]; firstModelPdb: string } {
  const rawLines = wtPdbText.split(/\r?\n/);
  const endMdlIdx = rawLines.findIndex(l => l.startsWith("ENDMDL"));
  const lines = endMdlIdx >= 0 ? rawLines.slice(0, endMdlIdx) : rawLines;
  const firstModelPdb = endMdlIdx >= 0 ? lines.join("\n") : wtPdbText;
  return { lines, firstModelPdb };
}

function parseSecondaryStructureRanges(lines: string[]): StructRange[] {
  const structures: StructRange[] = [];
  for (const line of lines) {
    if (line.startsWith("HELIX")) {
      const initChain = line.slice(19, 20).trim();
      const initSeq = parseInt(line.slice(21, 25).trim(), 10);
      const endSeq = parseInt(line.slice(33, 37).trim(), 10);
      if (!isNaN(initSeq) && !isNaN(endSeq)) {
        structures.push({ chain: initChain, start: initSeq, end: endSeq, type: "helix" });
      }
    } else if (line.startsWith("SHEET")) {
      const initChain = line.slice(21, 22).trim();
      const initSeq = parseInt(line.slice(22, 26).trim(), 10);
      const endSeq = parseInt(line.slice(33, 37).trim(), 10);
      if (!isNaN(initSeq) && !isNaN(endSeq)) {
        structures.push({ chain: initChain, start: initSeq, end: endSeq, type: "sheet" });
      }
    }
  }
  return structures;
}

function resolveTargetResidueAtoms(
  atoms: PdbAtom[],
  position: number,
  chain?: string
): { resolvedChain: string | undefined; targetAtoms: PdbAtom[] } {
  let resolvedChain = chain;
  if (!resolvedChain) {
    const matching = atoms.find(a => a.resSeq === position);
    if (matching) resolvedChain = matching.chain;
  }
  const targetAtoms = atoms.filter(a => a.resSeq === position && (resolvedChain === undefined || a.chain === resolvedChain));
  return { resolvedChain, targetAtoms };
}

function readCaBFactor(lines: string[], position: number, resolvedChain: string | undefined): number | null {
  for (const line of lines) {
    if (!line.startsWith("ATOM") && !line.startsWith("HETATM")) continue;
    const atomName = line.slice(12, 16).trim();
    const c = line.slice(21, 22).trim();
    const resSeqVal = parseInt(line.slice(22, 26).trim(), 10);
    if (atomName === "CA" && resSeqVal === position && (resolvedChain === undefined || c === resolvedChain)) {
      const bVal = parseFloat(line.slice(60, 66).trim());
      if (!isNaN(bVal)) return bVal;
    }
  }
  return null;
}

function classifyBFactorKind(structureSource?: "alphafold" | "experimental"): "plddt" | "temperature-factor" | "unknown" {
  if (structureSource === "alphafold") return "plddt";
  if (structureSource === "experimental") return "temperature-factor";
  return "unknown";
}

function classifySecondaryStructure(
  structures: StructRange[],
  atoms: PdbAtom[],
  position: number,
  resolvedChain: string | undefined
): "helix" | "sheet" | "loop" {
  const targetStruct = structures.find(s =>
    (resolvedChain === undefined || s.chain === resolvedChain) &&
    position >= s.start && position <= s.end
  );
  if (targetStruct) return targetStruct.type;

  if (structures.length === 0) {
    // Dihedral angle/distance geometry estimation fallback for AlphaFold PDBs lacking HELIX/SHEET headers (P1-3)
    const targetCaChain = resolvedChain || "A";
    const ca0 = atoms.find(a => a.chain === targetCaChain && a.resSeq === position - 1 && a.name === "CA");
    const ca3 = atoms.find(a => a.chain === targetCaChain && a.resSeq === position + 2 && a.name === "CA");
    if (ca0 && ca3) {
      const dist = Math.sqrt(Math.pow(ca3.x - ca0.x, 2) + Math.pow(ca3.y - ca0.y, 2) + Math.pow(ca3.z - ca0.z, 2));
      if (dist < 6.2) return "helix";
      if (dist > 9.5) return "sheet";
    }
  }
  return "loop";
}

function countPackingNeighbors(
  atoms: PdbAtom[],
  targetCa: PdbAtom,
  position: number,
  resolvedChain: string | undefined
): number {
  let neighborCount = 0;
  for (const a of atoms) {
    if (a.name === "CA" && (a.resSeq !== position || a.chain !== resolvedChain)) {
      const dist = Math.sqrt(Math.pow(a.x - targetCa.x, 2) + Math.pow(a.y - targetCa.y, 2) + Math.pow(a.z - targetCa.z, 2));
      // The radius is the shared constant the client's meter and tick labels use, so the count
      // and the shell it is described as cannot drift apart.
      if (dist <= PACKING_NEIGHBOUR_BANDS.radiusAngstrom) {
        neighborCount++;
      }
    }
  }
  return neighborCount;
}

async function measureAccessibility(
  firstModelPdb: string,
  chain: string,
  position: number
): Promise<{
  burialStatus?: "core" | "surface" | "boundary";
  sasa?: number;
  rsa?: number;
  sasaUnavailableReason?: string;
}> {
  const sasaRun = await runSasaEval(firstModelPdb, chain, position);
  if ("error" in sasaRun) {
    return { sasaUnavailableReason: sasaRun.error };
  }
  return {
    burialStatus: sasaRun.burialStatus,
    sasa: sasaRun.sasa,
    rsa: sasaRun.rsa
  };
}

export async function predictStructuralDisruption(
  wtPdbText: string,
  wtResidue1: string,
  position: number,
  mutantResidue1: string,
  chain?: string,
  /**
   * Where `wtPdbText` came from. The B column's meaning follows from it: pLDDT for an AlphaFold model,
   * a temperature factor for an experimental entry. Omitted (older callers, fixtures): the column is
   * reported as `plddt`, as before, with `bFactorKind: "unknown"`.
   */
  structureSource?: "alphafold" | "experimental"
): Promise<DisruptionPrediction> {
  const { lines, firstModelPdb } = extractFirstModel(wtPdbText);
  const structures = parseSecondaryStructureRanges(lines);
  const atoms = parseAtomsFromPdb(firstModelPdb);
  const { resolvedChain, targetAtoms } = resolveTargetResidueAtoms(atoms, position, chain);
  if (targetAtoms.length === 0) {
    // No burial word and no count: the residue was never located, so nothing was measured.
    return { level: "unknown", reason: "Target residue not found in structure.", plddt: null };
  }

  const caBFactor = readCaBFactor(lines, position, resolvedChain);
  const bFactorKind = classifyBFactorKind(structureSource);
  const plddt = bFactorKind === "temperature-factor" ? null : caBFactor;
  const secStruct = classifySecondaryStructure(structures, atoms, position, resolvedChain);
  const targetCa = targetAtoms.find(a => a.name === "CA") || targetAtoms[0];
  const neighborCount = countPackingNeighbors(atoms, targetCa, position, resolvedChain);

  /*
   * Burial is reported only from a measured accessible surface. The packing fallback banded a
   * Cα count against unsourced cut-points (≥ 15 core, ≤ 7 surface) that called most exposed
   * residues "boundary"; the count is still returned as a reading, never as a word.
   */
  const { burialStatus, sasa, rsa, sasaUnavailableReason } = await measureAccessibility(firstModelPdb, resolvedChain || "A", position);
  const { level, reason } = evaluateDisruptionRules(
    wtResidue1.toUpperCase(),
    mutantResidue1.toUpperCase(),
    position,
    secStruct,
    burialStatus === "core"
  );

  return {
    level,
    reason,
    plddt,
    bFactor: caBFactor,
    bFactorKind,
    burialStatus,
    neighborCount,
    sasa,
    rsa,
    ...(sasaUnavailableReason ? { sasaUnavailableReason } : {})
  };
}
