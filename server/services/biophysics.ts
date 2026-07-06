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
    if (!value) return 1000;
    const residueCount = Array.isArray(value.pocketResidues) ? value.pocketResidues.length : 0;
    return 500 + residueCount * 200; // ~200 bytes per residue + base overhead
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

export interface FoldxParsedResult {
  ddG: number;
  sd: number;
  vdw: number;
  electrostatics: number;
  rawDdGs: number[];
  stericClashWarning: boolean;
}

export function parseFoldxDifFile(fxText: string): FoldxParsedResult {
  const fxLines = fxText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (fxLines.length === 0) {
    throw new Error("Invalid FoldX file: empty file.");
  }
  
  // Find header line (first line that contains 'total energy'/'total' and starts with 'pdb')
  const headerLineIdx = fxLines.findIndex(line => {
    const lower = line.toLowerCase();
    return (lower.startsWith("pdb\t") || lower.startsWith("pdb ") || lower.includes("pdb\t")) &&
           (lower.includes("total energy") || lower.includes("total") || lower.includes("total_energy"));
  });
  if (headerLineIdx === -1) {
    throw new Error("Invalid FoldX file: no header line found.");
  }
  
  const header = fxLines[headerLineIdx];
  const headers = header.split('\t').map(h => h.toLowerCase().trim());
  
  // Strict column matching (BIO-5)
  let totalIdx = headers.findIndex(h => h === "total energy" || h === "total" || h === "total_energy");
  if (totalIdx === -1) {
    totalIdx = headers.findIndex(h => h.includes("total energy") || h === "total");
  }
  if (totalIdx === -1) {
    throw new Error("Invalid FoldX file: 'total energy' column not found in headers.");
  }

  const vdwIdx = headers.findIndex(h => h.includes("van der waals") || h.includes("vdw") || h.includes("clash"));
  const elecIdx = headers.findIndex(h => h.includes("electrostatics") || h.includes("electrostatic") || h.includes("elec"));

  let wtTotal: number | null = null;
  let wtVdw: number | null = null;
  let wtElec: number | null = null;

  interface RawRunData {
    name: string;
    total: number;
    vdw: number;
    elec: number;
  }
  const mutantRuns: RawRunData[] = [];

  for (let i = headerLineIdx + 1; i < fxLines.length; i++) {
    const line = fxLines[i];
    if (line.startsWith("#")) continue;
    const parts = line.split('\t').map(p => p.trim());
    if (parts.length === 0 || parts[0] === "") continue;
    const filename = parts[0].toLowerCase().trim();
    
    const totalVal = parts.length > totalIdx ? parseFloat(parts[totalIdx]) : NaN;
    const vdwVal = vdwIdx !== -1 && parts.length > vdwIdx ? parseFloat(parts[vdwIdx]) : 0;
    const elecVal = elecIdx !== -1 && parts.length > elecIdx ? parseFloat(parts[elecIdx]) : 0;

    if (isNaN(totalVal)) continue;

    if (filename === "wt.pdb" || filename.endsWith("/wt.pdb") || filename.endsWith("\\wt.pdb") || filename === "wt") {
      wtTotal = totalVal;
      wtVdw = vdwVal;
      wtElec = elecVal;
    } else {
      mutantRuns.push({
        name: filename,
        total: totalVal,
        vdw: vdwVal,
        elec: elecVal
      });
    }
  }

  if (mutantRuns.length === 0) {
    throw new Error("Invalid FoldX file: no mutant rows found.");
  }

  const rawDdGs: number[] = [];
  const vdws: number[] = [];
  const elecs: number[] = [];

  for (const run of mutantRuns) {
    let runDdG = run.total;
    let runVdw = run.vdw;
    let runElec = run.elec;

    if (wtTotal !== null && !isNaN(wtTotal)) {
      runDdG = run.total - wtTotal;
      runVdw = run.vdw - (wtVdw ?? 0);
      runElec = run.elec - (wtElec ?? 0);
    }
    rawDdGs.push(runDdG);
    vdws.push(runVdw);
    elecs.push(runElec);
  }

  const sumDdG = rawDdGs.reduce((a, b) => a + b, 0);
  const meanDdG = sumDdG / rawDdGs.length;

  let sd = 0;
  if (rawDdGs.length > 1) {
    const squareDiffs = rawDdGs.map(val => Math.pow(val - meanDdG, 2));
    const sumSquareDiffs = squareDiffs.reduce((a, b) => a + b, 0);
    sd = Math.sqrt(sumSquareDiffs / (rawDdGs.length - 1));
  }

  const meanVdw = vdws.reduce((a, b) => a + b, 0) / vdws.length;
  const meanElec = elecs.reduce((a, b) => a + b, 0) / elecs.length;

  const stericClashWarning = meanVdw > 2.0;
  const clampedDdG = Math.min(50.0, meanDdG);

  return {
    ddG: parseFloat(clampedDdG.toFixed(4)),
    sd: parseFloat(sd.toFixed(4)),
    vdw: parseFloat(meanVdw.toFixed(4)),
    electrostatics: parseFloat(meanElec.toFixed(4)),
    rawDdGs,
    stericClashWarning
  };
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

export class ConcurrencySemaphore {
  private activeCount = 0;
  private queue: (() => void)[] = [];
  constructor(private maxConcurrency: number) {}
  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.activeCount--;
    }
  }
}

