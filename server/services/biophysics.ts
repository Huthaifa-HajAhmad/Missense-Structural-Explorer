import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { AMINO_ACID_1_TO_3 } from "../../src/aminoAcids.ts";
import { validateUniProt, Semaphore } from "../utils.ts";


const mutantCache = new LRUCache<string, any>({
  max: 100,
  maxSize: 100 * 1024 * 1024, // 100MB limit (M-6)
  sizeCalculation: (value) => (value && typeof value.pdb === "string" ? value.pdb.length : 1000)
});

const pocketCache = new LRUCache<string, any>({
  max: 100,
  maxSize: 50 * 1024 * 1024, // 50MB limit (M-6)
  sizeCalculation: (value) => {
    const str = JSON.stringify(value);
    return str ? str.length : 1000;
  }
});

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
  if (pdbText.length > 256 * 1024) {
    return parseResiduesFromPdbAsync(pdbText);
  }
  return parseResiduesFromPdb(pdbText);
}

export interface PdbAtom {
  resSeq: number;
  resName: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

export function parseAtomsFromPdb(pdbText: string): PdbAtom[] {
  const lines = pdbText.split(/\r?\n/);
  const atoms: PdbAtom[] = [];
  for (const line of lines) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const altLoc = line.charAt(16);
      if (altLoc === " " || altLoc === "" || altLoc === "A") {
        const atomName = line.slice(12, 16).trim();
        const resName = line.slice(17, 20).trim();
        const resSeqStr = line.slice(22, 26).trim();
        const resSeqVal = parseInt(resSeqStr, 10);
        const xVal = line.slice(30, 38).trim();
        const yVal = line.slice(38, 46).trim();
        const zVal = line.slice(46, 54).trim();
        
        const x = parseFloat(xVal);
        const y = parseFloat(yVal);
        const z = parseFloat(zVal);

        if (!isNaN(resSeqVal) && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
          atoms.push({ resSeq: resSeqVal, resName, name: atomName, x, y, z });
        }
      }
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
      const line = lines[j];
      if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
        const altLoc = line.charAt(16);
        if (altLoc === " " || altLoc === "" || altLoc === "A") {
          const atomName = line.slice(12, 16).trim();
          const resName = line.slice(17, 20).trim();
          const resSeqStr = line.slice(22, 26).trim();
          const resSeqVal = parseInt(resSeqStr, 10);
          const xVal = line.slice(30, 38).trim();
          const yVal = line.slice(38, 46).trim();
          const zVal = line.slice(46, 54).trim();
          
          const x = parseFloat(xVal);
          const y = parseFloat(yVal);
          const z = parseFloat(zVal);

          if (!isNaN(resSeqVal) && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
            atoms.push({ resSeq: resSeqVal, resName, name: atomName, x, y, z });
          }
        }
      }
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  return atoms;
}

