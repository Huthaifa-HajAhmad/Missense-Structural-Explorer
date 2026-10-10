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
import { selectPocketForResidue } from "./selection.ts";

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

/**
 * Read a measured pocket volume from P2Rank's `-export_pocket_descriptors` output.
 *
 * The export's file name and columns are not documented in the bundled
 * distribution, so both are discovered rather than assumed: the output directory
 * is scanned for a `*pocket_descriptors*.csv`, its header is searched for a volume
 * column, and a row is matched on a pocket id/rank/name column when one exists.
 *
 * Returns null whenever the file, the column or the matching row is absent, so the
 * caller reports no volume rather than inventing one.
 */
export function readPocketDescriptorVolume(outputDir: string, pocketId: number): number | null {
  try {
    if (!fs.existsSync(outputDir)) return null;

    const candidate = fs
      .readdirSync(outputDir)
      .find(name => /pocket[_-]?descriptors?.*\.csv$/i.test(name));
    if (!candidate) return null;

    const lines = fs
      .readFileSync(path.join(outputDir, candidate), "utf8")
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return null;

    const header = lines[0].split(",").map(cell => cell.trim().toLowerCase());
    const volumeIdx = header.findIndex(cell => cell.includes("volume"));
    if (volumeIdx === -1) return null;

    const idIdx = header.findIndex(cell => ["rank", "id", "name", "pocket", "pocket_id"].includes(cell));

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(",").map(cell => cell.trim());
      if (idIdx !== -1) {
        const numericId = parseInt((cells[idIdx] ?? "").replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(numericId) && numericId !== pocketId) continue;
      }
      const parsed = parseFloat(cells[volumeIdx] ?? "");
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return null;
  } catch (err: any) {
    console.warn(`[Pocket Finder ML] Could not read pocket descriptors:`, err?.message ?? err);
    return null;
  }
}

/**
 * The P2Rank `-c` profile for this structure.
 *
 * P2Rank's README: the default profile uses B-factor as a feature and is meant for X-ray structures;
 * predicted models (AlphaFold, ESMFold), NMR ensembles and cryo-EM must use `alphafold`, and
 * probabilities are calibrated per profile. Nothing upstream says what kind of structure a
 * client-supplied `pdbText` is, so the file's own `EXPDTA` record decides: only an explicit X-ray
 * declaration selects the default profile, and anything else (no record, a predicted model, NMR,
 * EM) keeps `alphafold`. `P2RANK_CONFIG_PROFILE` overrides both.
 */
export function selectP2RankProfile(pdbText: string): string {
  const override = process.env.P2RANK_CONFIG_PROFILE?.trim();
  if (override) return override;
  const methods = pdbText.match(/^EXPDTA\s+(.+)$/gm) ?? [];
  const isXray = methods.length > 0 && methods.every(line => /X-RAY\s+DIFFRACTION/i.test(line));
  return isXray ? "default" : "alphafold";
}

/**
 * The identity of a pocket run: the exact coordinates (hash), the residue, the chain and the P2Rank
 * profile the structure selects; plus the P2Rank version when a host reports one (agents, WP-F).
 * The route uses it to serve a cached result and to join an identical run already in flight.
 */
export function pocketResultCacheKey(pdbText: string, targetIndex: number, targetChain?: string, toolVersion?: string): string {
  const pdbHash = crypto.createHash("sha256").update(pdbText).digest("hex");
  const tool = toolVersion ? `_p2rank:${toolVersion}` : "";
  return `${pdbHash}_${targetIndex}_${targetChain || "any"}_${selectP2RankProfile(pdbText)}${tool}`;
}