const biophysicalConcurrency = process.env.BIOPHYSICAL_CONCURRENCY 
  ? parseInt(process.env.BIOPHYSICAL_CONCURRENCY, 10) 
  : 2;
const foldxSemaphore = new ConcurrencySemaphore(biophysicalConcurrency);

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
  
  await foldxSemaphore.acquire();
  try {
    const result = await generateMutantPdbInternal(wtPdb, validatedMutation, uniprotId, jobDir);
    mutantCache.set(cacheKey, result);
    return result;
  } finally {
    foldxSemaphore.release();
  }
}

export function calculateLocalSidechainRmsd(wtAtoms: PdbAtom[], mutAtoms: PdbAtom[], pos: number, chain: string): number {
  const windowSize = 3;
  const wtWindowAtoms = wtAtoms.filter(a => Math.abs(a.resSeq - pos) <= windowSize && a.chain === chain);
  const mutWindowAtoms = mutAtoms.filter(a => Math.abs(a.resSeq - pos) <= windowSize && a.chain === chain);

  if (wtWindowAtoms.length === 0 || mutWindowAtoms.length === 0) {
    return 0.0;
  }

  const wtTargetCa = wtWindowAtoms.find(a => a.resSeq === pos && a.name === "CA");
  const mutTargetCa = mutWindowAtoms.find(a => a.resSeq === pos && a.name === "CA");

  let dx = 0, dy = 0, dz = 0;
  if (wtTargetCa && mutTargetCa) {
    dx = wtTargetCa.x - mutTargetCa.x;
    dy = wtTargetCa.y - mutTargetCa.y;
    dz = wtTargetCa.z - mutTargetCa.z;
  }

  let sumSqDist = 0;
  let count = 0;
  const backboneAtomNames = new Set(["N", "CA", "C", "O", "H", "HA", "HN"]);

  for (const wtA of wtWindowAtoms) {
    if (backboneAtomNames.has(wtA.name)) continue;
    if (wtA.resSeq === pos) {
      if (wtA.name !== "CB") continue;
    }

    const mutA = mutWindowAtoms.find(a => a.resSeq === wtA.resSeq && a.name === wtA.name);
    if (mutA) {
      const mx = mutA.x + dx;
      const my = mutA.y + dy;
      const mz = mutA.z + dz;
      const distSq = Math.pow(wtA.x - mx, 2) + Math.pow(wtA.y - my, 2) + Math.pow(wtA.z - mz, 2);
      sumSqDist += distSq;
      count++;
    }
  }

  if (count === 0) return 0.0;
  const rmsd = Math.sqrt(sumSqDist / count);
  return parseFloat(rmsd.toFixed(4));
}

