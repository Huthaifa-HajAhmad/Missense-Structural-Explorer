/**
 * pdb-parser.ts — Pure PDB file parsing utilities.
 *
 * Extracted from biophysics.ts. Contains:
 *   - PdbResidue interface + all parseResidues* functions
 *   - PdbAtom interface + parsePdbLine, parseAtoms* functions
 *   - getResidueDetails (amino acid property lookup)
 *   - extractSequenceFromPdb
 *
 * Zero dependencies on other server/services modules — safe to import anywhere.
 */
import { AMINO_ACID_1_TO_3, AMINO_ACID_3_TO_1 } from "../../src/aminoAcids.ts";

export interface PdbResidue {
  resSeq: number;
  insCode: string;
  resName3: string;
  chain: string;
  x?: number;
  y?: number;
  z?: number;
}

export function parseResiduesFromPdb(pdbText: string): PdbResidue[] {
  const residuesMap = new Map<string, PdbResidue>();
  const lines = pdbText.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const altLoc = line.charAt(16);
      if (altLoc === " " || altLoc === "" || altLoc === "A") {
        const atomName = line.slice(12, 16).trim();
        if (atomName === "CA") {
          const resName3 = line.slice(17, 20).trim().toUpperCase();
          const chain = line.slice(21, 22).trim();
          const resSeqStr = line.slice(22, 26).trim();
          const resSeq = parseInt(resSeqStr, 10);
          const insCode = line.charAt(26).trim();
          if (!isNaN(resSeq)) {
            const key = `${chain}_${resSeq}_${insCode}`;
            if (!residuesMap.has(key)) {
              let x: number | undefined;
              let y: number | undefined;
              let z: number | undefined;
              try {
                const xStr = line.slice(30, 38).trim();
                const yStr = line.slice(38, 46).trim();
                const zStr = line.slice(46, 54).trim();
                x = parseFloat(xStr);
                y = parseFloat(yStr);
                z = parseFloat(zStr);
              } catch (e) {}
              residuesMap.set(key, {
                resSeq,
                insCode,
                resName3,
                chain,
                x: isNaN(x as any) ? undefined : x,
                y: isNaN(y as any) ? undefined : y,
                z: isNaN(z as any) ? undefined : z
              });
            }
          }
        }
      }
    }
  }
  return Array.from(residuesMap.values()).sort((a, b) => {
    if (a.chain !== b.chain) {
      return a.chain.localeCompare(b.chain);
    }
    if (a.resSeq !== b.resSeq) {
      return a.resSeq - b.resSeq;
    }
    return a.insCode.localeCompare(b.insCode);
  });
}

export async function parseResiduesFromPdbAsync(pdbText: string): Promise<PdbResidue[]> {
  const residuesMap = new Map<string, PdbResidue>();
  const lines = pdbText.split(/\r?\n/);
  const chunkSize = 1000;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, lines.length);
    for (let j = i; j < end; j++) {
      const line = lines[j];
      if (line.startsWith("ATOM")) {
        const altLoc = line.charAt(16);
        if (altLoc === " " || altLoc === "" || altLoc === "A") {
          const atomName = line.slice(12, 16).trim();
          if (atomName === "CA") {
            const resName3 = line.slice(17, 20).trim().toUpperCase();
            const chain = line.slice(21, 22).trim();
            const resSeqStr = line.slice(22, 26).trim();
            const resSeq = parseInt(resSeqStr, 10);
            const insCode = line.charAt(26).trim();
            if (!isNaN(resSeq)) {
              const key = `${chain}_${resSeq}_${insCode}`;
              if (!residuesMap.has(key)) {
                let x: number | undefined;
                let y: number | undefined;
                let z: number | undefined;
                try {
                  const xStr = line.slice(30, 38).trim();
                  const yStr = line.slice(38, 46).trim();
                  const zStr = line.slice(46, 54).trim();
                  x = parseFloat(xStr);
                  y = parseFloat(yStr);
                  z = parseFloat(zStr);
                } catch (e) {}
                residuesMap.set(key, {
                  resSeq,
                  insCode,
                  resName3,
                  chain,
                  x: isNaN(x as any) ? undefined : x,
                  y: isNaN(y as any) ? undefined : y,
                  z: isNaN(z as any) ? undefined : z
                });
              }
            }
          }
        }
      }
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return Array.from(residuesMap.values()).sort((a, b) => {
    if (a.chain !== b.chain) {
      return a.chain.localeCompare(b.chain);
    }
    if (a.resSeq !== b.resSeq) {
      return a.resSeq - b.resSeq;
    }
    return a.insCode.localeCompare(b.insCode);
  });
}

