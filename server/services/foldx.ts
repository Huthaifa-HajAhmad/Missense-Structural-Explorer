import os from "os";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { AMINO_ACID_1_TO_3 } from "../../src/aminoAcids.ts";
import { validateUniProt, Semaphore } from "../utils.ts";
import {
  type PdbAtom,
  parseResiduesFromPdbMaybeAsync,
  parseAtomsFromPdb
} from "./pdb-parser.ts";

export const mutantCache = new LRUCache<string, any>({
  max: 100,
  maxSize: 100 * 1024 * 1024, // 100MB limit (M-6)
  sizeCalculation: (value) => (value && typeof value.pdb === "string" ? value.pdb.length : 1000)
});

export interface FoldxParsedResult {
  ddG: number | null;
  sd: number;
  vdw: number;
  electrostatics: number;
  rawDdGs: number[];
  stericClashWarning: boolean;
  isDegenerate?: boolean;
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

  let validDdGs = [...rawDdGs];
  if (rawDdGs.length >= 4) {
    const sorted = [...rawDdGs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const absoluteDeviations = sorted.map(val => Math.abs(val - median)).sort((a, b) => a - b);
    const mad = absoluteDeviations[Math.floor(absoluteDeviations.length / 2)] || 0.0001;
    // Modified Z-score (Iglewicz & Hoaglin 1993): 0.6745 * |x - median| / MAD <= 3.5
    const filtered = rawDdGs.filter(val => {
      const modZ = (0.6745 * Math.abs(val - median)) / mad;
      return modZ <= 3.5;
    });
    if (filtered.length >= 3) {
      validDdGs = filtered;
    }
  }

  const sumDdG = validDdGs.reduce((a, b) => a + b, 0);
  const meanDdG = sumDdG / validDdGs.length;

  let sd = 0;
  if (validDdGs.length > 1) {
    const squareDiffs = validDdGs.map(val => Math.pow(val - meanDdG, 2));
    const sumSquareDiffs = squareDiffs.reduce((a, b) => a + b, 0);
    sd = Math.sqrt(sumSquareDiffs / (validDdGs.length - 1));
  }

  const meanVdw = vdws.reduce((a, b) => a + b, 0) / vdws.length;
  const meanElec = elecs.reduce((a, b) => a + b, 0) / elecs.length;

  const stericClashWarning = meanVdw > 2.0;

  // H-5 Fix: Detect extreme unphysical energy artifacts (> 20 kcal/mol)
  // If FoldX RepairPDB failed or un-repaired clashes exploded, return null and exclude from consensus
  const isDegenerate = Math.abs(meanDdG) > 20.0;
  if (isDegenerate) {
    console.warn(`[FoldX Warning] Extreme unphysical energy artifact detected (mean ΔΔG = ${meanDdG.toFixed(2)} kcal/mol > 20 kcal/mol). Excluding from consensus.`);
  }
  const finalDdG = isDegenerate ? null : parseFloat(meanDdG.toFixed(4));

  return {
    ddG: finalDdG,
    sd: parseFloat(sd.toFixed(4)),
    vdw: parseFloat(meanVdw.toFixed(4)),
    electrostatics: parseFloat(meanElec.toFixed(4)),
    rawDdGs: validDdGs,
    stericClashWarning,
    isDegenerate
  };
}

const execFileAsync = promisify(execFile);

// A-4 Fix: Dynamically size biophysical semaphore concurrency based on CPU core availability
const defaultConcurrency = parseInt(process.env.BIOPHYSICAL_CONCURRENCY || "", 10) || Math.max(1, os.cpus().length - 1);
export const biophysicalSemaphore = new Semaphore(defaultConcurrency);

const biophysicalConcurrency = process.env.BIOPHYSICAL_CONCURRENCY 
  ? parseInt(process.env.BIOPHYSICAL_CONCURRENCY, 10) 
  : 2;
const foldxSemaphore = new Semaphore(biophysicalConcurrency);

export async function generateMutantPdb(
  wtPdb: string,
  validatedMutation: string,
  uniprotId: string | undefined,
  jobDir: string,
  signal?: AbortSignal
): Promise<{ pdb: string; ddG: number | null; status: "success"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
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
    const result = await generateMutantPdbInternal(wtPdb, validatedMutation, uniprotId, jobDir, signal);
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
  jobDir: string,
  signal?: AbortSignal
): Promise<{ pdb: string; ddG: number | null; sd?: number; status: "success"; foldedResidueIndex: number; resolvedChain?: string; energetics?: any }> {
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
  let status: "success" = "success";
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
        cwd: jobDir,
        signal
      });
      const repairedPdbPath = path.join(jobDir, "wt_Repair.pdb");
      if (fs.existsSync(repairedPdbPath)) {
        console.log(`[Biophysical Modeling] Successfully repaired PDB. Overwriting wt.pdb with repaired coordinates.`);
        await fs.promises.rename(repairedPdbPath, fullWtPath);
      }
    } catch (repairErr: any) {
      console.warn(`[Biophysical Modeling] RepairPDB warning (failed or skipped):`, repairErr.message);
    }

    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    // 2. Run FoldX BuildModel with 5 stochastic runs for publication-grade statistics (H1)
    console.log(`[Biophysical Modeling] Executing FoldX BuildModel (5 runs): ${foldxBin}...`);
    let stdout = "", stderr = "";
    try {
      const execRes = await execFileAsync(foldxBin, [
        "--command=BuildModel",
        "--pdb=wt.pdb",
        "--mutant-file=individual_list.txt",
        "--numberOfRuns=5"
      ], {
        timeout: 60000,
        cwd: jobDir,
        signal
      });
      stdout = execRes.stdout;
      stderr = execRes.stderr;
    } catch (execErr: any) {
      if (execErr.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || execErr.killed || execErr.signal === "SIGTERM") {
        console.warn(`[Biophysical Modeling] FoldX execution timed out or killed. Cleaning up process tree.`);
        if (process.platform === "win32") {
          try {
            const { exec } = require("child_process");
            exec(`taskkill /F /IM foldx.exe /T`);
          } catch (_) {}
        } else {
          try {
            const { exec } = require("child_process");
            exec(`pkill -f foldx`);
          } catch (_) {}
        }
      }
      throw execErr;
    }

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
        console.log(`[Biophysical Modeling] Parsed FoldX 5-run stochastic ddG: ${overallDdG} ± ${overallSd} kcal/mol`);
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