async function generateMutantPdbInternal(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string
): Promise<{ pdb: string; ddG: number | null; sd?: number; status: "success" | "scwrl"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
  const fullWtPath = path.join(jobDir, "wt.pdb");
  const fullMutPath = path.join(jobDir, "individual_list.txt");

  // 1. Write WT PDB data to temporary file
  await fs.promises.mkdir(jobDir, { recursive: true });
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

  // Construct mutation list using resolved chain and insertion code (BIO-4)
  const insCode = targetRes.insCode || "";
  const mutLine = `${wt1}${resolvedChain}${pos}${insCode}${mut1};\n`;
  await fs.promises.writeFile(fullMutPath, mutLine, "utf8");

  let foldxBin = process.env.FOLDX_BINARY || "foldx";
  let foldxDir = "";
  if (foldxBin === "foldx") {
    const localToolsDir = path.join(process.cwd(), "tools", "foldx");
    if (fs.existsSync(localToolsDir)) {
      const files = fs.readdirSync(localToolsDir);
      // Platform-aware check (BIO-2)
      const exeFile = files.find(f => {
        const lower = f.toLowerCase();
        if (process.platform === "win32") {
          return lower.startsWith("foldx") && lower.endsWith(".exe");
        } else {
          return lower.startsWith("foldx") && !lower.endsWith(".exe") && !lower.endsWith(".txt");
        }
      });
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
  let overallDdG: number | null = null;
  let overallSd: number = 0;
  let status: "success" | "scwrl" = "success";
  let parsedResult: FoldxParsedResult | null = null;

  try {
    // 1. Run FoldX RepairPDB first to resolve starting steric clashes and stabilize energy delta
    console.log(`[Biophysical Modeling] Running FoldX RepairPDB: ${foldxBin}...`);
    try {
      await execFileAsync(foldxBin, [
        "--command=RepairPDB",
        "--pdb=wt.pdb"
      ], {
        timeout: 45000,
        cwd: jobDir
      });
      const repairedPdbPath = path.join(jobDir, "wt_Repair.pdb");
      if (fs.existsSync(repairedPdbPath)) {
        console.log(`[Biophysical Modeling] Successfully repaired PDB. Overwriting wt.pdb with repaired coordinates.`);
        await fs.promises.rename(repairedPdbPath, fullWtPath);
      }
    } catch (repairErr: any) {
      console.warn(`[Biophysical Modeling] RepairPDB warning (failed or skipped):`, repairErr.message);
    }

    // 2. Run FoldX BuildModel with 3 stochastic runs (BIO-10)
    console.log(`[Biophysical Modeling] Executing FoldX BuildModel (3 runs): ${foldxBin}...`);
    const { stdout, stderr } = await execFileAsync(foldxBin, [
      "--command=BuildModel",
      "--pdb=wt.pdb",
      "--mutant-file=individual_list.txt",
      "--numberOfRuns=3"
    ], {
      timeout: 60000,
      cwd: jobDir
    });

    console.log(`[FoldX STDOUT]:`, stdout.slice(0, 300));
    if (stderr) console.warn(`[FoldX STDERR]:`, stderr);

    // FoldX generates "wt_1_0.pdb" (FoldX 5.x) or "wt_1.pdb" (FoldX 4.x)
    let foldxOutPdb = path.join(jobDir, "wt_1_0.pdb");
    if (!fs.existsSync(foldxOutPdb)) {
      foldxOutPdb = path.join(jobDir, "wt_1.pdb");
    }
    const foldxOutFx = path.join(jobDir, "Dif_wt.fxout");

    if (fs.existsSync(foldxOutPdb)) {
      mutantPdbContent = await fs.promises.readFile(foldxOutPdb, "utf8");
      foldxSuccess = true;
      console.log(`[Biophysical Modeling] Successfully loaded FoldX mutant structure (${mutantPdbContent.length} bytes).`);

      if (fs.existsSync(foldxOutFx)) {
        const fxText = await fs.promises.readFile(foldxOutFx, "utf8");
        parsedResult = parseFoldxDifFile(fxText);
        overallDdG = parsedResult.ddG;
        overallSd = parsedResult.sd;
        console.log(`[Biophysical Modeling] Parsed FoldX stochastic ddG: ${overallDdG} ± ${overallSd} kcal/mol`);
      }
    }
  } catch (foldxErr: any) {
    console.warn(`[Biophysical Modeling] FoldX execution failed:`, foldxErr.message);
    if (foldxErr.stdout) console.log(`[FoldX Failure STDOUT]:`, foldxErr.stdout);
    if (foldxErr.stderr) console.error(`[FoldX Failure STDERR]:`, foldxErr.stderr);
  }

  if (foldxSuccess && mutantPdbContent) {
    try {
      mutantPdbContent = injectBFactorsFromWtPdb(wtPdb, mutantPdbContent);
      console.log(`[Biophysical Modeling] Successfully injected B-factors (pLDDT confidence) from template structure into FoldX mutant PDB.`);
    } catch (injectErr: any) {
      console.error(`[Biophysical Modeling] Failed to inject B-factors:`, injectErr.message);
    }

    // Calculate local sidechain RMSD (BIO-8)
    let localSidechainRmsd = 0.0;
    try {
      const wtAtoms = parseAtomsFromPdb(wtPdb);
      const mutAtoms = parseAtomsFromPdb(mutantPdbContent);
      localSidechainRmsd = calculateLocalSidechainRmsd(wtAtoms, mutAtoms, pos, resolvedChain);
      console.log(`[Biophysical Modeling] Calculated local sidechain RMSD: ${localSidechainRmsd} Å`);
    } catch (rmsdErr: any) {
      console.error(`[Biophysical Modeling] Failed to calculate local sidechain RMSD:`, rmsdErr.message);
    }

    const energetics = parsedResult ? {
      foldxMean: parsedResult.ddG,
      foldxSd: parsedResult.sd,
      vdw: parsedResult.vdw,
      electrostatics: parsedResult.electrostatics,
      stericClashWarning: parsedResult.stericClashWarning,
      localSidechainRmsd
    } : undefined;

    return { 
      pdb: mutantPdbContent, 
      ddG: overallDdG, 
      sd: overallSd, 
      status, 
      foldedResidueIndex: pos, 
      resolvedChain,
      energetics
    };
  } else {
    throw new Error("Biophysical modeling engine unavailable (FoldX is not installed or failed to execute in this environment).");
  }
}




export async function findBindingPocket(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "fallback"; pocketDistance?: number | null }> {
  const pdbHash = crypto.createHash("sha256").update(pdbText).digest("hex");
  const cacheKey = `${pdbHash}_${targetIndex}_${targetChain || "any"}`;
  const cached = pocketCache.get(cacheKey);
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Biophysical Caching] Cache Hit for binding pocket at residue: ${targetIndex}`);
    }
    return cached;
  }
  const result = await findBindingPocketInternal(pdbText, targetIndex, jobDir, targetChain);
  pocketCache.set(cacheKey, result);
  return result;
}

async function findBindingPocketInternal(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string
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

  let chainToUse = targetChain;
  if (!chainToUse) {
    const matchingAtoms = atoms.filter(a => a.resSeq === mutIndex);
    if (matchingAtoms.length > 0) {
      chainToUse = matchingAtoms[0].chain;
    }
  }

  const mutAtoms = atoms.filter(a => a.resSeq === mutIndex && (chainToUse === undefined || a.chain === chainToUse));
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
            const centerRes = cols[finalResColIdx]; // residue ids list e.g., "A_12 A_13"
            
            const residueKeys = centerRes.split(/\s+/).filter(Boolean);
            const residueIndices = residueKeys.map(x => {
              const parts = x.split("_");
              return parseInt(parts[parts.length - 1], 10);
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
              residueKeys,
              residueIndices,
              volume
            });
          }
        }

        // Find pocket containing mutIndex or closest in space
        let selectedPocket = pockets.find(p => p.residueKeys.includes(`${chainToUse}_${mutIndex}`));
        if (!selectedPocket) {
          selectedPocket = pockets.find(p => p.residueIndices.includes(mutIndex));
        }
        if (!selectedPocket && pockets.length > 0) {
          let minDist = 999999;
          for (const p of pockets) {
            const pAtoms = atoms.filter(a => p.residueKeys.includes(`${a.chain}_${a.resSeq}`));
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
          const pocketResiduesMap: Record<string, any> = {};
          const propensities = getAaPropensities();

          // Group atoms by `${chain}_${resSeq}` key for O(1) lookups
          const atomsByResKey = new Map<string, PdbAtom[]>();
          for (const a of atoms) {
            const key = `${a.chain}_${a.resSeq}`;
            const list = atomsByResKey.get(key) || [];
            list.push(a);
            atomsByResKey.set(key, list);
          }

          for (const rKey of selectedPocket.residueKeys) {
            const resAtoms = atomsByResKey.get(rKey) || [];
            if (resAtoms.length > 0) {
              let rX = 0, rY = 0, rZ = 0;
              resAtoms.forEach(a => { rX += a.x; rY += a.y; rZ += a.z; });
              rX /= resAtoms.length;
              rY /= resAtoms.length;
              rZ /= resAtoms.length;
              
              const distance = Math.sqrt(Math.pow(rX - mutX, 2) + Math.pow(rY - mutY, 2) + Math.pow(rZ - mutZ, 2));
              const resName = resAtoms[0].resName;
              const prop = propensities[resName] || { weight: 1.0, role: "Backbone structural spacer", type: "Aliphatic" };
              
              const parts = rKey.split("_");
              const rIndex = parseInt(parts[parts.length - 1], 10);

              pocketResiduesMap[rKey] = {
                index: rIndex,
                chain: parts[0],
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

          pocketScore = Math.round(selectedPocket.probability * 100);
          if (isNaN(pocketScore) || pocketScore === 0) {
            pocketScore = Math.min(98, Math.round(selectedPocket.score * 5));
          }

          // Dynamic P2Rank Volume calculation
          if (selectedPocket.volume && !isNaN(selectedPocket.volume)) {
            pocketVolume = Math.round(selectedPocket.volume);
          } else {
            // Geometrical estimate based on pocket residues' coordinates
            const pAtoms = atoms.filter(a => selectedPocket.residueKeys.includes(`${a.chain}_${a.resSeq}`));
            if (pAtoms.length > 0) {
              let sumPX = 0, sumPY = 0, sumPZ = 0;
              pAtoms.forEach(a => { sumPX += a.x; sumPY += a.y; sumPZ += a.z; });
              const pcX = sumPX / pAtoms.length;
              const pcY = sumPY / pAtoms.length;
              const pcZ = sumPZ / pAtoms.length;
              
              const distances = pAtoms.map(a => Math.sqrt(Math.pow(a.x - pcX, 2) + Math.pow(a.y - pcY, 2) + Math.pow(a.z - pcZ, 2)));
              const maxDist = Math.max(...distances, 4.0);
              const sphereVolume = (4/3) * Math.PI * Math.pow(maxDist, 3);
              const pocketResiduesCount = selectedPocket.residueKeys.length;
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
          const pAtoms = atoms.filter(a => selectedPocket.residueKeys.includes(`${a.chain}_${a.resSeq}`));
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

export interface DisruptionPrediction {
  level: "high" | "low";
  reason: string;
  plddt: number;
  burialStatus?: "core" | "surface" | "boundary";
  neighborCount?: number;
}

export function predictStructuralDisruption(
  wtPdbText: string,
  wtResidue1: string,
  position: number,
  mutantResidue1: string,
  chain?: string
): DisruptionPrediction {
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
    return { level: "low", reason: "Target residue not found in structure.", plddt: 100, burialStatus: "boundary", neighborCount: 0 };
  }

  let plddt = 100.0;
  for (const line of lines) {
    if (line.startsWith("ATOM") || line.startsWith("HETATM")) {
      const atomName = line.slice(12, 16).trim();
      const c = line.slice(21, 22).trim();
      const resSeqVal = parseInt(line.slice(22, 26).trim(), 10);
      if (atomName === "CA" && resSeqVal === position && (resolvedChain === undefined || c === resolvedChain)) {
        const bFactorStr = line.slice(60, 66).trim();
        const bVal = parseFloat(bFactorStr);
        if (!isNaN(bVal)) {
          plddt = bVal;
          break;
        }
      }
    }
  }

  const targetStruct = structures.find(s => 
    (resolvedChain === undefined || s.chain === resolvedChain) && 
    position >= s.start && position <= s.end
  );
  const secStruct = targetStruct ? targetStruct.type : "loop";

  const targetCa = targetAtoms.find(a => a.name === "CA") || targetAtoms[0];
  let neighborCount = 0;
  for (const a of atoms) {
    if (a.name === "CA" && (a.resSeq !== position || a.chain !== resolvedChain)) {
      const dist = Math.sqrt(Math.pow(a.x - targetCa.x, 2) + Math.pow(a.y - targetCa.y, 2) + Math.pow(a.z - targetCa.z, 2));
      if (dist <= 10.0) {
        neighborCount++;
      }
    }
  }
  const isBuried = neighborCount >= 10;
  const burialStatus = neighborCount >= 15 ? "core" : (neighborCount < 8 ? "surface" : "boundary");

  const buildResult = (level: "high" | "low", reason: string): DisruptionPrediction => {
    return {
      level,
      reason,
      plddt,
      burialStatus,
      neighborCount
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
  const aaVolumes: Record<string, number> = {
    G: 60, A: 89, S: 89, C: 108, D: 111, P: 113, N: 114, T: 116, E: 138, Q: 144, 
    H: 153, V: 138, M: 163, I: 167, L: 167, K: 169, R: 189, F: 190, Y: 194, W: 228
  };
  const volWt = aaVolumes[wt] || 120;
  const volMut = aaVolumes[mut] || 120;
  const volDelta = volMut - volWt;
  if (isBuried && volDelta > 100) {
    return buildResult("high", `Severe core steric expansion (volume increase of +${volDelta} Å³ from ${wt} to ${mut} at position ${position}), expected to cause steric clashes in the packed hydrophobic core.`);
  }

  // Rule D: Proline to glycine loop-flexibility shift
  if (secStruct === "loop" && wt === "P" && mut === "G") {
    return buildResult("high", `Proline to Glycine substitution in structural loop, expected to introduce extreme local backbone flexibility and destabilize the loop trajectory.`);
  }

  return buildResult("low", `Substitution is predicted to have low conformational disruption on the backbone fold.`);
}

export async function runDdgunSeq(wt: string, mut: string): Promise<number | null> {
  const pythonScript = path.join(process.cwd(), "tools", "ddgun", "ddgun_seq.py");
  if (!fs.existsSync(pythonScript)) {
    console.warn(`[DDGun-Seq] Python sidecar not found at: ${pythonScript}. Returning default/null.`);
    return null;
  }
  try {
    const { stdout } = await execFileAsync("python", [pythonScript, wt, mut], { timeout: 5000 });
    const parsed = JSON.parse(stdout.trim());
    if (parsed.status === "success" && typeof parsed.ddg === "number") {
      return parsed.ddg;
    }
    console.warn(`[DDGun-Seq] Predictor returned error or invalid format:`, parsed);
    return null;
  } catch (err: any) {
    console.warn(`[DDGun-Seq] Process execution failed:`, err.message);
    return null;
  }
}

const esm2Cache = new LRUCache<string, any>({
  max: 500
});

export async function runEsm2Eval(
  seq: string,
  pos: number,
  wt: string,
  mut: string
): Promise<{ llr: number; verdict: string } | null> {
  const cacheKey = `${seq.length}_${pos}_${wt}_${mut}`;
  const cached = esm2Cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pythonScript = path.join(process.cwd(), "tools", "esm2_eval.py");
  if (!fs.existsSync(pythonScript)) {
    console.warn(`[ESM2-Eval] Python sidecar not found at: ${pythonScript}.`);
    return null;
  }
  try {
    const { stdout } = await execFileAsync("python", ["-m", "uv", "run", pythonScript, seq, pos.toString(), wt, mut], { timeout: 30000 });
    const parsed = JSON.parse(stdout.trim());
    if (parsed.status === "success" && typeof parsed.llr === "number") {
      const result = { llr: parsed.llr, verdict: parsed.verdict };
      esm2Cache.set(cacheKey, result);
      return result;
    }
    console.warn(`[ESM2-Eval] Predictor returned error or invalid format:`, parsed);
    esm2Cache.set(cacheKey, null);
    return null;
  } catch (err: any) {
    console.warn(`[ESM2-Eval] Process execution failed:`, err.message);
    return null;
  }
}

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number]
];

function transpose3x3(m: Matrix3): Matrix3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]]
  ];
}

function multiply3x3(a: Matrix3, b: Matrix3): Matrix3 {
  const c: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      c[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return c;
}

function det3x3(m: Matrix3): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
         m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
         m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

export function svd3(A: Matrix3): { U: Matrix3; S: [number, number, number]; V: Matrix3 } {
  let U: Matrix3 = [
    [A[0][0], A[0][1], A[0][2]],
    [A[1][0], A[1][1], A[1][2]],
    [A[2][0], A[2][1], A[2][2]]
  ];
  let V: Matrix3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ];

  const maxSweeps = 30;
  const tol = 1e-12;

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let converged = true;
    const pairs = [[0, 1], [0, 2], [1, 2]];
    for (const [i, j] of pairs) {
      let a = U[0][i] * U[0][i] + U[1][i] * U[1][i] + U[2][i] * U[2][i];
      let b = U[0][j] * U[0][j] + U[1][j] * U[1][j] + U[2][j] * U[2][j];
      let c = U[0][i] * U[0][j] + U[1][i] * U[1][j] + U[2][i] * U[2][j];

      if (Math.abs(c) > tol * Math.sqrt(a * b)) {
        converged = false;
        let zeta = (b - a) / (2 * c);
        let t = Math.sign(zeta) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        let cs = 1 / Math.sqrt(1 + t * t);
        let sn = cs * t;

        for (let r = 0; r < 3; r++) {
          let u_r_i = U[r][i];
          let u_r_j = U[r][j];
          U[r][i] = cs * u_r_i - sn * u_r_j;
          U[r][j] = sn * u_r_i + cs * u_r_j;
        }

        for (let r = 0; r < 3; r++) {
          let v_r_i = V[r][i];
          let v_r_j = V[r][j];
          V[r][i] = cs * v_r_i - sn * v_r_j;
          V[r][j] = sn * v_r_i + cs * v_r_j;
        }
      }
    }
    if (converged) break;
  }

  function crossProduct(a: number[], b: number[]): number[] {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  let S: [number, number, number] = [0, 0, 0];
  const normsU = [0, 0, 0];
  const normsV = [0, 0, 0];

  for (let col = 0; col < 3; col++) {
    normsU[col] = Math.sqrt(U[0][col] * U[0][col] + U[1][col] * U[1][col] + U[2][col] * U[2][col]);
    normsV[col] = Math.sqrt(V[0][col] * V[0][col] + V[1][col] * V[1][col] + V[2][col] * V[2][col]);
    S[col] = normsU[col];

    if (normsU[col] > 1e-9) {
      U[0][col] /= normsU[col];
      U[1][col] /= normsU[col];
      U[2][col] /= normsU[col];
    }
    if (normsV[col] > 1e-9) {
      V[0][col] /= normsV[col];
      V[1][col] /= normsV[col];
      V[2][col] /= normsV[col];
    }
  }

  // Handle rank-2 case: if any single column is zero, compute it as the cross product of the other two
  if (normsU[0] <= 1e-9 && normsU[1] > 1e-9 && normsU[2] > 1e-9) {
    const u0 = crossProduct([U[0][1], U[1][1], U[2][1]], [U[0][2], U[1][2], U[2][2]]);
    U[0][0] = u0[0]; U[1][0] = u0[1]; U[2][0] = u0[2];
  } else if (normsU[0] > 1e-9 && normsU[1] <= 1e-9 && normsU[2] > 1e-9) {
    const u1 = crossProduct([U[0][2], U[1][2], U[2][2]], [U[0][0], U[1][0], U[2][0]]);
    U[0][1] = u1[0]; U[1][1] = u1[1]; U[2][1] = u1[2];
  } else if (normsU[0] > 1e-9 && normsU[1] > 1e-9 && normsU[2] <= 1e-9) {
    const u2 = crossProduct([U[0][0], U[1][0], U[2][0]], [U[0][1], U[1][1], U[2][1]]);
    U[0][2] = u2[0]; U[1][2] = u2[1]; U[2][2] = u2[2];
  }

  if (normsV[0] <= 1e-9 && normsV[1] > 1e-9 && normsV[2] > 1e-9) {
    const v0 = crossProduct([V[0][1], V[1][1], V[2][1]], [V[0][2], V[1][2], V[2][2]]);
    V[0][0] = v0[0]; V[1][0] = v0[1]; V[2][0] = v0[2];
  } else if (normsV[0] > 1e-9 && normsV[1] <= 1e-9 && normsV[2] > 1e-9) {
    const v1 = crossProduct([V[0][2], V[1][2], V[2][2]], [V[0][0], V[1][0], V[2][0]]);
    V[0][1] = v1[0]; V[1][1] = v1[1]; V[2][1] = v1[2];
  } else if (normsV[0] > 1e-9 && normsV[1] > 1e-9 && normsV[2] <= 1e-9) {
    const v2 = crossProduct([V[0][0], V[1][0], V[2][0]], [V[0][1], V[1][1], V[2][1]]);
    V[0][2] = v2[0]; V[1][2] = v2[1]; V[2][2] = v2[2];
  }

  return { U, S, V };
}

function calculateClashes(atoms: PdbAtom[]): number {
  const clashThreshold = 2.2;
  const nonHAtoms = atoms.filter(a => !a.name.startsWith("H") && a.name !== "OXT");
  let clashCount = 0;
  
  const grid = new Map<string, PdbAtom[]>();
  const cellSize = 3.0;
  
  for (const atom of nonHAtoms) {
    const gx = Math.floor(atom.x / cellSize);
    const gy = Math.floor(atom.y / cellSize);
    const gz = Math.floor(atom.z / cellSize);
    const key = `${gx},${gy},${gz}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key)!.push(atom);
  }
  
  for (const atom of nonHAtoms) {
    const gx = Math.floor(atom.x / cellSize);
    const gy = Math.floor(atom.y / cellSize);
    const gz = Math.floor(atom.z / cellSize);
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const nKey = `${gx + dx},${gy + dy},${gz + dz}`;
          const cellAtoms = grid.get(nKey);
          if (!cellAtoms) continue;
          for (const other of cellAtoms) {
            if (atom.x > other.x || (atom.x === other.x && atom.y > other.y) || (atom.x === other.x && atom.y === other.y && atom.z >= other.z)) {
              continue;
            }
            if (atom.chain === other.chain && Math.abs(atom.resSeq - other.resSeq) <= 1) {
              continue;
            }
            const distSq = Math.pow(atom.x - other.x, 2) + Math.pow(atom.y - other.y, 2) + Math.pow(atom.z - other.z, 2);
            if (distSq < clashThreshold * clashThreshold) {
              clashCount++;
            }
          }
        }
      }
    }
  }
  return clashCount;
}

