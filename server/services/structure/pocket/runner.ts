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
} from "../pdb-parser.ts";
import { defaultCacheRegistry } from "../../infra/cache-registry.ts";
import { discoverJavaHome } from "./java-detector.ts";
import { getAaPropensities, determineLikelyCofactor } from "./propensities.ts";

const execFileAsync = promisify(execFile);

export const pocketCache = new LRUCache<string, any>({
  max: 100,
  maxSize: 50 * 1024 * 1024, // 50MB limit (M-6)
  sizeCalculation: (value) => {
    if (!value) return 1000;
    const residueCount = Array.isArray(value.pocketResidues) ? value.pocketResidues.length : 0;
    return Math.max(1, residueCount * 50);
  }
});
defaultCacheRegistry.registerCache("pocketCache", pocketCache, { ttlDesc: "7d" });

export async function findBindingPocket(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string,
  signal?: AbortSignal,
  options?: { l1Cache?: LRUCache<string, any> }
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "fallback" | "none_detected" | "unavailable"; pocketDistance?: number | null; sasPoints?: number; surfaceAtoms?: number }> {
  const pdbHash = crypto.createHash("sha256").update(pdbText).digest("hex");
  const cacheKey = `${pdbHash}_${targetIndex}_${targetChain || "any"}`;
  const cache = options?.l1Cache ?? pocketCache;
  const cached = cache.get(cacheKey);
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Biophysical Caching] Cache Hit for binding pocket at residue: ${targetIndex}`);
    }
    return cached;
  }
  const result = await findBindingPocketInternal(pdbText, targetIndex, jobDir, targetChain, signal);
  if (result.status === "success" || result.status === "none_detected" || result.status === "fallback") {
    cache.set(cacheKey, result);
  }
  return result;
}

export async function findBindingPocketInternal(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string,
  signal?: AbortSignal
): Promise<{ pocketResidues: any[]; pocketScore: number; pocketVolume: number; likelyCofactor: string; status: "success" | "fallback" | "none_detected" | "unavailable"; pocketDistance?: number | null; sasPoints?: number; surfaceAtoms?: number }> {
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
  let p2rankRanSuccessfully = false;
  let pocketResidues: any[] = [];
  let pocketScore = 0;
  let pocketVolume = 0;
  let likelyCofactor = "None";
  let sasPoints: number | undefined = undefined;
  let surfaceAtoms: number | undefined = undefined;

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
    } else if (discoveredJavaHome === "") {
      delete env.JAVA_HOME;
    }
    const p2rankTimeoutMs = process.env.P2RANK_TIMEOUT_S
      ? parseInt(process.env.P2RANK_TIMEOUT_S, 10) * 1000
      : 120000;
    const effectiveTimeoutMs = Math.max(90000, isNaN(p2rankTimeoutMs) ? 120000 : p2rankTimeoutMs);
    let options: any = { timeout: effectiveTimeoutMs, cwd: jobDir, signal, env };

    const runP2Rank = async (cmd: string, args: string[], opt: any) => {
      let resolvedCmd = cmd;
      if (process.platform === "win32" && !resolvedCmd.includes(".") && !path.isAbsolute(resolvedCmd)) {
        resolvedCmd = `${cmd}.bat`;
      }

      const isBatch = resolvedCmd.toLowerCase().endsWith(".bat") || resolvedCmd.toLowerCase().endsWith(".cmd");
      if (isBatch && process.platform === "win32") {
        const shellBinary = process.env.ComSpec || "cmd.exe";
        const quotedCmdLine = `"${[resolvedCmd, ...args].map(a => `"${a.replace(/"/g, '""')}"`).join(" ")}"`;
        return await execFileAsync(shellBinary, ["/d", "/s", "/c", quotedCmdLine], {
          ...opt,
          windowsVerbatimArguments: true
        });
      }
      return await execFileAsync(resolvedCmd, args, opt);
    };
    
    let stdout = "";
    try {
      const runRes = await runP2Rank(p2rankCmd, execArgs, options);
      stdout = typeof runRes.stdout === "string" ? runRes.stdout : (runRes.stdout as any).toString("utf8");
    } catch (execErr: any) {
      if (execErr.code === "ENOENT" && p2rankCmd === "p2rank") {
        console.log(`[Pocket Finder ML] 'p2rank' command not recognized. Trying 'prank' as fallback...`);
        p2rankCmd = "prank";
        const runRes = await runP2Rank(p2rankCmd, execArgs, options);
        stdout = typeof runRes.stdout === "string" ? runRes.stdout : (runRes.stdout as any).toString("utf8");
      } else {
        throw execErr;
      }
    }

    console.log(`[P2Rank STDOUT]:`, stdout.slice(0, 300));

    // Parse predictions file
    const predictionsFile = path.join(fullOutDir, `wt.pdb_predictions.csv`);
    if (fs.existsSync(predictionsFile)) {
      p2rankRanSuccessfully = true;
      const csvText = await fs.promises.readFile(predictionsFile, "utf8");
      const csvLines = csvText.split("\n").map(l => l.trim()).filter(Boolean);

      if (csvLines.length > 1) {
        const headerCols = csvLines[0].split(",").map(c => c.trim().toLowerCase());
        const volColIdx = headerCols.findIndex(h => h === "volume" || h === "sas_volume" || h === "volume_sas");
        const sasColIdx = headerCols.findIndex(h => h === "sas_points" || h === "saspoints" || h.includes("sas"));
        const surfAtomsColIdx = headerCols.findIndex(h => h === "surf_atoms" || h === "surfatoms" || h.includes("surf_atom"));
        const resColIdx = headerCols.findIndex(h => h === "residue_ids" || h === "residues" || h.includes("residue"));
        const finalResColIdx = resColIdx !== -1 ? resColIdx : 9;

        const pockets: any[] = [];
        for (let i = 1; i < csvLines.length; i++) {
          const cols = csvLines[i].split(",").map(c => c.trim());
          if (cols.length >= 7) {
            const pId = parseInt(cols[0], 10);
            const score = parseFloat(cols[2]);
            const probability = parseFloat(cols[3]);
            const parsedSas = sasColIdx !== -1 && cols.length > sasColIdx ? parseInt(cols[sasColIdx], 10) : parseInt(cols[4], 10);
            const sasPoints = !isNaN(parsedSas) ? parsedSas : undefined;
            const parsedSurfAtoms = surfAtomsColIdx !== -1 && cols.length > surfAtomsColIdx ? parseInt(cols[surfAtomsColIdx], 10) : (cols.length > 5 ? parseInt(cols[5], 10) : undefined);
            const surfaceAtoms = parsedSurfAtoms !== undefined && !isNaN(parsedSurfAtoms) ? parsedSurfAtoms : undefined;
            const centerRes = (cols.length > finalResColIdx ? cols[finalResColIdx] : "") || "";
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
              surfaceAtoms,
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

          if (selectedPocket.volume && !isNaN(selectedPocket.volume)) {
            pocketVolume = Math.round(selectedPocket.volume);
          } else if (selectedPocket.sasPoints && !isNaN(selectedPocket.sasPoints)) {
            pocketVolume = Math.round(selectedPocket.sasPoints * 10);
          } else {
            pocketVolume = 0;
          }

          sasPoints = selectedPocket.sasPoints;
          surfaceAtoms = selectedPocket.surfaceAtoms;

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
      let hasNativeFpocket = false;
      const nativeFpocketCmd = process.platform === "win32" ? "fpocket.exe" : "fpocket";
      try {
        await execFileAsync(nativeFpocketCmd, ["-v"]);
        hasNativeFpocket = true;
      } catch (err: any) {
        if (err.code === "ENOENT") {
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
      } else if (hasNativeFpocket) {
        await execFileAsync(nativeFpocketCmd, ["-f", fullPdbPath], { cwd: jobDir, timeout: 20000, signal });
      } else {
        console.log(`[Pocket Finder Fallback] Skipping fpocket execution: neither native binary nor Docker engine is accessible.`);
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
      status: p2rankRanSuccessfully ? "none_detected" : "unavailable",
      pocketDistance: null
    };
  }

  return {
    pocketResidues,
    pocketScore,
    pocketVolume,
    sasPoints,
    surfaceAtoms,
    likelyCofactor,
    pocketDistance,
    status: p2rankSuccess ? "success" : "fallback"
  };
}
