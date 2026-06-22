import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { AMINO_ACID_1_TO_3 } from "../../src/aminoAcids.ts";
import { validateUniProt, Semaphore } from "../utils.ts";
import { fetchUniprotSequence } from "./external.ts";

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
): Promise<{ pdb: string; ddG: number | null; status: "success" | "scwrl" | "fallback"; foldedResidueIndex: number }> {
  const fullWtPath = path.join(jobDir, "wt.pdb");
  const fullMutPath = path.join(jobDir, "mut.txt");

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
  const mutLine = `${wt1}${chain}${pos}${mut1};\n`;

  await fs.promises.writeFile(fullMutPath, mutLine, "utf8");

  let foldxSuccess = false;
  let mutantPdbContent = "";
  let ddG: number | null = null;
  let status: "success" | "scwrl" | "fallback" = "success";

  try {
    console.log(`[Biophysical Modeling] Probing FoldX CLI tool on temporary PDB structure...`);
    const { stdout, stderr } = await execFileAsync("foldx", [
      "--command=BuildModel",
      "--pdb=wt.pdb",
      "--mutant-file=mut.txt"
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
        const fxLines = fxText.split("\n");
        // Find non-empty line after headers containing calculated energy values
        for (let i = 0; i < fxLines.length; i++) {
          const fLine = fxLines[i].trim();
          if (fLine.startsWith("wt.pdb") || fLine.includes("\t") || fLine.includes(" ")) {
            const parts = fLine.split(/\s+/);
            if (parts.length > 1) {
              const parsedVal = parseFloat(parts[1]);
              if (!isNaN(parsedVal)) {
                ddG = parsedVal;
                console.log(`[Biophysical Modeling] Parsed FoldX stability change (ddG): ${ddG} kcal/mol`);
              }
            }
          }
        }
      }
    }
  } catch (foldxErr: any) {
    console.warn(`[Biophysical Modeling] FoldX execution failed or not installed. Error:`, foldxErr.message);
  }

  // Try SCWRL4 as secondary fallback
  if (!foldxSuccess && uniprotId) {
    try {
      console.log(`[Biophysical Modeling] Attempting SCWRL4 secondary fallback...`);
      const seq = await fetchUniprotSequence(validateUniProt(uniprotId));
      if (seq && pos > 0 && pos <= seq.length) {
        const scwrlSeq = seq.split("").map((aa, idx) => {
          if (idx === pos - 1) {
            return mut1.toUpperCase();
          } else {
            return aa.toLowerCase();
          }
        }).join("");

        const scwrlSeqPath = path.join(jobDir, "scwrl_seq.txt");
        await fs.promises.writeFile(scwrlSeqPath, scwrlSeq, "utf8");

        const scwrlOutPath = path.join(jobDir, "scwrl_out.pdb");
        const { stdout, stderr } = await execFileAsync("scwrl4", [
          "-i", "wt.pdb",
          "-o", "scwrl_out.pdb",
          "-s", "scwrl_seq.txt"
        ], {
          timeout: 25000,
          cwd: jobDir
        });

        console.log(`[SCWRL4 STDOUT]:`, stdout);
        if (stderr) console.warn(`[SCWRL4 STDERR]:`, stderr);

        if (fs.existsSync(scwrlOutPath)) {
          mutantPdbContent = await fs.promises.readFile(scwrlOutPath, "utf8");
          foldxSuccess = true;
          status = "scwrl";
          console.log(`[Biophysical Modeling] Successfully loaded SCWRL4 mutant structure (${mutantPdbContent.length} bytes).`);
        }
      }
    } catch (scwrlErr: any) {
      console.warn(`[Biophysical Modeling] SCWRL4 execution failed or not installed. Error:`, scwrlErr.message);
    }
  }

  if (foldxSuccess && mutantPdbContent) {
    return { pdb: mutantPdbContent, ddG, status, foldedResidueIndex: pos };
  } else {
    console.log(`[Biophysical Modeling Fallback] Performing sequence annotation overlay for position ${pos}...`);
    
    let mut3 = "ALA";
    mut3 = AMINO_ACID_1_TO_3[mut1] || "ALA";

    const pdbLines = wtPdb.split("\n");
    const mutatedPdbLines = pdbLines.map(line => {
      if (line.startsWith("ATOM  ") || line.startsWith("HETATM")) {
        const resSeqStr = line.slice(22, 26).trim();
        const resSeqVal = parseInt(resSeqStr, 10);
        if (resSeqVal === pos) {
          const p1 = line.slice(0, 17);
          const p2 = mut3.padEnd(3).slice(0, 3);
          const p3 = line.slice(20);
          return p1 + p2 + p3;
        }
      }
      return line;
    });

    return { pdb: mutatedPdbLines.join("\n"), ddG: null, status: "fallback", foldedResidueIndex: pos };
  }
}

