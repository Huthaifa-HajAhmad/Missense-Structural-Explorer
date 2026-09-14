export function detectBFactorProvenance(wtPdb: string): {
  source: "alphafold" | "experimental" | "unknown";
  semantic: "plddt" | "temperature_factor";
  inherited: boolean;
} {
  const upper = wtPdb.toUpperCase();
  
  const isAlphaFoldHeader = 
    upper.includes("ALPHAFOLD") || 
    upper.includes("AF-") || 
    upper.includes("COMPL_MODEL") ||
    upper.includes("CREATOR OF MODEL: ALPHAFOLD") ||
    upper.includes("MODEL FROM ALPHAFOLD");
    
  if (isAlphaFoldHeader) {
    return { source: "alphafold", semantic: "plddt", inherited: true };
  }
  
  const lines = wtPdb.split(/\r?\n/);
  let atomCount = 0;
  let inPLDDTRangeCount = 0;
  
  for (const line of lines) {
    if (line.startsWith("ATOM")) {
      const bFactorStr = line.slice(60, 66).trim();
      const bFactor = parseFloat(bFactorStr);
      if (!isNaN(bFactor)) {
        atomCount++;
        if (bFactor >= 0.0 && bFactor <= 100.0) {
          inPLDDTRangeCount++;
        }
      }
    }
    if (atomCount >= 100) break;
  }
  
  if (atomCount > 0 && inPLDDTRangeCount === atomCount) {
    if (upper.includes("MODEL") || upper.includes("DATABASE") || upper.includes("ACCESSION")) {
      return { source: "alphafold", semantic: "plddt", inherited: true };
    }
  }
  
  if (upper.includes("HEADER") || upper.includes("EXPDTA") || upper.includes("REMARK")) {
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