export async function parseResiduesFromPdbMaybeAsync(pdbText: string): Promise<PdbResidue[]> {
  if (pdbText.length > 64 * 1024) {
    return parseResiduesFromPdbAsync(pdbText);
  }
  return parseResiduesFromPdb(pdbText);
}

export interface PdbAtom {
  resSeq: number;
  resName: string;
  name: string;
  chain: string;
  x: number;
  y: number;
  z: number;
}

export function parsePdbLine(line: string): PdbAtom | null {
  if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
    const altLoc = line.charAt(16);
    if (altLoc === " " || altLoc === "" || altLoc === "A") {
      const atomName = line.slice(12, 16).trim();
      const resName = line.slice(17, 20).trim();
      const chain = line.slice(21, 22).trim();
      const resSeqStr = line.slice(22, 26).trim();
      const resSeqVal = parseInt(resSeqStr, 10);
      const xVal = line.slice(30, 38).trim();
      const yVal = line.slice(38, 46).trim();
      const zVal = line.slice(46, 54).trim();

      const x = parseFloat(xVal);
      const y = parseFloat(yVal);
      const z = parseFloat(zVal);

      if (!isNaN(resSeqVal) && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
        return { resSeq: resSeqVal, resName, name: atomName, chain, x, y, z };
      }
    }
  }
  return null;
}

export function parseAtomsFromPdb(pdbText: string): PdbAtom[] {
  const lines = pdbText.split(/\r?\n/);
  const atoms: PdbAtom[] = [];
  for (const line of lines) {
    const parsed = parsePdbLine(line);
    if (parsed) {
      atoms.push(parsed);
    }
  }
  return atoms;
}

export async function parseAtomsFromPdbAsync(pdbText: string): Promise<PdbAtom[]> {
  const lines = pdbText.split(/\r?\n/);
  const atoms: PdbAtom[] = [];
  const chunkSize = 1000;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, lines.length);
    for (let j = i; j < end; j++) {
      const parsed = parsePdbLine(lines[j]);
      if (parsed) {
        atoms.push(parsed);
      }
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return atoms;
}

export async function parseAtomsFromPdbMaybeAsync(pdbText: string): Promise<PdbAtom[]> {
  if (pdbText.length > 64 * 1024) {
    return parseAtomsFromPdbAsync(pdbText);
  }
  return parseAtomsFromPdb(pdbText);
}

