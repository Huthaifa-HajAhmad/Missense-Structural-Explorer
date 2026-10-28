export function detectBFactorProvenance(wtPdb: string): {
  source: "alphafold" | "experimental" | "unknown";
  semantic: "plddt" | "temperature_factor";
  inherited: boolean;
} {
  const upper = wtPdb.toUpperCase();

  /**
   * An experimental method record decides first. The old test called a file AlphaFold when it
   * contained "AF-" ANYWHERE, or when its first 100 B-factors fell in 0–100 and the text held the
   * word "MODEL" — true of nearly every crystal entry (REMARK 3 names the refinement model, and
   * crystallographic B-factors are almost always under 100). 1R3S, 1SPD, 2C9V and 4HHB all read as
   * AlphaFold, so FoldX skipped RepairPDB on X-ray templates and the tab reported "Not repaired
   * (pLDDT in B-factors)" for a crystal structure (UROD p.Gly318Arg on 1R3S:A).
   */
  if (/^EXPDTA\s+\S/m.test(upper)) {
    return { source: "experimental", semantic: "temperature_factor", inherited: true };
  }

  const isAlphaFoldHeader =
    upper.includes("ALPHAFOLD") ||
    // An AlphaFold DB accession (AF-P06132-F1), not any "AF-" substring.
    /\bAF-[A-Z0-9]+-F\d+/.test(upper) ||
    upper.includes("COMPL_MODEL") ||
    /^REMARK.*\bPLDDT\b/m.test(upper);

  if (isAlphaFoldHeader) {
    return { source: "alphafold", semantic: "plddt", inherited: true };
  }

  if (upper.includes("HEADER") || upper.includes("REMARK")) {
    return { source: "experimental", semantic: "temperature_factor", inherited: true };
  }
  
  return { source: "unknown", semantic: "temperature_factor", inherited: true };
}

export function injectBFactorsFromWtPdb(wtPdb: string, mutPdb: string): string {
  const wtLines = wtPdb.split(/\r?\n/);
  // Map key: `${atomName}_${resSeq}_${chain}` -> B-factor string (columns 61-66)
  const bFactors = new Map<string, string>();
  
  for (const line of wtLines) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const atomName = line.slice(12, 16).trim();
      const chain = line.slice(21, 22).trim();
      const resSeqStr = line.slice(22, 26).trim();
      const resSeq = parseInt(resSeqStr, 10);
      const bFactorStr = line.slice(60, 66); // columns 61-66 (0-indexed chars 60 to 66)
      if (!isNaN(resSeq) && bFactorStr) {
        const key = `${atomName}_${resSeq}_${chain}`;
        bFactors.set(key, bFactorStr);
      }
    }
  }
  
  const mutLines = mutPdb.split(/\r?\n/);
  const updatedLines = mutLines.map(line => {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const atomName = line.slice(12, 16).trim();
      const chain = line.slice(21, 22).trim();
      const resSeqStr = line.slice(22, 26).trim();
      const resSeq = parseInt(resSeqStr, 10);
      if (!isNaN(resSeq)) {
        const key = `${atomName}_${resSeq}_${chain}`;
        let bFactorStr = bFactors.get(key);
        if (!bFactorStr) {
          // Fallback to CA atom of the same residue
          const caKey = `CA_${resSeq}_${chain}`;
          bFactorStr = bFactors.get(caKey);
        }
        if (bFactorStr) {
          const paddedB = bFactorStr.trim().padStart(6, " ");
          return line.slice(0, 60) + paddedB + line.slice(66);
        }
      }
    }
    return line;
  });
  
  return updatedLines.join("\n");
}