export async function parseAtomsFromPdbMaybeAsync(pdbText: string): Promise<PdbAtom[]> {
  if (pdbText.length > 256 * 1024) {
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

export function parseFoldxDifFile(fxText: string): number {
  const fxLines = fxText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (fxLines.length === 0) {
    throw new Error("Invalid FoldX file: empty file.");
  }
  
  // Find header line (first line that contains 'total energy' or starts with 'pdb\t')
  const headerLineIdx = fxLines.findIndex(line => {
    const lower = line.toLowerCase();
    return lower.startsWith("pdb\t") || lower.includes("total energy") || lower.includes("total\t");
  });
  if (headerLineIdx === -1) {
    throw new Error("Invalid FoldX file: no header line found.");
  }
  
  const header = fxLines[headerLineIdx];
  const headers = header.split('\t').map(h => h.toLowerCase().trim());
  
  // Explicit column validation
  const totalIdx = headers.findIndex(h => h === "total energy" || h === "total" || h.includes("total"));
  if (totalIdx === -1) {
    throw new Error("Invalid FoldX file: 'total energy' or 'total' column not found in headers.");
  }

  let wtTotal: number | null = null;
  let mutantTotal: number | null = null;

  for (let i = headerLineIdx + 1; i < fxLines.length; i++) {
    const line = fxLines[i];
    if (line.startsWith("#")) continue;
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length === 0 || parts[0] === "") continue;
    const filename = parts[0].toLowerCase().trim();
    
    // Match wt.pdb or wt_1.pdb filenames
    if (filename === "wt.pdb" || filename.endsWith("/wt.pdb") || filename.endsWith("\\wt.pdb") || filename === "wt") {
      if (parts.length > totalIdx) {
        wtTotal = parseFloat(parts[totalIdx]);
      }
    } else if (filename === "wt_1.pdb" || filename.endsWith("/wt_1.pdb") || filename.endsWith("\\wt_1.pdb") || filename === "wt_1") {
      if (parts.length > totalIdx) {
        mutantTotal = parseFloat(parts[totalIdx]);
      }
    }
  }

  if (mutantTotal === null || isNaN(mutantTotal)) {
    throw new Error("Invalid FoldX file: mutant row 'wt_1.pdb' not found or has invalid value.");
  }

  if (wtTotal !== null && !isNaN(wtTotal)) {
    // Raw file format: subtract wt energy from mutant energy
    return mutantTotal - wtTotal;
  } else {
    // Difference file format (e.g. Dif_wt.fxout): value is already mutant - wt
    return mutantTotal;
  }
}

const execFileAsync = promisify(execFile);

export const biophysicalSemaphore = new Semaphore(3);

/**
 * Amino acid propensity weights used for ligand binding pocket scoring.
 * NOTE: These weights represent a customized heuristic scale tailored for pocket finder scoring
 * and do not directly correspond to standard hydropathy scales like Kyte-Doolittle or Eisenberg.
 */
export function getAaPropensities(): Record<string, { weight: number; role: string; type: string }> {
  return {
    HIS: { weight: 3.5, role: "Metal Coordination / Basic Catalytic Residue", type: "Charged (Basic)" },
    ASP: { weight: 3.2, role: "Electrostatic Linker / Mg²⁺ Coordination Node", type: "Charged (Acidic)" },
    GLU: { weight: 3.0, role: "Proton Shuffler / Magnesium Ligand Node", type: "Charged (Acidic)" },
    TRP: { weight: 3.0, role: "Pi-Pi Stacking Core / Hydrophobic Sealing Wall", type: "Aromatic" },
    TYR: { weight: 2.8, role: "H-Bonding Donor / Hydrophobic Lining Spacer", type: "Aromatic / Polar" },
    PHE: { weight: 2.5, role: "Aromatic Cavity Gatekeeper / Core Nesting", type: "Aromatic" },
    ARG: { weight: 2.6, role: "Phosphate Salt Bridge Anchor Node", type: "Charged (Basic)" },
    LYS: { weight: 2.5, role: "Substrate Anchor Node / Hydrophilic Pocket Margin", type: "Charged (Basic)" },
    CYS: { weight: 2.8, role: "Zinc (Zn²⁺) / Metal Binding Coordination Node", type: "Sulfur-reactive" },
    ILE: { weight: 2.0, role: "Hydrophobic Boundary Enclosure Boundary", type: "Aliphatic" },
    LEU: { weight: 2.0, role: "Hydrophobic Packing Enclosure Frame", type: "Aliphatic" },
    MET: { weight: 1.9, role: "Hydrophobic Enclosure Spacer Cavity", type: "Aliphatic" },
    VAL: { weight: 1.8, role: "Pocket Cavity Frame Spacer Element", type: "Aliphatic" },
    GLY: { weight: 1.6, role: "Flexible Hinge Loop Flexor Core", type: "Flexible Hinge" },
    PRO: { weight: 1.2, role: "Rigid Structural Frame Wall Capper", type: "Rigid Frame" },
    SER: { weight: 1.6, role: "Coordinating H-Bond Network Coordinator", type: "Polar (Uncharged)" },
    THR: { weight: 1.6, role: "Polar Substrate Contact Coordinator", type: "Polar (Uncharged)" },
    GLN: { weight: 1.5, role: "Amine Substrate Adapter / Hydrogen Donor", type: "Polar (Uncharged)" },
    ASN: { weight: 1.5, role: "Amine Substrate Adapter / Hydrogen Donor", type: "Polar (Uncharged)" },
    ALA: { weight: 1.0, role: "Non-specific Cavity wall Boundary spacer", type: "Aliphatic" }
  };
}

export function determineLikelyCofactor(typesCount: Record<string, number>): string {
  if (typesCount["Charged (Basic)"] && typesCount["Charged (Basic)"] >= 2 && typesCount["Aromatic"]) {
    return "Adenosine Triphosphate nucleotides (ATP / ADP)";
  } else if (typesCount["Charged (Acidic)"] && typesCount["Charged (Basic)"] && typesCount["Charged (Acidic)"] >= 1) {
    return "Divalent Metal Ions Cations (Mg²⁺, Zn²⁺, Ca²⁺)";
  } else if (typesCount["Sulfur-reactive"] && typesCount["Sulfur-reactive"] >= 1) {
    return "Iron-Sulfur [Fe-S] or Zinc Finger metal clusters";
  } else if (typesCount["Aromatic"] && typesCount["Aromatic"] >= 2) {
    return "Folate / Heme cofactors or Aromatic Substrates";
  } else if (typesCount["Aliphatic"] && typesCount["Aliphatic"] >= 3) {
    return "Co-enzyme A / Fatty Acid hydrophobic substrates";
  }
  return "Organic substrates / Substrate cavity";
}

export async function generateMutantPdb(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string
): Promise<{ pdb: string; ddG: number | null; status: "success" | "scwrl"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
  const pdbHash = crypto.createHash("sha256").update(wtPdb).digest("hex");
  const cacheKey = `${pdbHash}_${validatedMutation}`;
  const cached = mutantCache.get(cacheKey);
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Biophysical Caching] Cache Hit for mutant mutation: ${validatedMutation}`);
    }
    return cached;
  }
  const result = await generateMutantPdbInternal(wtPdb, validatedMutation, uniprotId, jobDir);
  mutantCache.set(cacheKey, result);
  return result;
}

async function generateMutantPdbInternal(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string
): Promise<{ pdb: string; ddG: number | null; status: "success" | "scwrl"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
  const fullWtPath = path.join(jobDir, "wt.pdb");
  const fullMutPath = path.join(jobDir, "individual_list.txt");

  // 1. Write WT PDB data to temporary file
  await fs.promises.writeFile(fullWtPath, wtPdb, "utf8");

  // 2. Create mutation configuration text file (FoldX format: R A 215 W;)
  const mutMatch = validatedMutation.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (!mutMatch) {
    throw new Error("Invalid mutation code format.");
  }
  const wt1 = mutMatch[1].toUpperCase();
  const chain = mutMatch[2].toUpperCase();
  const pos = parseInt(mutMatch[3], 10);
  const mut1 = mutMatch[4].toUpperCase();

  // 3. Validate pos exists in WT PDB structure and resolve correct chain
  const pdbResidues = await parseResiduesFromPdbMaybeAsync(wtPdb);
  let targetRes = pdbResidues.find(r => r.resSeq === pos && (chain === "" || r.chain === chain));
  let resolvedChain = chain;

  if (!targetRes) {
    // Fallback: look for the residue position on any chain in the PDB structure
    const fallbackRes = pdbResidues.find(r => r.resSeq === pos);
    if (fallbackRes) {
      console.log(`[Biophysical Modeling] Target residue position ${pos} not found on requested chain ${chain || "any"}, but found on chain ${fallbackRes.chain}. Automatically resolving chain to ${fallbackRes.chain}.`);
      targetRes = fallbackRes;
      resolvedChain = fallbackRes.chain;
    } else {
      throw new Error(`Target residue position ${pos} on chain ${chain || "any"} is not found in the PDB structure.`);
    }
  }

  const expectedWt3 = AMINO_ACID_1_TO_3[wt1];
  if (expectedWt3 && targetRes.resName3 !== expectedWt3) {
    throw new Error(`Mutation mismatch: expected wild-type residue at position ${pos} is ${wt1} (${expectedWt3}), but PDB structure contains ${targetRes.resName3}.`);
  }

  // Construct mutation list using resolved chain
  const mutLine = `${wt1}${resolvedChain}${pos}${mut1};\n`;
  await fs.promises.writeFile(fullMutPath, mutLine, "utf8");

  let foldxBin = process.env.FOLDX_BINARY || "foldx";
  let foldxDir = "";
  if (foldxBin === "foldx") {
    const localToolsDir = path.join(process.cwd(), "tools", "foldx");
    if (fs.existsSync(localToolsDir)) {
      const files = fs.readdirSync(localToolsDir);
      const exeFile = files.find(f => f.toLowerCase().startsWith("foldx") && f.toLowerCase().endsWith(".exe"));
      if (exeFile) {
        foldxBin = path.join(localToolsDir, exeFile);
        foldxDir = localToolsDir;
        console.log(`[Biophysical Modeling] Auto-detected local FoldX binary: ${foldxBin}`);
      }
    }
  } else {
    foldxDir = path.dirname(foldxBin);
  }

  if (foldxDir) {
    const sourceMolecules = path.join(foldxDir, "molecules");
    const destMolecules = path.join(jobDir, "molecules");
    if (fs.existsSync(sourceMolecules)) {
      console.log(`[Biophysical Modeling] Copying FoldX molecules parameters to workspace...`);
      fs.cpSync(sourceMolecules, destMolecules, { recursive: true });
    }
    const sourceRotabase = path.join(foldxDir, "rotabase.txt");
    const destRotabase = path.join(jobDir, "rotabase.txt");
    if (fs.existsSync(sourceRotabase)) {
      console.log(`[Biophysical Modeling] Copying FoldX rotabase parameters to workspace...`);
      fs.copyFileSync(sourceRotabase, destRotabase);
    }
  }

  let foldxSuccess = false;
  let mutantPdbContent = "";
  let ddG: number | null = null;
  let status: "success" | "scwrl" = "success";

  try {
    console.log(`[Biophysical Modeling] Executing FoldX: ${foldxBin}...`);
    const { stdout, stderr } = await execFileAsync(foldxBin, [
      "--command=BuildModel",
      "--pdb=wt.pdb",
      "--mutant-file=individual_list.txt"
    ], {
      timeout: 45000,
      cwd: jobDir
    });

    console.log(`[FoldX STDOUT]:`, stdout.slice(0, 300));
    if (stderr) console.warn(`[FoldX STDERR]:`, stderr);

    // FoldX generates "wt_1.pdb" and "Dif_wt.fxout"
    const foldxOutPdb = path.join(jobDir, "wt_1.pdb");
    const foldxOutFx = path.join(jobDir, "Dif_wt.fxout");

    if (fs.existsSync(foldxOutPdb)) {
      mutantPdbContent = await fs.promises.readFile(foldxOutPdb, "utf8");
      foldxSuccess = true;
      console.log(`[Biophysical Modeling] Successfully loaded FoldX mutant structure (${mutantPdbContent.length} bytes).`);

      if (fs.existsSync(foldxOutFx)) {
        const fxText = await fs.promises.readFile(foldxOutFx, "utf8");
        ddG = parseFoldxDifFile(fxText);
        console.log(`[Biophysical Modeling] Parsed FoldX stability change (ddG): ${ddG} kcal/mol`);
      }
    }
  } catch (foldxErr: any) {
    console.warn(`[Biophysical Modeling] FoldX execution failed:`, foldxErr.message);
    if (foldxErr.stdout) console.log(`[FoldX Failure STDOUT]:`, foldxErr.stdout);
    if (foldxErr.stderr) console.error(`[FoldX Failure STDERR]:`, foldxErr.stderr);
  }

  if (foldxSuccess && mutantPdbContent) {
    // Inject B-factors from wild-type template structure to keep pLDDT confidence coloring consistent
    try {
      mutantPdbContent = injectBFactorsFromWtPdb(wtPdb, mutantPdbContent);
      console.log(`[Biophysical Modeling] Successfully injected B-factors (pLDDT confidence) from template structure into FoldX mutant PDB.`);
    } catch (injectErr: any) {
      console.error(`[Biophysical Modeling] Failed to inject B-factors:`, injectErr.message);
    }

    // Note: DynaMut2 consensus energetics are computed by the caller (routes.ts)
    // AFTER the biophysicalSemaphore is released, to avoid holding the slot during
    // the DynaMut2 polling period (~20 s max).
    return { pdb: mutantPdbContent, ddG, status, foldedResidueIndex: pos, resolvedChain };
  } else {
    throw new Error("Biophysical modeling engine unavailable (FoldX is not installed or failed to execute in this environment).");
  }
}




export async function findBindingPocket(
  pdbText: string,
  targetIndex: number,
  jobDir: string
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "fallback"; pocketDistance?: number | null }> {
  const pdbHash = crypto.createHash("sha256").update(pdbText).digest("hex");
  const cacheKey = `${pdbHash}_${targetIndex}`;
  const cached = pocketCache.get(cacheKey);
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Biophysical Caching] Cache Hit for binding pocket at residue: ${targetIndex}`);
    }
    return cached;
  }
  const result = await findBindingPocketInternal(pdbText, targetIndex, jobDir);
  pocketCache.set(cacheKey, result);
  return result;
}