export async function findBindingPocket(
  pdbText: string,
  targetIndex: number,
  jobDir: string
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "fallback" }> {
  const fullPdbPath = path.join(jobDir, "wt.pdb");
  const fullOutDir = path.join(jobDir, "out");

  // Write PDB to job folder
  await fs.promises.writeFile(fullPdbPath, pdbText, "utf8");
  await fs.promises.mkdir(fullOutDir, { recursive: true });

  const lines = pdbText.split("\n");
  const atoms: { resSeq: number; resName: string; name: string; x: number; y: number; z: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("ATOM  ") || line.startsWith("HETATM")) {
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

  if (atoms.length === 0) {
    return { pocketResidues: [], pocketScore: 0, pocketVolume: 0, likelyCofactor: "None", status: "fallback" };
  }

  const mutIndex = Number(targetIndex);
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
    return { pocketResidues: [], pocketScore: 30, pocketVolume: 150, likelyCofactor: "General small ligand", status: "fallback" };
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
    let execArgs = ["predict", "-f", "wt.pdb", "-o", "out"];
    
    let stdout = "";
    try {
      const runRes = await execFileAsync(p2rankCmd, execArgs, { timeout: 25000, cwd: jobDir });
      stdout = runRes.stdout;
    } catch (execErr: any) {
      if (execErr.code === "ENOENT") {
        console.log(`[Pocket Finder ML] 'p2rank' command not recognized. Trying 'prank' as fallback...`);
        p2rankCmd = "prank";
        const runRes = await execFileAsync(p2rankCmd, execArgs, { timeout: 25000, cwd: jobDir });
        stdout = runRes.stdout;
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
        const pockets: any[] = [];
        for (let i = 1; i < csvLines.length; i++) {
          const cols = csvLines[i].split(",").map(c => c.trim());
          if (cols.length >= 7) {
            const pId = parseInt(cols[0], 10);
            const score = parseFloat(cols[2]);
            const probability = parseFloat(cols[3]);
            const sasPoints = parseInt(cols[4], 10);
            const centerRes = cols[6]; // residue indices list e.g., "12 13 14"
            const residueIndices = centerRes.split(/\s+/).map(x => parseInt(x, 10)).filter(x => !isNaN(x));

            pockets.push({
              id: pId,
              score,
              probability,
              sasPoints,
              residueIndices
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

          for (const rIndex of selectedPocket.residueIndices) {
            const resAtoms = atoms.filter(a => a.resSeq === rIndex);
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

          pocketVolume = Math.round(selectedPocket.sasPoints * 1.5) || 150;

          const typesCount = pocketResidues.reduce((acc, curr) => {
            acc[curr.type] = (acc[curr.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);
          likelyCofactor = determineLikelyCofactor(typesCount);
          p2rankSuccess = true;
        }
      }
    }
  } catch (p2rankErr: any) {
    console.warn(`[Pocket Finder ML] P2Rank execution failed or not installed. Falling back to heuristic. Error:`, p2rankErr.message);
  }

  // Heuristic Fallback
  if (!p2rankSuccess) {
    isFallback = true;
    console.log(`[Pocket Finder Fallback] Running custom distance-based density heuristic...`);
    const residueMap: Record<number, { resSeq: number; resName: string; minDist: number }> = {};
    
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      if (a.resSeq === mutIndex) continue;
      
      const dx = a.x - mutX;
      const dy = a.y - mutY;
      const dz = a.z - mutZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (dist < 10.0) { // 10 Angstrom threshold (S-2)
        if (!residueMap[a.resSeq] || dist < residueMap[a.resSeq].minDist) {
          residueMap[a.resSeq] = { resSeq: a.resSeq, resName: a.resName, minDist: dist };
        }
      }
    }

    const propensities = getAaPropensities();
    const candidates = Object.values(residueMap).map(r => {
      const prop = propensities[r.resName] || { weight: 1.0, role: "Backbone structural spacer", type: "Aliphatic" };
      return {
        index: r.resSeq,
        name: r.resName,
        distance: parseFloat(r.minDist.toFixed(2)),
        score: prop.weight,
        role: prop.role,
        type: prop.type
      };
    });

    candidates.sort((a, b) => a.distance - b.distance);
    pocketResidues = candidates.slice(0, 7);

    let totalScore = pocketResidues.reduce((sum, r) => sum + r.score, 0);
    const normalizedPocketScore = Math.min(98, Math.round((totalScore / 185) * 100));
    pocketScore = normalizedPocketScore === 0 ? 45 : normalizedPocketScore;

    const maxCoreDist = pocketResidues.length > 0 ? Math.max(...pocketResidues.map(r => r.distance)) : 4.0;
    const rawVolume = (4/3) * Math.PI * Math.pow(maxCoreDist, 3);
    pocketVolume = Math.round(rawVolume * (1.1 + (totalScore / 300)));
    pocketVolume = pocketVolume === 0 ? 150 : pocketVolume;

    const typesCount = pocketResidues.reduce((acc, curr) => {
      acc[curr.type] = (acc[curr.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    likelyCofactor = determineLikelyCofactor(typesCount);
  }

  return {
    pocketResidues,
    pocketScore,
    pocketVolume,
    likelyCofactor,
    status: isFallback ? "fallback" : "success"
  };
}