export interface StructuralDiffResult {
  rmsd: number;
  localRmsd: number;
  windowDisplacements: { resSeq: number; resName: string; displacement: number }[];
  clashes: {
    wtClashCount: number;
    mutClashCount: number;
    diff: number;
  };
}

export function computeStructuralDiff(
  wtPdb: string,
  mutPdb: string,
  pos: number,
  chain: string
): StructuralDiffResult {
  const wtAtoms = parseAtomsFromPdb(wtPdb);
  const mutAtoms = parseAtomsFromPdb(mutPdb);

  const wtCas = wtAtoms.filter(a => a.name === "CA");
  const mutCas = mutAtoms.filter(a => a.name === "CA");

  const matchedWt: PdbAtom[] = [];
  const matchedMut: PdbAtom[] = [];

  for (const wtCa of wtCas) {
    const mutCa = mutCas.find(a => a.resSeq === wtCa.resSeq && a.chain === wtCa.chain);
    if (mutCa) {
      matchedWt.push(wtCa);
      matchedMut.push(mutCa);
    }
  }

  const n = matchedWt.length;
  if (n === 0) {
    throw new Error("No matching CA atoms found between WT and mutant structures for alignment.");
  }

  let centroidWt = { x: 0, y: 0, z: 0 };
  let centroidMut = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < n; i++) {
    centroidWt.x += matchedWt[i].x;
    centroidWt.y += matchedWt[i].y;
    centroidWt.z += matchedWt[i].z;

    centroidMut.x += matchedMut[i].x;
    centroidMut.y += matchedMut[i].y;
    centroidMut.z += matchedMut[i].z;
  }

  centroidWt.x /= n;
  centroidWt.y /= n;
  centroidWt.z /= n;

  centroidMut.x /= n;
  centroidMut.y /= n;
  centroidMut.z /= n;

  let H: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];

  for (let i = 0; i < n; i++) {
    const px = matchedWt[i].x - centroidWt.x;
    const py = matchedWt[i].y - centroidWt.y;
    const pz = matchedWt[i].z - centroidWt.z;

    const qx = matchedMut[i].x - centroidMut.x;
    const qy = matchedMut[i].y - centroidMut.y;
    const qz = matchedMut[i].z - centroidMut.z;

    H[0][0] += px * qx; H[0][1] += px * qy; H[0][2] += px * qz;
    H[1][0] += py * qx; H[1][1] += py * qy; H[1][2] += py * qz;
    H[2][0] += pz * qx; H[2][1] += pz * qy; H[2][2] += pz * qz;
  }

  const { U, S, V } = svd3(H);

  const VUT = multiply3x3(V, transpose3x3(U));
  const detVal = det3x3(VUT);
  const d = detVal < 0 ? -1 : 1;

  const W: Matrix3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, d]
  ];

  const R = multiply3x3(multiply3x3(V, W), transpose3x3(U));

  let sumSqDist = 0;
  for (let i = 0; i < n; i++) {
    const px = matchedWt[i].x - centroidWt.x;
    const py = matchedWt[i].y - centroidWt.y;
    const pz = matchedWt[i].z - centroidWt.z;

    const ax = px * R[0][0] + py * R[1][0] + pz * R[2][0] + centroidMut.x;
    const ay = px * R[0][1] + py * R[1][1] + pz * R[2][1] + centroidMut.y;
    const az = px * R[0][2] + py * R[1][2] + pz * R[2][2] + centroidMut.z;

    const qx = matchedMut[i].x;
    const qy = matchedMut[i].y;
    const qz = matchedMut[i].z;

    sumSqDist += Math.pow(ax - qx, 2) + Math.pow(ay - qy, 2) + Math.pow(az - qz, 2);
  }
  const rmsd = Math.sqrt(sumSqDist / n);

  const windowDisplacements: { resSeq: number; resName: string; displacement: number }[] = [];
  for (let r = pos - 5; r <= pos + 5; r++) {
    const idx = matchedWt.findIndex(a => a.resSeq === r && a.chain === chain);
    if (idx !== -1) {
      const wtCa = matchedWt[idx];
      const mutCa = matchedMut[idx];

      const px = wtCa.x - centroidWt.x;
      const py = wtCa.y - centroidWt.y;
      const pz = wtCa.z - centroidWt.z;

      const ax = px * R[0][0] + py * R[1][0] + pz * R[2][0] + centroidMut.x;
      const ay = px * R[0][1] + py * R[1][1] + pz * R[2][1] + centroidMut.y;
      const az = px * R[0][2] + py * R[1][2] + pz * R[2][2] + centroidMut.z;

      const dist = Math.sqrt(Math.pow(ax - mutCa.x, 2) + Math.pow(ay - mutCa.y, 2) + Math.pow(az - mutCa.z, 2));
      windowDisplacements.push({
        resSeq: r,
        resName: wtCa.resName,
        displacement: parseFloat(dist.toFixed(4))
      });
    }
  }

  const localRmsd = calculateLocalSidechainRmsd(wtAtoms, mutAtoms, pos, chain);
  const wtClashes = calculateClashes(wtAtoms);
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