async function findBindingPocketInternal(
  pdbText: string,
  targetIndex: number,
  jobDir: string
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "fallback"; pocketDistance?: number | null }> {
  const fullPdbPath = path.join(jobDir, "wt.pdb");
  const fullOutDir = path.join(jobDir, "out");

  // Write PDB to job folder
  await fs.promises.mkdir(jobDir, { recursive: true });
  await fs.promises.writeFile(fullPdbPath, pdbText, "utf8");
  await fs.promises.mkdir(fullOutDir, { recursive: true });

  const atoms = await parseAtomsFromPdbMaybeAsync(pdbText);

  if (atoms.length === 0) {
    return { pocketResidues: [], pocketScore: 0, pocketVolume: 0, likelyCofactor: "None", status: "fallback", pocketDistance: null };
  }

  let pocketDistance: number | null = null;

  const mutIndex = Number(targetIndex);
  
  // Validate mutIndex exists in WT PDB structure
  const pdbResidues = await parseResiduesFromPdbMaybeAsync(pdbText);
  const hasResidue = pdbResidues.some(r => r.resSeq === mutIndex);
  if (!hasResidue) {
    console.warn(`[Pocket Finder] Target residue position ${mutIndex} is not found in the PDB structure. Returning fallback.`);
    return { pocketResidues: [], pocketScore: 0, pocketVolume: 0, likelyCofactor: "None", status: "fallback", pocketDistance: null };
  }

  const mutAtoms = atoms.filter(a => a.resSeq === mutIndex);
  let mutX = 0, mutY = 0, mutZ = 0;
  if (mutAtoms.length > 0) {
    for (let i = 0; i < mutAtoms.length; i++) {
      const a = mutAtoms[i];
      mutX += a.x;
      mutY += a.y;
      mutZ += a.z;
    }
    mutX /= mutAtoms.length;
    mutY /= mutAtoms.length;
    mutZ /= mutAtoms.length;
  } else {
    console.warn(`[Pocket Finder] Coordinates for target residue position ${mutIndex} could not be extracted. Returning fallback.`);
    return { pocketResidues: [], pocketScore: 0, pocketVolume: 0, likelyCofactor: "None", status: "fallback", pocketDistance: null };
  }

  let p2rankSuccess = false;
  let pocketResidues: any[] = [];
  let pocketScore = 0;
  let pocketVolume = 0;
  let likelyCofactor = "None";
  let isFallback = false;

  // Try executing P2Rank command-line program
  try {
    console.log(`[Pocket Finder ML] Probing P2Rank CLI tool on temporary PDB structure...`);
    let p2rankCmd = "p2rank";
    const localP2rankDir = path.join(process.cwd(), "tools", "p2rank");
    if (fs.existsSync(localP2rankDir)) {
      const files = fs.readdirSync(localP2rankDir);
      let foundCmd = "";
      for (const f of files) {
        const subPath = path.join(localP2rankDir, f);
        if (fs.statSync(subPath).isDirectory()) {
          const batFile = path.join(subPath, "prank.bat");
          const shFile = path.join(subPath, "prank");
          if (process.platform === "win32" && fs.existsSync(batFile)) {
            foundCmd = batFile;
            break;
          } else if (fs.existsSync(shFile)) {
            foundCmd = shFile;
            break;
          }
        }
      }
      if (foundCmd) {
        p2rankCmd = foundCmd;
        console.log(`[Pocket Finder ML] Auto-detected local P2Rank binary: ${p2rankCmd}`);
      }
    }

    let execArgs = ["predict", "-f", path.resolve(fullPdbPath), "-o", path.resolve(fullOutDir)];
    let options: any = { timeout: 25000, cwd: jobDir };
    if (p2rankCmd.endsWith(".bat") || p2rankCmd.endsWith(".cmd")) {
      options.shell = true;
    }
    
    let stdout = "";
    try {
      const runRes = await execFileAsync(p2rankCmd, execArgs, options);
      stdout = typeof runRes.stdout === "string" ? runRes.stdout : (runRes.stdout as any).toString("utf8");
    } catch (execErr: any) {
      if (execErr.code === "ENOENT" && p2rankCmd === "p2rank") {
        console.log(`[Pocket Finder ML] 'p2rank' command not recognized. Trying 'prank' as fallback...`);
        p2rankCmd = "prank";
        const runRes = await execFileAsync(p2rankCmd, execArgs, options);
        stdout = typeof runRes.stdout === "string" ? runRes.stdout : (runRes.stdout as any).toString("utf8");
      } else {
        throw execErr;
      }
    }

    console.log(`[P2Rank STDOUT]:`, stdout.slice(0, 300));

    // Parse predictions file
    const predictionsFile = path.join(fullOutDir, `wt.pdb_predictions.csv`);
    if (fs.existsSync(predictionsFile)) {
      const csvText = await fs.promises.readFile(predictionsFile, "utf8");
      const csvLines = csvText.split("\n").map(l => l.trim()).filter(Boolean);

      if (csvLines.length > 1) {
        const headerCols = csvLines[0].split(",").map(c => c.trim().toLowerCase());
        const volColIdx = headerCols.findIndex(h => h === "volume" || h === "sas_volume" || h === "volume_sas");
        const resColIdx = headerCols.findIndex(h => h === "residue_ids" || h === "residues" || h.includes("residue"));
        const finalResColIdx = resColIdx !== -1 ? resColIdx : 9;

        const pockets: any[] = [];
        for (let i = 1; i < csvLines.length; i++) {
          const cols = csvLines[i].split(",").map(c => c.trim());
          if (cols.length >= 7) {
            const pId = parseInt(cols[0], 10);
            const score = parseFloat(cols[2]);
            const probability = parseFloat(cols[3]);
            const sasPoints = parseInt(cols[4], 10);
            const centerRes = cols[finalResColIdx]; // residue indices list e.g., "A_12 A_13"
            
            // Extract numeric sequence index by splitting chain prefix (e.g. A_12 -> 12)
            const residueIndices = centerRes.split(/\s+/).map(x => {
              const parts = x.split("_");
              const numStr = parts[parts.length - 1];
              return parseInt(numStr, 10);
            }).filter(x => !isNaN(x));

            let volume = NaN;
            if (volColIdx !== -1 && cols.length > volColIdx) {
              volume = parseFloat(cols[volColIdx]);
            }

            pockets.push({
              id: pId,
              score,
              probability,
              sasPoints,
              residueIndices,
              volume
            });
          }
        }

        // Find pocket containing mutIndex or closest in space
        let selectedPocket = pockets.find(p => p.residueIndices.includes(mutIndex));
        if (!selectedPocket && pockets.length > 0) {
          let minDist = 999999;
          for (const p of pockets) {
            const pAtoms = atoms.filter(a => p.residueIndices.includes(a.resSeq));
            if (pAtoms.length > 0) {
              let sumX = 0, sumY = 0, sumZ = 0;
              pAtoms.forEach(a => { sumX += a.x; sumY += a.y; sumZ += a.z; });
              const cX = sumX / pAtoms.length;
              const cY = sumY / pAtoms.length;
              const cZ = sumZ / pAtoms.length;
              const dist = Math.sqrt(Math.pow(cX - mutX, 2) + Math.pow(cY - mutY, 2) + Math.pow(cZ - mutZ, 2));
              if (dist < minDist) {
                minDist = dist;
                selectedPocket = p;
              }
            }
          }
        }

        if (selectedPocket) {
          const pocketResiduesMap: Record<number, any> = {};
          const propensities = getAaPropensities();

          // Group atoms by resSeq once for O(1) lookups (M-8)
          const atomsByResSeq = new Map<number, PdbAtom[]>();
          for (const a of atoms) {
            const list = atomsByResSeq.get(a.resSeq) || [];
            list.push(a);
            atomsByResSeq.set(a.resSeq, list);
          }

          for (const rIndex of selectedPocket.residueIndices) {
            const resAtoms = atomsByResSeq.get(rIndex) || [];
            if (resAtoms.length > 0) {
              let rX = 0, rY = 0, rZ = 0;
              resAtoms.forEach(a => { rX += a.x; rY += a.y; rZ += a.z; });
              rX /= resAtoms.length;
              rY /= resAtoms.length;
              rZ /= resAtoms.length;
              
              const distance = Math.sqrt(Math.pow(rX - mutX, 2) + Math.pow(rY - mutY, 2) + Math.pow(rZ - mutZ, 2));
              const resName = resAtoms[0].resName;
              const prop = propensities[resName] || { weight: 1.0, role: "Backbone structural spacer", type: "Aliphatic" };
              
              pocketResiduesMap[rIndex] = {
                index: rIndex,
                name: resName,
                distance: parseFloat(distance.toFixed(2)),
                score: prop.weight,
                role: prop.role,
                type: prop.type
              };
            }
          }

          pocketResidues = Object.values(pocketResiduesMap);
          pocketResidues.sort((a, b) => b.score - a.score);
          pocketResidues = pocketResidues.slice(0, 7);

          pocketScore = Math.round(selectedPocket.probability * 100);
          if (isNaN(pocketScore) || pocketScore === 0) {
            pocketScore = Math.min(98, Math.round(selectedPocket.score * 5));
          }

          // Dynamic P2Rank Volume calculation
          if (selectedPocket.volume && !isNaN(selectedPocket.volume)) {
            pocketVolume = Math.round(selectedPocket.volume);
          } else {
            // Geometrical estimate based on pocket residues' coordinates (M-8)
            const residueIndicesSet = new Set(selectedPocket.residueIndices);
            const pAtoms = atoms.filter(a => residueIndicesSet.has(a.resSeq));
            if (pAtoms.length > 0) {
              let sumPX = 0, sumPY = 0, sumPZ = 0;
              pAtoms.forEach(a => { sumPX += a.x; sumPY += a.y; sumPZ += a.z; });
              const pcX = sumPX / pAtoms.length;
              const pcY = sumPY / pAtoms.length;
              const pcZ = sumPZ / pAtoms.length;
              
              const distances = pAtoms.map(a => Math.sqrt(Math.pow(a.x - pcX, 2) + Math.pow(a.y - pcY, 2) + Math.pow(a.z - pcZ, 2)));
              const maxDist = Math.max(...distances, 4.0);
              const sphereVolume = (4/3) * Math.PI * Math.pow(maxDist, 3);
              const pocketResiduesCount = selectedPocket.residueIndices.length;
              pocketVolume = Math.round(sphereVolume * (0.8 + (pocketResiduesCount / 100)));
            } else {
              pocketVolume = Math.round(selectedPocket.sasPoints * 1.5) || 150;
            }
          }

          const typesCount = pocketResidues.reduce((acc, curr) => {
            acc[curr.type] = (acc[curr.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          likelyCofactor = determineLikelyCofactor(typesCount);

          // Calculate distance to selected pocket centroid
          const pAtoms = atoms.filter(a => selectedPocket.residueIndices.includes(a.resSeq));
          if (pAtoms.length > 0) {
            let sumPX = 0, sumPY = 0, sumPZ = 0;
            pAtoms.forEach(a => { sumPX += a.x; sumPY += a.y; sumPZ += a.z; });
            const pcX = sumPX / pAtoms.length;
            const pcY = sumPY / pAtoms.length;
            const pcZ = sumPZ / pAtoms.length;
            pocketDistance = parseFloat(Math.sqrt(Math.pow(pcX - mutX, 2) + Math.pow(pcY - mutY, 2) + Math.pow(pcZ - mutZ, 2)).toFixed(2));
          }

          p2rankSuccess = true;
        }
      }
    }
  } catch (p2rankErr: any) {
    console.warn(`[Pocket Finder ML] P2Rank execution failed or not installed. Falling back to heuristic. Error:`, p2rankErr.message);
  }

  if (!p2rankSuccess) {
    throw new Error("P2Rank pocket detection failed: No high-confidence binding pocket could be resolved for the specified mutation index.");
  }

  return {
    pocketResidues,
    pocketScore,
    pocketVolume,
    likelyCofactor,
    pocketDistance,
    status: "success"
  };
}

function injectBFactorsFromWtPdb(wtPdb: string, mutPdb: string): string {
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
          const paddedB = bFactorStr.padEnd(6, " ");
          return line.slice(0, 60) + paddedB + line.slice(66);
        }
      }
    }
    return line;
  });
  
  return updatedLines.join("\n");
}
