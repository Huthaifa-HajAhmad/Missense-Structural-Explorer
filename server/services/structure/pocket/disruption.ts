import { parseAtomsFromPdb } from "../pdb-parser.ts";
import { PACKING_NEIGHBOUR_BANDS } from "../../../../src/shared/burialEvidence.ts";
import { executeSasaEval } from "../sasa-runner.ts";

export interface DisruptionPrediction {
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
  const lines = wtPdbText.split(/\r?\n/);
  
  // 1. Parse HELIX and SHEET lines
  interface StructRange {
    chain: string;
    start: number;
    end: number;
    type: "helix" | "sheet";
  }
  const structures: StructRange[] = [];
  
  for (const line of lines) {
    if (line.startsWith("HELIX")) {
      const initChain = line.slice(19, 20).trim();
      const initSeq = parseInt(line.slice(21, 25).trim(), 10);
      const endChain = line.slice(31, 32).trim();
      const endSeq = parseInt(line.slice(33, 37).trim(), 10);
      if (!isNaN(initSeq) && !isNaN(endSeq)) {
        structures.push({ chain: initChain, start: initSeq, end: endSeq, type: "helix" });
      }
    } else if (line.startsWith("SHEET")) {
      const initChain = line.slice(21, 22).trim();
      const initSeq = parseInt(line.slice(22, 26).trim(), 10);
      const endChain = line.slice(32, 33).trim();
      const endSeq = parseInt(line.slice(33, 37).trim(), 10);
      if (!isNaN(initSeq) && !isNaN(endSeq)) {
        structures.push({ chain: initChain, start: initSeq, end: endSeq, type: "sheet" });
      }
    }
  }

  // 2. Parse atoms of target residue to get pLDDT and compute neighbor count (burial status)
  const atoms = parseAtomsFromPdb(wtPdbText);
  let resolvedChain = chain;
  if (!resolvedChain) {
    const matching = atoms.find(a => a.resSeq === position);
    if (matching) resolvedChain = matching.chain;
  }

  const targetAtoms = atoms.filter(a => a.resSeq === position && (resolvedChain === undefined || a.chain === resolvedChain));
  if (targetAtoms.length === 0) {
    // No burial word and no count: the residue was never located, so nothing was measured.
    return { level: "unknown", reason: "Target residue not found in structure.", plddt: null };
  }