export function getResidueDetails(resName3: string): { properties: string; role: string; classBadge: string } {
  const upper = resName3.toUpperCase();
  const map: Record<string, { properties: string; role: string; classBadge: string }> = {
    ASP: {
      properties: "Acidic, Negatively Charged",
      classBadge: "bg-red-500/10 text-red-300 border-red-500/20",
      role: "Often participates in critical salt bridge partners or positive charge neutralization."
    },
    GLU: {
      properties: "Acidic, Negatively Charged",
      classBadge: "bg-red-500/10 text-red-300 border-red-500/20",
      role: "Interacts electrostatically with adjacent basic residues to lock local secondary loop folds."
    },
    ARG: {
      properties: "Basic, Positively Charged",
      classBadge: "bg-blue-500/10 text-blue-300 border-blue-500/20",
      role: "Provides outward basic projection, critical for maintaining pocket electrostatics."
    },
    LYS: {
      properties: "Basic, Positively Charged",
      classBadge: "bg-blue-500/10 text-blue-300 border-blue-500/20",
      role: "Participates in outward polar networks or coordinating neighboring cofactors."
    },
    HIS: {
      properties: "Basic, Weakly Charged",
      classBadge: "bg-blue-500/10 text-blue-300 border-blue-500/20",
      role: "Acts as a catalytic residue or participates in metal-coordination networks."
    },
    PHE: {
      properties: "Hydrophobic, Aromatic",
      classBadge: "bg-amber-500/10 text-amber-300 border-amber-500/20",
      role: "Forms rigid aromatic shielding, providing heavy van der Waals interactions."
    },
    TYR: {
      properties: "Hydrophobic, Aromatic",
      classBadge: "bg-amber-500/10 text-amber-300 border-amber-500/20",
      role: "Coordinates active site binding with hydrogen bonding through its phenolic hydroxyl group."
    },
    TRP: {
      properties: "Hydrophobic, Aromatic",
      classBadge: "bg-amber-500/10 text-amber-300 border-amber-500/20",
      role: "Provides rigid aromatic core packing and heavy local dispersion contacts."
    },
    ALA: {
      properties: "Hydrophobic, Aliphatic",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
      role: "Forms small hydrophobic packing spacer, facilitating tight secondary structure packaging."
    },
    VAL: {
      properties: "Hydrophobic, Aliphatic",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
      role: "Provides compact hydrophobic scaffolding within the local lipid or core alignment."
    },
    LEU: {
      properties: "Hydrophobic, Aliphatic",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
      role: "Supplies stable inner-core hydrophobic surface area and supports local sheet packing."
    },
    ILE: {
      properties: "Hydrophobic, Aliphatic",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
      role: "Supplies heavy aliphatic packaging inside hydrophobic cores and protein-protein boundaries."
    },
    MET: {
      properties: "Hydrophobic, Sulfur-containing",
      classBadge: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
      role: "Hydrophobic boundary enclosing packing residue containing non-reactive sulfur."
    },
    PRO: {
      properties: "Conformationally Restricted",
      classBadge: "bg-purple-500/10 text-purple-300 border-purple-500/20",
      role: "Creates rigid structural loops, imposing strict local conformational constraints."
    },
    SER: {
      properties: "Polar, Uncharged",
      classBadge: "bg-sky-500/10 text-sky-300 border-sky-500/20",
      role: "Forms native hydrogen bonding linkages to stabilize the outer peptide boundary."
    },
    THR: {
      properties: "Polar, Uncharged",
      classBadge: "bg-sky-500/10 text-sky-300 border-sky-500/20",
      role: "Participates in local hydrogen-bonding networks and hydrophilic surface contacts."
    },
    ASN: {
      properties: "Polar, Amide",
      classBadge: "bg-sky-500/10 text-sky-300 border-sky-500/20",
      role: "Forms hydrogen-bonding networks, stabilizing turns and structural loop connections."
    },
    GLN: {
      properties: "Polar, Amide",
      classBadge: "bg-sky-500/10 text-sky-300 border-sky-500/20",
      role: "Participates in polar peptide contacts, forming structural locks on solvent boundaries."
    },
    CYS: {
      properties: "Sulfur-reactive",
      classBadge: "bg-yellow-500/10 text-yellow-300 border-yellow-500/20",
      role: "Involved in disulfide bridge formation or metal coordination cores."
    },
    GLY: {
      properties: "Conformationally Flexible",
      classBadge: "bg-slate-500/10 text-slate-300 border-slate-500/20",
      role: "Allows maximum local backbone flexibility, relieving steric strain in tight loops."
    }
  };
  return map[upper] || {
    properties: "Unknown",
    classBadge: "bg-slate-500/10 text-slate-300 border-slate-500/20",
    role: "Structural packing residue with uncharacterized microenvironment contributions."
  };
}

export function extractSequenceFromPdb(wtPdb: string, resolvedChain: string): { sequence: string; minPos: number } {
  const lines = wtPdb.split(/\r?\n/);
  const residues = new Map<number, string>();
  let minPos = Infinity;
  let maxPos = -Infinity;

  for (const line of lines) {
    if (line.startsWith("ATOM")) {
      const atomName = line.slice(12, 16).trim();
      if (atomName === "CA") {
        const chain = line.slice(21, 22).trim().toUpperCase();
        if (chain === resolvedChain.toUpperCase()) {
          const resSeq = parseInt(line.slice(22, 26).trim(), 10);
          const resName3 = line.slice(17, 20).trim().toUpperCase();
          const aa1 = AMINO_ACID_3_TO_1[resName3] || "X";
          residues.set(resSeq, aa1);
          if (resSeq < minPos) minPos = resSeq;
          if (resSeq > maxPos) maxPos = resSeq;
        }
      }
    }
  }

  if (minPos === Infinity) {
    return { sequence: "", minPos: 1 };
  }

  let seq = "";
  for (let p = minPos; p <= maxPos; p++) {
    seq += residues.get(p) || "X";
  }
  return { sequence: seq, minPos };
}
