import path from "path";
import fs from "fs";
import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  type PdbAtom,
  parseAtomsFromPdbMaybeAsync,
  parseResiduesFromPdbMaybeAsync,
  parseAtomsFromPdb
} from "./pdb-parser.ts";

const execFileAsync = promisify(execFile);

let cachedJavaHome: string | null = null;
let cachedJavaHomeChecked = false;

async function checkJavaVersion(javaExePath: string): Promise<boolean> {
  try {
    const { stderr, stdout } = await execFileAsync(javaExePath, ["-version"], { timeout: 3000 });
    const versionStr = (stderr || stdout || "").toString();
    // Check if the version output is NOT Java 8/7/6/5 (meaning it starts with 9+ or similar, and doesn't match 1.[5-8])
    return !/version\s+"1\.[5-8]\./i.test(versionStr);
  } catch (err) {
    return false;
  }
}

export async function discoverJavaHome(): Promise<string | null> {
  if (cachedJavaHomeChecked) {
    return cachedJavaHome;
  }

  // 1. Check existing env JAVA_HOME
  if (process.env.JAVA_HOME) {
    const candidatePath = path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(candidatePath) && await checkJavaVersion(candidatePath)) {
      cachedJavaHome = process.env.JAVA_HOME;
      cachedJavaHomeChecked = true;
      return cachedJavaHome;
    }
  }

  // 2. Check system default 'java'
  const defaultJavaExe = process.platform === "win32" ? "java.exe" : "java";
  if (await checkJavaVersion(defaultJavaExe)) {
    // If system default java is already Java 17+, we don't need to override JAVA_HOME
    cachedJavaHome = "";
    cachedJavaHomeChecked = true;
    return cachedJavaHome;
  }

  // 3. Scan user directories and other standard JDK locations
  const candidates: string[] = [];
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";

  if (userProfile) {
    const gradleJdksDir = path.join(userProfile, ".gradle", "jdks");
    if (fs.existsSync(gradleJdksDir)) {
      try {
        const folders = fs.readdirSync(gradleJdksDir);
        for (const folder of folders) {
          candidates.push(path.join(gradleJdksDir, folder));
        }
      } catch (_) {}
    }

    const jdksDir = path.join(userProfile, ".jdks");
    if (fs.existsSync(jdksDir)) {
      try {
        const folders = fs.readdirSync(jdksDir);
        for (const folder of folders) {
          candidates.push(path.join(jdksDir, folder));
        }
      } catch (_) {}
    }
  }

  const standardDirs = [
    "C:\\Program Files\\Java",
    "C:\\Program Files\\Android\\Android Studio\\jbr"
  ];
  for (const sDir of standardDirs) {
    if (fs.existsSync(sDir)) {
      candidates.push(sDir);
      try {
        const folders = fs.readdirSync(sDir);
        for (const folder of folders) {
          candidates.push(path.join(sDir, folder));
        }
      } catch (_) {}
    }
  }

  // Probe candidates sequentially
  for (const candidate of candidates) {
    const javaExe = path.join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(javaExe)) {
      if (await checkJavaVersion(javaExe)) {
        cachedJavaHome = candidate;
        cachedJavaHomeChecked = true;
        console.log(`[Pocket Finder ML] Auto-discovered compatible Java 17+ home: ${candidate}`);
        return cachedJavaHome;
      }
    }
  }

  cachedJavaHome = null;
  cachedJavaHomeChecked = true;
  return null;
}

export const pocketCache = new LRUCache<string, any>({
  max: 100,
  maxSize: 50 * 1024 * 1024, // 50MB limit (M-6)
  sizeCalculation: (value) => {
    if (!value) return 1000;
    const residueCount = Array.isArray(value.pocketResidues) ? value.pocketResidues.length : 0;
    return Math.max(1, residueCount * 50);
  }
});

