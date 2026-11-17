import path from "path";
import fs from "fs";
import { discoverJavaHome } from "./java-detector.ts";
import { readPocketDescriptorVolume } from "./descriptor-volume.ts";
import { execFileAsync, metered, treeKilledOnStop } from "./tool-process.ts";
import { type DetectedPocket, type JobPaths, type ScoreAndVolume } from "./types.ts";

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

/** Locate the P2Rank launcher: a bundled distribution under tools/p2rank wins over PATH. */
function discoverP2RankCommand(): string {
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
  return p2rankCmd;
}

/** Run the P2Rank launcher (a batch script on Windows), metered and tree-killed on stop. Returns its stdout. */
async function runP2RankCommand(cmd: string, args: string[], opt: any): Promise<string> {
  let resolvedCmd = cmd;
  if (process.platform === "win32" && !resolvedCmd.includes(".") && !path.isAbsolute(resolvedCmd)) {
    resolvedCmd = `${cmd}.bat`;
  }

  const isBatch = resolvedCmd.toLowerCase().endsWith(".bat") || resolvedCmd.toLowerCase().endsWith(".cmd");
  if (isBatch && process.platform === "win32") {
    const shellBinary = process.env.ComSpec || "cmd.exe";
    const quotedCmdLine = `"${[resolvedCmd, ...args].map(a => `"${a.replace(/"/g, '""')}"`).join(" ")}"`;
    const { stdout } = await treeKilledOnStop(metered(execFileAsync(shellBinary, ["/d", "/s", "/c", quotedCmdLine], {
      ...opt,
      windowsVerbatimArguments: true
    })), opt.signal);
    return stdout.toString("utf8");
  }
  const { stdout } = await treeKilledOnStop(metered(execFileAsync(resolvedCmd, args, opt)), opt.signal);
  return stdout.toString("utf8");
}

/** Child-process environment for P2Rank, with JAVA_HOME pointed at a discovered Java when there is one. */
async function p2rankEnvironment(): Promise<NodeJS.ProcessEnv> {
  const env = { ...process.env };
  const discoveredJavaHome = await discoverJavaHome();
  if (discoveredJavaHome) {
    env.JAVA_HOME = discoveredJavaHome;
    console.log(`[Pocket Finder ML] Injecting discovered JAVA_HOME: ${discoveredJavaHome}`);
  } else if (discoveredJavaHome === "") {
    delete env.JAVA_HOME;
  }
  return env;
}

function p2rankTimeoutMs(): number {
  const configured = process.env.P2RANK_TIMEOUT_S ? parseInt(process.env.P2RANK_TIMEOUT_S, 10) * 1000 : 120000;
  return Math.max(90000, isNaN(configured) ? 120000 : configured);
}

/**
 * Run `p2rank predict` on the job's PDB file; the results are left in the output folder.
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
export async function runP2RankTool(profile: string, paths: JobPaths, signal?: AbortSignal): Promise<void> {
  console.log(`[Pocket Finder ML] Probing P2Rank CLI tool on temporary PDB structure...`);
  const cmd = discoverP2RankCommand();
  const args = [
    "predict",
    "-f",
    path.resolve(paths.pdbPath),
    "-o",
    path.resolve(paths.outDir),
    "-c",
    profile,
    "-export_pocket_descriptors",
    "1"
  ];
  const options = {
    timeout: p2rankTimeoutMs(),
    cwd: paths.jobDir,
    signal,
    env: await p2rankEnvironment(),
    detached: process.platform !== "win32"
  };

  let stdout: string;
  try {
    stdout = await runP2RankCommand(cmd, args, options);
  } catch (execErr: any) {
    if (execErr.code !== "ENOENT" || cmd !== "p2rank") throw execErr;
    console.log(`[Pocket Finder ML] 'p2rank' command not recognized. Trying 'prank' as fallback...`);
    stdout = await runP2RankCommand("prank", args, options);
  }
  console.log(`[P2Rank STDOUT]:`, stdout.slice(0, 300));
}

/**
 * The 0–100 score and the volume for a P2Rank pocket, each with its provenance.
 *
 * The score carries one of two different quantities, and the payload says which.
 * `probability` is P2Rank's calibrated probability that the pocket is a
 * true binding site, per model profile. When it rounds to zero the code
 * substitutes `score * 5` — a rescaled raw score with no probabilistic
 * meaning. Reporting both as a percentage is what made the UI call a
 * rescaled score a "binding probability".
 *
 * Volume is only reported when it was measured. The predictions CSV has no
 * volume column, so the previous `sasPoints * 10` fallback published a
 * surface-point count as a volume in cubic Ångströms — a fabricated unit,
 * whose magnitude also scales with P2Rank's `-tessellation` setting. A real
 * volume comes from the `-export_pocket_descriptors` file, read defensively:
 * the descriptor file's exact name and column set live in P2Rank's
 * `documentation/export-pocket-descriptors.md`, which is not part of the
 * bundled distribution, so the file is located by pattern and its columns
 * are resolved from its own header. If anything about it is unexpected,
 * `pocketVolumeSource` stays "unavailable" and the client reports no volume.
 */
export function p2rankScoreAndVolume(selectedPocket: DetectedPocket, outDir: string): ScoreAndVolume {
  let pocketScore: number;
  let pocketScoreSource: "probability" | "rescaled_raw_score" | "unavailable";
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

  let pocketVolume: number;
  let pocketVolumeSource: "measured" | "unavailable";
  if (selectedPocket.volume && !isNaN(selectedPocket.volume)) {
    pocketVolume = Math.round(selectedPocket.volume);
    pocketVolumeSource = "measured";
  } else {
    const descriptorVolume = readPocketDescriptorVolume(outDir, selectedPocket.id);
    if (descriptorVolume !== null) {
      pocketVolume = Math.round(descriptorVolume);
      pocketVolumeSource = "measured";
    } else {
      pocketVolume = 0;
      pocketVolumeSource = "unavailable";
    }
  }
  return { pocketScore, pocketScoreSource, pocketVolume, pocketVolumeSource };
}