  let caBFactor: number | null = null;
  for (const line of lines) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const atomName = line.slice(12, 16).trim();
      const c = line.slice(21, 22).trim();
      const resSeqVal = parseInt(line.slice(22, 26).trim(), 10);
      if (atomName === "CA" && resSeqVal === position && (resolvedChain === undefined || c === resolvedChain)) {
        const bFactorStr = line.slice(60, 66).trim();
        const bVal = parseFloat(bFactorStr);
        if (!isNaN(bVal)) {
          caBFactor = bVal;
          break;
        }
      }
    }
  }

  const bFactorKind: "plddt" | "temperature-factor" | "unknown" =
    structureSource === "alphafold" ? "plddt" : structureSource === "experimental" ? "temperature-factor" : "unknown";
  const plddt = bFactorKind === "temperature-factor" ? null : caBFactor;

  const targetStruct = structures.find(s => 
    (resolvedChain === undefined || s.chain === resolvedChain) && 
    position >= s.start && position <= s.end
  );

  let secStruct: "helix" | "sheet" | "loop" = "loop";
  if (targetStruct) {
    secStruct = targetStruct.type;
  } else if (structures.length === 0) {
    // Dihedral angle/distance geometry estimation fallback for AlphaFold PDBs lacking HELIX/SHEET headers (P1-3)
    const targetCaChain = resolvedChain || "A";
    const ca0 = atoms.find(a => a.chain === targetCaChain && a.resSeq === position - 1 && a.name === "CA");
    const ca3 = atoms.find(a => a.chain === targetCaChain && a.resSeq === position + 2 && a.name === "CA");
    if (ca0 && ca3) {
      const dist = Math.sqrt(Math.pow(ca3.x - ca0.x, 2) + Math.pow(ca3.y - ca0.y, 2) + Math.pow(ca3.z - ca0.z, 2));
      if (dist < 6.2) secStruct = "helix";
      else if (dist > 9.5) secStruct = "sheet";
    }
  }

  const targetCa = targetAtoms.find(a => a.name === "CA") || targetAtoms[0];
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
  // 3. Compute true SASA and RSA using the sidecar script
  const sasaRun = await runSasaEval(wtPdbText, resolvedChain || "A", position);
  const sasaResult = "error" in sasaRun ? null : sasaRun;
  const sasaUnavailableReason = "error" in sasaRun ? sasaRun.error : undefined;

  /*
   * Burial is reported only from a measured accessible surface. The packing fallback banded a
   * Cα count against unsourced cut-points (≥ 15 core, ≤ 7 surface) that called most exposed
   * residues "boundary"; the count is still returned as a reading, never as a word.
   */
  const burialStatus = sasaResult ? sasaResult.burialStatus : undefined;
  const rsa = sasaResult ? sasaResult.rsa : undefined;
  const sasa = sasaResult ? sasaResult.sasa : undefined;
  const isBuried = burialStatus === "core";

  const buildResult = (level: "high" | "low" | "unknown", reason: string): DisruptionPrediction => {
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
  };

  const wt = wtResidue1.toUpperCase();
  const mut = mutantResidue1.toUpperCase();

  // Rule A: Proline introduced into helix/sheet
  if (mut === "P" && (secStruct === "helix" || secStruct === "sheet")) {
    return buildResult("high", `Proline introduced at position ${position} which lies within a secondary structure element (${secStruct}), expected to disrupt the local backbone conformation.`);
  }

  // Rule B: Charge swap in a buried core
  const positive = new Set(["R", "K", "H"]);
  const negative = new Set(["D", "E"]);
  const charged = new Set(["R", "K", "H", "D", "E"]);
  const hydrophobic = new Set(["A", "V", "I", "L", "M", "F", "Y", "W"]);

  if (isBuried) {
    if ((positive.has(wt) && negative.has(mut)) || (negative.has(wt) && positive.has(mut))) {
      return buildResult("high", `Buried charge reversal (${wt} to ${mut} at position ${position}) in hydrophobic core, expected to cause electrostatic repulsion and destabilization.`);
    }
    if (charged.has(wt) && hydrophobic.has(mut)) {
      return buildResult("high", `Loss of charge (${wt} to ${mut} at position ${position}) in packed pocket, expected to break salt bridges or hydrogen bonds.`);
    }
  }

  // Rule C: Core volume increase delta V > 100 Å^3
  // Standard residue volumes (in Å³) sourced from Zamyatnin (1972) / Pontius (1996) (C-3)
  // Threshold of 100 Å³ for core steric expansion corresponds to a size transition of at least 3-4 carbon atoms 
  // (e.g., Gly to Phe/Tyr/Trp), which is well-documented to cause steric clashes in packed hydrophobic protein cores.
  const aaVolumes: Record<string, number> = {
    G: 60.1, A: 88.6, S: 89.0, C: 108.5, D: 111.1, P: 112.7, N: 114.1, T: 116.1, E: 138.4, Q: 143.9, 
    H: 153.2, V: 140.0, M: 162.9, I: 166.7, L: 166.7, K: 168.6, R: 173.4, F: 189.9, Y: 193.6, W: 227.8
  };
  const volWt = aaVolumes[wt] || 120;
  const volMut = aaVolumes[mut] || 120;
  const volDelta = volMut - volWt;
  if (isBuried && volDelta > 100) {
    return buildResult("high", `Severe core steric expansion (volume increase of +${volDelta.toFixed(1)} Å³ from ${wt} to ${mut} at position ${position}), expected to cause steric clashes in the packed hydrophobic core.`);
  }

  // Rule D: Proline to glycine loop-flexibility shift
  if (secStruct === "loop" && wt === "P" && mut === "G") {
    return buildResult("high", `Proline to Glycine substitution in structural loop, expected to introduce extreme local backbone flexibility and destabilize the loop trajectory.`);
  }

  return buildResult("low", `Substitution is predicted to have low conformational disruption on the backbone fold.`);
}