export async function findBindingPocket(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string,
  signal?: AbortSignal,
  options?: { l1Cache?: LRUCache<string, any> }
): Promise<PocketInfoResult> {
  const cacheKey = pocketResultCacheKey(pdbText, targetIndex, targetChain);
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

/**
 * Shape of a pocket result, including which quantity each ambiguous field carries.
 *
 * `cavityCentreDistance` is optional because only P2Rank reports a cavity centre;
 * the fpocket path leaves it null and the client then falls back to
 * `pocketDistance` and says so. `provenance` is what lets the client decide
 * whether it may print a unit or a probability label.
 */
export interface PocketInfoResult {
  pocketResidues: any[];
  pocketScore: number;
  pocketVolume: number;
  likelyCofactor: string;
  status: "success" | "fallback" | "none_detected" | "unavailable";
  pocketDistance?: number | null;
  sasPoints?: number;
  surfaceAtoms?: number;
  cavityCentreDistance?: number | null;
  provenance?: {
    engine: "p2rank" | "fpocket";
    scoreSource: "probability" | "rescaled_raw_score" | "unavailable";
    volumeSource: "measured" | "unavailable";
    profile?: string;
  };
}

export async function findBindingPocketInternal(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string,
  signal?: AbortSignal
): Promise<PocketInfoResult> {
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
  /**
   * Provenance for the two numbers the client cannot verify on its own.
   *
   * `pocketScore` is either P2Rank's calibrated probability or a rescaled raw
   * score, and `pocketVolume` is either a measured volume or nothing at all. The
   * client must not print a unit or a probability label it cannot vouch for, so
   * the distinction travels with the payload.
   */
  let pocketScoreSource: "probability" | "rescaled_raw_score" | "unavailable" = "unavailable";
  let pocketVolumeSource: "measured" | "unavailable" = "unavailable";
  let pocketEngine: "p2rank" | "fpocket" = "p2rank";
  /** The P2Rank profile the probability is calibrated for; probabilities do not compare across profiles. */
  let pocketProfile: string | null = null;
  /** Distance from the variant residue to P2Rank's own cavity centre, when reported. */
  let cavityCentreDistance: number | null = null;

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

    /*
     * P2Rank invocation.
     *
     * `-c <profile>` selects the model. The default profile uses B-factor as a
     * feature and is intended for X-ray structures; the README states that
     * predicted structures (AlphaFold, ESMFold), NMR ensembles and cryo-EM maps
     * must use `-c alphafold`, and that probabilities are calibrated per profile
     * and must not be compared across them. This app's pipeline feeds predicted
     * models (pLDDT in the B-factor column), so `alphafold` is the correct
     * default here. The default profile is used only when the file itself declares X-ray
     * diffraction (`selectP2RankProfile`); `P2RANK_CONFIG_PROFILE` overrides both.
     *
     * `-export_pocket_descriptors 1` makes P2Rank write a second CSV containing
     * real per-pocket geometry, including volume. Without it the predictions CSV
     * has no volume column at all, which is why the volume used to be a surface
     * point count multiplied by ten.
     */
    const p2rankProfile = selectP2RankProfile(pdbText);
    pocketProfile = p2rankProfile;
    let execArgs = [
      "predict",
      "-f",
      path.resolve(fullPdbPath),
      "-o",
      path.resolve(fullOutDir),
      "-c",
      p2rankProfile,
      "-export_pocket_descriptors",
      "1"
    ];
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
        /*
         * Header-driven column lookup.
         *
         * The real `*_predictions.csv` header, taken from the bundled
         * p2rank_2.6-alpha jar and cross-checked against its README, is:
         *
         *   name, rank, score, probability, sas_points, surf_atoms,
         *   center_x, center_y, center_z, residue_ids, surf_atom_ids
         *
         * There is NO `volume` column — per-pocket volume is only emitted by the
         * separately-flagged `-export_pocket_descriptors` export, which is read
         * from its own file below. Note also that column 0 is `name` ("pocket1"),
         * so the previous `parseInt(cols[0], 10)` was always NaN; ids are taken
         * from `rank` and fall back to the row ordinal.
         *
         * Column indices are resolved from the header rather than hard-coded, so a
         * future P2Rank version that reorders or adds a column cannot silently
         * shift `score`/`probability` onto the wrong field.
         */
        const headerCols = csvLines[0].split(",").map(c => c.trim().toLowerCase());
        const findCol = (...names: string[]) => headerCols.findIndex(h => names.includes(h));
        const volColIdx = findCol("volume", "sas_volume", "volume_sas");
        const sasColIdx = headerCols.findIndex(h => h === "sas_points" || h === "saspoints" || h.includes("sas"));
        const surfAtomsColIdx = headerCols.findIndex(h => h === "surf_atoms" || h === "surfatoms" || h.includes("surf_atom"));
        const resColIdx = headerCols.findIndex(h => h === "residue_ids" || h === "residues" || h.includes("residue"));
        const finalResColIdx = resColIdx !== -1 ? resColIdx : 9;
        const scoreColIdx = findCol("score");
        const probabilityColIdx = findCol("probability");
        const rankColIdx = findCol("rank");
        const cxColIdx = findCol("center_x", "centerx");
        const cyColIdx = findCol("center_y", "centery");
        const czColIdx = findCol("center_z", "centerz");
        const col = (cols: string[], idx: number) => (idx !== -1 && idx < cols.length ? cols[idx] : undefined);

        const pockets: any[] = [];
        for (let i = 1; i < csvLines.length; i++) {
          const cols = csvLines[i].split(",").map(c => c.trim());
          if (cols.length >= 7) {
            const rawRank = col(cols, rankColIdx);
            const pId = rawRank !== undefined && !isNaN(parseInt(rawRank, 10)) ? parseInt(rawRank, 10) : i;
            const score = parseFloat((col(cols, scoreColIdx) ?? cols[2]) ?? "");
            const probability = parseFloat((col(cols, probabilityColIdx) ?? cols[3]) ?? "");
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

            // P2Rank's own cavity centre. Previously ignored, which forced the
            // distance to be measured to the centroid of the pocket's residues
            // instead — a quantity that grows with pocket size.
            const parsedCentre = [col(cols, cxColIdx), col(cols, cyColIdx), col(cols, czColIdx)].map(v =>
              v === undefined ? NaN : parseFloat(v)
            );
            const cavityCentre = parsedCentre.every(v => Number.isFinite(v))
              ? { x: parsedCentre[0], y: parsedCentre[1], z: parsedCentre[2] }
              : undefined;

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
              volume,
              cavityCentre
            });
          }
        }

        // Lining pocket first, then the nearest cavity centre: the distance the tab prints and
        // bands. Choosing by residue centroid and printing the centre distance disagreed (selection.ts).
        const selectedPocket = selectPocketForResidue(pockets, atoms, { x: mutX, y: mutY, z: mutZ }, mutIndex, chainToUse);

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
          // Nearest the variant residue first. This used to sort by a hand-set residue
          // "propensity" weight, so the client's "top 8" had no stated order.
          pocketResidues.sort((a, b) => a.distance - b.distance);

          /*
           * The 0–100 score carries one of two different quantities, and the
           * payload now says which.
           *
           * `probability` is P2Rank's calibrated probability that the pocket is a
           * true binding site, per model profile. When it rounds to zero the code
           * substitutes `score * 5` — a rescaled raw score with no probabilistic
           * meaning. Reporting both as a percentage is what made the UI call a
           * rescaled score a "binding probability".
           */
          const calibratedProbability = Math.round(selectedPocket.probability * 100);
          if (!isNaN(calibratedProbability) && calibratedProbability !== 0) {
            pocketScore = calibratedProbability;
            pocketScoreSource = "probability";
          } else if (Number.isFinite(selectedPocket.score)) {
            pocketScore = Math.min(98, Math.round(selectedPocket.score * 5));
            pocketScoreSource = "rescaled_raw_score";
          } else {
            pocketScore = 0;
            pocketScoreSource = "unavailable";
          }

          /*
           * Volume is only reported when it was measured.
           *
           * The predictions CSV has no volume column, so the previous
           * `sasPoints * 10` fallback published a surface-point count as a volume
           * in cubic Ångströms — a fabricated unit, whose magnitude also scales
           * with P2Rank's `-tessellation` setting. A real volume comes from the
           * `-export_pocket_descriptors` file (merged below when present) or from
           * the fpocket fallback, which reports one directly.
           */
          if (selectedPocket.volume && !isNaN(selectedPocket.volume)) {
            pocketVolume = Math.round(selectedPocket.volume);
            pocketVolumeSource = "measured";
          } else {
            /*
             * No volume in the predictions CSV. Try the descriptor export, which
             * is the only place P2Rank writes a real one.
             *
             * Deliberately defensive: the descriptor file's exact name and column
             * set live in P2Rank's `documentation/export-pocket-descriptors.md`,
             * which is not part of the bundled distribution, so the file is located
             * by pattern and its columns are resolved from its own header. If
             * anything about it is unexpected, `pocketVolumeSource` stays
             * "unavailable" and the client reports no volume — the pre-existing
             * behaviour rather than a regression.
             */
            const descriptorVolume = readPocketDescriptorVolume(fullOutDir, selectedPocket.id);
            if (descriptorVolume !== null) {
              pocketVolume = Math.round(descriptorVolume);
              pocketVolumeSource = "measured";
            } else {
              pocketVolume = 0;
              pocketVolumeSource = "unavailable";
            }
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

          // Distance to P2Rank's own cavity centre, when the CSV carried one. This
          // is the quantity the 4/8/12 Å bands were intended to describe; the
          // centroid above grows with pocket size instead.
          if (selectedPocket.cavityCentre) {
            const { x: cX, y: cY, z: cZ } = selectedPocket.cavityCentre;
            cavityCentreDistance = parseFloat(
              Math.sqrt(Math.pow(cX - mutX, 2) + Math.pow(cY - mutY, 2) + Math.pow(cZ - mutZ, 2)).toFixed(2)
            );
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

        // fpocket reports no cavity centre, so the shared rule falls back to the residue centroid.
        const selectedPocket = selectPocketForResidue(pockets, atoms, { x: mutX, y: mutY, z: mutZ }, mutIndex, chainToUse);

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
          // Nearest the variant residue first. This used to sort by a hand-set residue
          // "propensity" weight, so the client's "top 8" had no stated order.
          pocketResidues.sort((a, b) => a.distance - b.distance);

          // fpocket reports a real volume in Å³ and a raw score, not a calibrated
          // probability — so the score is flagged as rescaled and the volume as
          // measured, and the client renders both accordingly.
          pocketScore = Math.min(98, Math.round(selectedPocket.score * 100));
          pocketScoreSource = "rescaled_raw_score";
          pocketVolume = Math.round(selectedPocket.volume);
          pocketVolumeSource = Number.isFinite(pocketVolume) && pocketVolume > 0 ? "measured" : "unavailable";
          pocketEngine = "fpocket";

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
      pocketDistance: null,
      cavityCentreDistance: null,
      provenance: { engine: pocketEngine, scoreSource: "unavailable", volumeSource: "unavailable" }
    };
  }

  if (!p2rankSuccess) {
    pocketEngine = "fpocket";
  }

  return {
    pocketResidues,
    pocketScore,
    pocketVolume,
    sasPoints,
    surfaceAtoms,
    likelyCofactor,
    pocketDistance,
    /**
     * Distance to P2Rank's own cavity centre. Null when the engine did not report
     * one (fpocket, or a P2Rank version without `center_*`), in which case the
     * client falls back to `pocketDistance` and says which quantity it is using.
     */
    cavityCentreDistance,
    /**
     * Where each number came from, so the client never has to guess whether the
     * score is a calibrated probability or whether the volume was measured.
     */
    provenance: {
      engine: pocketEngine,
      scoreSource: pocketScoreSource,
      volumeSource: pocketVolumeSource,
      ...(p2rankSuccess && pocketProfile ? { profile: pocketProfile } : {})
    },
    status: p2rankSuccess ? "success" : "fallback"
  };
}
