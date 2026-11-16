const POSITIVE_RESIDUES = new Set(["R", "K", "H"]);
const NEGATIVE_RESIDUES = new Set(["D", "E"]);
const CHARGED_RESIDUES = new Set(["R", "K", "H", "D", "E"]);
const HYDROPHOBIC_RESIDUES = new Set(["A", "V", "I", "L", "M", "F", "Y", "W"]);

// Standard residue volumes (in Å³) sourced from Zamyatnin (1972) / Pontius (1996) (C-3)
// Threshold of 100 Å³ for core steric expansion corresponds to a size transition of at least 3-4 carbon atoms
// (e.g., Gly to Phe/Tyr/Trp), which is well-documented to cause steric clashes in packed hydrophobic protein cores.
const AA_VOLUMES: Record<string, number> = {
  G: 60.1, A: 88.6, S: 89.0, C: 108.5, D: 111.1, P: 112.7, N: 114.1, T: 116.1, E: 138.4, Q: 143.9,
  H: 153.2, V: 140.0, M: 162.9, I: 166.7, L: 166.7, K: 168.6, R: 173.4, F: 189.9, Y: 193.6, W: 227.8
};

function evaluateBuriedChargeRule(wt: string, mut: string, position: number): { level: "high"; reason: string } | null {
  if ((POSITIVE_RESIDUES.has(wt) && NEGATIVE_RESIDUES.has(mut)) || (NEGATIVE_RESIDUES.has(wt) && POSITIVE_RESIDUES.has(mut))) {
    return {
      level: "high",
      reason: `Buried charge reversal (${wt} to ${mut} at position ${position}) in hydrophobic core, expected to cause electrostatic repulsion and destabilization.`
    };
  }
  if (CHARGED_RESIDUES.has(wt) && HYDROPHOBIC_RESIDUES.has(mut)) {
    return {
      level: "high",
      reason: `Loss of charge (${wt} to ${mut} at position ${position}) in packed pocket, expected to break salt bridges or hydrogen bonds.`
    };
  }
  return null;
}

function evaluateCoreVolumeRule(wt: string, mut: string, position: number): { level: "high"; reason: string } | null {
  const volWt = AA_VOLUMES[wt];
  const volMut = AA_VOLUMES[mut];
  if (volWt !== undefined && volMut !== undefined) {
    const volDelta = volMut - volWt;
    if (volDelta > 100) {
      return {
        level: "high",
        reason: `Severe core steric expansion (volume increase of +${volDelta.toFixed(1)} Å³ from ${wt} to ${mut} at position ${position}), expected to cause steric clashes in the packed hydrophobic core.`
      };
    }
  }
  return null;
}

export function evaluateDisruptionRules(
  wt: string,
  mut: string,
  position: number,
  secStruct: "helix" | "sheet" | "loop",
  isBuried: boolean
): { level: "high" | "low"; reason: string } {
  // Rule A: Proline introduced into helix/sheet
  if (mut === "P" && secStruct !== "loop") {
    return {
      level: "high",
      reason: `Proline introduced at position ${position} which lies within a secondary structure element (${secStruct}), expected to disrupt the local backbone conformation.`
    };
  }

  // Rule B & C: Charge swap or core volume increase delta V > 100 Å^3 in a buried core
  if (isBuried) {
    const chargeHit = evaluateBuriedChargeRule(wt, mut, position);
    if (chargeHit) return chargeHit;
    const volumeHit = evaluateCoreVolumeRule(wt, mut, position);
    if (volumeHit) return volumeHit;
  }

  // Rule D: Proline to glycine loop-flexibility shift
  if (secStruct === "loop" && wt === "P" && mut === "G") {
    return {
      level: "high",
      reason: "Proline to Glycine substitution in structural loop, expected to introduce extreme local backbone flexibility and destabilize the loop trajectory."
    };
  }

  return {
    level: "low",
    reason: "Substitution is predicted to have low conformational disruption on the backbone fold."
  };
}