export function cleanPdbForFoldX(pdbContent: string): string {
  const lines = pdbContent.split(/\r?\n/);
  const cleaned: string[] = [];

  for (const line of lines) {
    if (line.startsWith("ATOM")) {
      // 1. Alternate location indicator check (column 17, 0-indexed 16)
      const altLoc = line.length > 16 ? line[16] : " ";
      if (altLoc !== " " && altLoc !== "A" && altLoc !== "1") {
        continue; // Skip alternate conformer 'B', 'C', etc.
      }

      // 2. Strip hydrogen atoms (FoldX 5 internal forcefield rebuilds hydrogens)
      const atomName = line.slice(12, 16).trim();
      const element = line.length >= 78 ? line.slice(76, 78).trim().toUpperCase() : "";
      if (element === "H" || /^([1-3]?H)/i.test(atomName)) {
        continue; // Skip hydrogen atoms
      }

      // 3. Ensure valid chain ID (column 22, 0-indexed 21)
      let lineFormatted = line;
      if (lineFormatted.length > 16 && lineFormatted[16] !== " ") {
        lineFormatted = lineFormatted.slice(0, 16) + " " + lineFormatted.slice(17);
      }
      const chainChar = lineFormatted.length > 21 ? lineFormatted[21] : " ";
      if (chainChar === " ") {
        lineFormatted = lineFormatted.length >= 22
          ? lineFormatted.slice(0, 21) + "A" + lineFormatted.slice(22)
          : lineFormatted.padEnd(21, " ") + "A";
      }

      cleaned.push(lineFormatted);
    } else if (line.startsWith("TER") || line.startsWith("ENDMDL") || line.startsWith("END")) {
      cleaned.push(line);
    }
  }

  return cleaned.join("\n");
}

/** Heavy atoms beyond N, CA, C and O that a complete standard residue carries (IUPAC/PDB v3 names). */
const SIDE_CHAIN_ATOMS: Record<string, readonly string[]> = {
  ALA: ["CB"],
  ARG: ["CB", "CG", "CD", "NE", "CZ", "NH1", "NH2"],
  ASN: ["CB", "CG", "OD1", "ND2"],
  ASP: ["CB", "CG", "OD1", "OD2"],
  CYS: ["CB", "SG"],
  GLN: ["CB", "CG", "CD", "OE1", "NE2"],
  GLU: ["CB", "CG", "CD", "OE1", "OE2"],
  GLY: [],
  HIS: ["CB", "CG", "ND1", "CD2", "CE1", "NE2"],
  ILE: ["CB", "CG1", "CG2", "CD1"],
  LEU: ["CB", "CG", "CD1", "CD2"],
  LYS: ["CB", "CG", "CD", "CE", "NZ"],
  MET: ["CB", "CG", "SD", "CE"],
  PHE: ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ"],
  PRO: ["CB", "CG", "CD"],
  SER: ["CB", "OG"],
  THR: ["CB", "OG1", "CG2"],
  TRP: ["CB", "CG", "CD1", "CD2", "NE1", "CE2", "CE3", "CZ2", "CZ3", "CH2"],
  TYR: ["CB", "CG", "CD1", "CD2", "CE1", "CE2", "CZ", "OH"],
  VAL: ["CB", "CG1", "CG2"],
};
const BACKBONE_ATOMS = ["N", "CA", "C", "O"] as const;

/**
 * Standard residues missing at least one heavy atom.
 *
 * This is the quantity FoldX itself reports as "number of incomplete residues = N" and then completes
 * one residue at a time, in RepairPDB and again, on an unrepaired template, inside BuildModel. On the
 * OCI ARM host (Box64) that completion cost ~4.7 s per residue: CNNM2's 6N7E chain A (305 residues,
 * 44 truncated at C-beta, typical of a 3.5 A structure) took 211 s to model unrepaired and 5.2 s once
 * repaired, so the count predicts BuildModel's fixed cost where residue count does not.
 *
 * Expects ATOM records after {@link cleanPdbForFoldX}; hydrogens, ligands and non-standard residues are ignored.
 */
export function countIncompleteResidues(pdbText: string): number {
  const atomsByResidue = new Map<string, { resName: string; atoms: Set<string> }>();
  for (const line of pdbText.split(/\r?\n/)) {
    if (!line.startsWith("ATOM")) continue;
    const resName = line.slice(17, 20).trim().toUpperCase();
    if (!(resName in SIDE_CHAIN_ATOMS)) continue;
    const key = line.slice(21, 27);
    let residue = atomsByResidue.get(key);
    if (!residue) atomsByResidue.set(key, (residue = { resName, atoms: new Set() }));
    residue.atoms.add(line.slice(12, 16).trim().toUpperCase());
  }
  let incomplete = 0;
  for (const { resName, atoms } of atomsByResidue.values()) {
    if (BACKBONE_ATOMS.some(a => !atoms.has(a)) || SIDE_CHAIN_ATOMS[resName].some(a => !atoms.has(a))) incomplete++;
  }
  return incomplete;
}
