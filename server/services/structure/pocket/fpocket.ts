import path from "path";
import fs from "fs";
import { parseAtomsFromPdb } from "../pdb-parser.ts";
import { execFileAsync, metered } from "./tool-process.ts";
import { type DetectedPocket, type ScoreAndVolume } from "./types.ts";

/** Run fpocket natively or through Docker, whichever the host has; skip when neither exists. */
export async function runFpocketTool(jobDir: string, fullPdbPath: string, signal?: AbortSignal): Promise<void> {
  let useDocker = false;
  let hasNativeFpocket = false;
  const nativeFpocketCmd = process.platform === "win32" ? "fpocket.exe" : "fpocket";
  try {
    await metered(execFileAsync(nativeFpocketCmd, ["-v"]));
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
    await metered(execFileAsync("docker", [
      "run",
      "--rm",
      "-v",
      volumeMount,
      "fpocket/fpocket",
      "fpocket",
      "-f",
      "/workdir/wt.pdb"
    ], { timeout: 30000, signal }));
  } else if (hasNativeFpocket) {
    await metered(execFileAsync(nativeFpocketCmd, ["-f", fullPdbPath], { cwd: jobDir, timeout: 20000, signal }));
  } else {
    console.log(`[Pocket Finder Fallback] Skipping fpocket execution: neither native binary nor Docker engine is accessible.`);
  }
}

/** Read fpocket's `wt_info.txt` scores/volumes and per-pocket atom PDBs; null when no output exists. */
export async function parseFpocketOutput(jobDir: string): Promise<DetectedPocket[] | null> {
  const infoPath = path.join(jobDir, "wt_out", "wt_info.txt");
  const pocketsDir = path.join(jobDir, "wt_out", "pockets");
  if (!fs.existsSync(infoPath) || !fs.existsSync(pocketsDir)) return null;

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
  const pockets: DetectedPocket[] = [];
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
  return pockets;
}

/**
 * fpocket reports a real volume in Å³ and a raw score, not a calibrated
 * probability — so the score is flagged as rescaled and the volume as
 * measured, and the client renders both accordingly.
 */
export function fpocketScoreAndVolume(selected: DetectedPocket): ScoreAndVolume {
  const pocketVolume = Math.round(selected.volume);
  return {
    pocketScore: Math.min(98, Math.round(selected.score * 100)),
    pocketScoreSource: "rescaled_raw_score",
    pocketVolume,
    pocketVolumeSource: Number.isFinite(pocketVolume) && pocketVolume > 0 ? "measured" : "unavailable"
  };
}