/**
 * Returns empirical amino acid propensities for protein-ligand binding pockets.
 * Weights and roles are derived from Bogan & Thorn (1998) hot spot propensities
 * and classic amino acid chemical properties in structural biology.
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

/**
 * In accordance with the project's strict No Heuristics Policy, we do not synthesize
 * ligand/cofactor identities based on amino acid composition counts.
 * Ligand and cofactor annotations are derived strictly from experimental PDB HETATMs
 * or curated UniProt sequence feature records.
 */
export function determineLikelyCofactor(_typesCount?: Record<string, number>): string {
  return "None recorded in curated annotations";
}

export async function findBindingPocket(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string,
  signal?: AbortSignal
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "none_detected" | "unavailable"; pocketDistance?: number | null }> {
  const pdbHash = crypto.createHash("sha256").update(pdbText).digest("hex");
  const cacheKey = `${pdbHash}_${targetIndex}_${targetChain || "any"}`;
  const cached = pocketCache.get(cacheKey);
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Biophysical Caching] Cache Hit for binding pocket at residue: ${targetIndex}`);
    }
    return cached;
  }
  const result = await findBindingPocketInternal(pdbText, targetIndex, jobDir, targetChain, signal);
  pocketCache.set(cacheKey, result);
  return result;
}

async function findBindingPocketInternal(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string,
  signal?: AbortSignal
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "none_detected" | "unavailable"; pocketDistance?: number | null }> {
  const fullPdbPath = path.join(jobDir, "wt.pdb");
  const fullOutDir = path.join(jobDir, "out");

  // Write PDB to job folder
  await fs.promises.mkdir(jobDir, { recursive: true });
  await fs.promises.writeFile(fullPdbPath, pdbText, "utf8");
  await fs.promises.mkdir(fullOutDir, { recursive: true });

  const atoms = await parseAtomsFromPdbMaybeAsync(pdbText);

  if (atoms.length === 0) {
    return { pocketResidues: [], pocketScore: 0, pocketVolume: 0, likelyCofactor: "None recorded in curated annotations", status: "unavailable", pocketDistance: null };
  }

  let pocketDistance: number | null = null;
  const mutIndex = Number(targetIndex);
  
  // Validate mutIndex exists in WT PDB structure
  const pdbResidues = await parseResiduesFromPdbMaybeAsync(pdbText);
  const hasResidue = pdbResidues.some(r => r.resSeq === mutIndex);
  if (!hasResidue) {
    console.warn(`[Pocket Finder] Target residue position ${mutIndex} is not found in the PDB structure. Returning none_detected.`);
    return { pocketResidues: [], pocketScore: 0, pocketVolume: 0, likelyCofactor: "None recorded in curated annotations", status: "none_detected", pocketDistance: null };
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
    console.warn(`[Pocket Finder] Coordinates for target residue position ${mutIndex} could not be extracted. Returning none_detected.`);
    return { pocketResidues: [], pocketScore: 0, pocketVolume: 0, likelyCofactor: "None recorded in curated annotations", status: "none_detected", pocketDistance: null };
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
        if (process.platform !== "win32") {
          try {
            fs.chmodSync(p2rankCmd, 0o755);
          } catch (chmodErr: any) {
            console.warn(`[Pocket Finder ML] Failed to set executable permissions on ${p2rankCmd}:`, chmodErr.message);
          }
        }
        console.log(`[Pocket Finder ML] Auto-detected local P2Rank binary: ${p2rankCmd}`);
      }
    }

    let execArgs = ["predict", "-f", path.resolve(fullPdbPath), "-o", path.resolve(fullOutDir)];
    let env = { ...process.env };
    const discoveredJavaHome = await discoverJavaHome();
    if (discoveredJavaHome) {
      env.JAVA_HOME = discoveredJavaHome;
      console.log(`[Pocket Finder ML] Injecting discovered JAVA_HOME: ${discoveredJavaHome}`);
    }
    let options: any = { timeout: 25000, cwd: jobDir, signal, env };
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

          // Note: P2Rank outputs a raw unbound score. We scale it here for normalization
          // purposes to represent relative pocket confidence, capped at 98.
          pocketScore = Math.round(selectedPocket.probability * 100);
          if (isNaN(pocketScore) || pocketScore === 0) {
            pocketScore = Math.min(98, Math.round(selectedPocket.score * 5));
          }

          // Dynamic P2Rank Volume calculation
          if (selectedPocket.volume && !isNaN(selectedPocket.volume)) {
            pocketVolume = Math.round(selectedPocket.volume);
          } else {
            // In accordance with No Heuristics Policy, do not invent spherical volume approximations
            pocketVolume = 0;
          }

          likelyCofactor = determineLikelyCofactor();

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
    console.warn(`[Pocket Finder ML] P2Rank execution failed or not installed. Error:`, p2rankErr.message);
  }

  let fpocketSuccess = false;
  if (!p2rankSuccess) {
    try {
      console.log(`[Pocket Finder Fallback] P2Rank failed/offline. Executing fpocket...`);
      let useDocker = false;
      try {
        // Probe if native fpocket exists
        await execFileAsync(process.platform === "win32" ? "fpocket.exe" : "fpocket", ["-v"]);
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // Fall back to checking if docker is available
          try {
            await execFileAsync("docker", ["--version"]);
            useDocker = true;
            console.log(`[Pocket Finder Fallback] Native fpocket not found, but Docker detected. Using dockerized fpocket/fpocket...`);
          } catch (_) {
            console.log(`[Pocket Finder Fallback] Neither native fpocket nor Docker is available.`);
          }
        }
      }

      if (useDocker) {
        const absoluteJobDir = path.resolve(jobDir);
        const volumeMount = `${absoluteJobDir}:/workdir`;
        await execFileAsync("docker", [
          "run",
          "--rm",
          "-v",
          volumeMount,
          "fpocket/fpocket",
          "fpocket",
          "-f",
          "/workdir/wt.pdb"
        ], { timeout: 30000, signal });
      } else {
        await execFileAsync("fpocket", ["-f", fullPdbPath], { cwd: jobDir, timeout: 20000, signal });
      }
      
      const infoPath = path.join(jobDir, "wt_out", "wt_info.txt");
      const pocketsDir = path.join(jobDir, "wt_out", "pockets");
      
      if (fs.existsSync(infoPath) && fs.existsSync(pocketsDir)) {
        const infoText = await fs.promises.readFile(infoPath, "utf8");
        const pocketData: Record<number, { score: number; volume: number }> = {};
        const pocketBlocks = infoText.split(/Pocket\s+(\d+)\s*:/i);
        
        for (let i = 1; i < pocketBlocks.length; i += 2) {
          const pId = parseInt(pocketBlocks[i], 10);
          const blockContent = pocketBlocks[i + 1] || "";
          const scoreMatch = blockContent.match(/Score\s*:\s*([\d.]+)/i);
          const volMatch = blockContent.match(/Volume\s*:\s*([\d.]+)/i);
          const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
          const volume = volMatch ? parseFloat(volMatch[1]) : 0;
          pocketData[pId] = { score, volume };
        }

        const files = fs.readdirSync(pocketsDir);
        const pockets: any[] = [];
        for (const file of files) {
          const atmMatch = file.match(/^pocket(\d+)_atm\.pdb$/i);
          if (atmMatch) {
            const pId = parseInt(atmMatch[1], 10);
            const filePath = path.join(pocketsDir, file);
            const pdbContent = await fs.promises.readFile(filePath, "utf8");
            
            const pocketAtoms = parseAtomsFromPdb(pdbContent);
            const residueKeys = Array.from(new Set(pocketAtoms.map(a => `${a.chain}_${a.resSeq}`)));
            const residueIndices = Array.from(new Set(pocketAtoms.map(a => a.resSeq)));
            
            const stats = pocketData[pId] || { score: 0, volume: 0 };
            pockets.push({
              id: pId,
              score: stats.score,
              volume: stats.volume,
              probability: stats.score,
              sasPoints: pocketAtoms.length,
              residueKeys,
              residueIndices
            });
          }
        }

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

          pocketScore = Math.min(98, Math.round(selectedPocket.score * 100));
          pocketVolume = Math.round(selectedPocket.volume);

          likelyCofactor = determineLikelyCofactor();

          const pAtoms = atoms.filter(a => selectedPocket.residueKeys.includes(`${a.chain}_${a.resSeq}`));
          if (pAtoms.length > 0) {
            let sumPX = 0, sumPY = 0, sumPZ = 0;
            pAtoms.forEach(a => { sumPX += a.x; sumPY += a.y; sumPZ += a.z; });
            const pcX = sumPX / pAtoms.length;
            const pcY = sumPY / pAtoms.length;
            const pcZ = sumPZ / pAtoms.length;
            pocketDistance = parseFloat(Math.sqrt(Math.pow(pcX - mutX, 2) + Math.pow(pcY - mutY, 2) + Math.pow(pcZ - mutZ, 2)).toFixed(2));
          }

          fpocketSuccess = true;
        }
      }
    } catch (fpocketErr: any) {
      console.warn(`[Pocket Finder Fallback] fpocket execution or parsing failed:`, fpocketErr.message);
    }
  }

  if (!p2rankSuccess && !fpocketSuccess) {
    return {
      pocketResidues: [],
      pocketScore: 0,
      pocketVolume: 0,
      likelyCofactor: "None recorded in curated annotations",
      status: "unavailable",
      pocketDistance: null
    };
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

export interface DisruptionPrediction {
  level: "high" | "low" | "unknown";
  reason: string;
  plddt: number | null;
  burialStatus?: "core" | "surface" | "boundary";
  neighborCount?: number;
  sasa?: number;
  rsa?: number;
}

async function runSasaEval(
  wtPdbText: string,
  chain: string,
  position: number
): Promise<{ sasa: number; rsa: number; burialStatus: "core" | "surface" | "boundary" } | null> {
  const tempDir = path.join(process.cwd(), "temp_jobs", `sasa_${crypto.randomUUID()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const pdbPath = path.join(tempDir, "protein.pdb");
  await fs.promises.writeFile(pdbPath, wtPdbText);

  try {
    const pythonScript = path.join(process.cwd(), "tools", "sasa_eval.py");
    const { stdout } = await execFileAsync("python", ["-m", "uv", "run", pythonScript, pdbPath, chain, position.toString()], {
      timeout: 10000
    });
    const result = JSON.parse(stdout.trim());
    if (result.status === "success") {
      return {
        sasa: result.sasa,
        rsa: result.rsa,
        burialStatus: result.burialStatus
      };
    }
  } catch (err) {
    console.warn("[SASA-Eval] Subprocess failure:", err);
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
  return null;
}

export async function predictStructuralDisruption(
  wtPdbText: string,
  wtResidue1: string,
  position: number,
  mutantResidue1: string,
  chain?: string
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
    return { level: "unknown", reason: "Target residue not found in structure.", plddt: null, burialStatus: "boundary", neighborCount: 0 };
  }

  let plddt: number | null = null;
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
      if (dist <= 10.0) {
        neighborCount++;
      }
    }
  }
  // 3. Compute true SASA and RSA using the sidecar script
  const sasaResult = await runSasaEval(wtPdbText, resolvedChain || "A", position);
  
  const burialStatus = sasaResult ? sasaResult.burialStatus : (neighborCount >= 15 ? "core" : (neighborCount < 8 ? "surface" : "boundary"));
  const rsa = sasaResult ? sasaResult.rsa : undefined;
  const sasa = sasaResult ? sasaResult.sasa : undefined;
  const isBuried = burialStatus === "core";

  const buildResult = (level: "high" | "low" | "unknown", reason: string): DisruptionPrediction => {
    return {
      level,
      reason,
      plddt,
      burialStatus,
      neighborCount,
      sasa,
      rsa
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
