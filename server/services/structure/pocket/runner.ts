import path from "path";
import fs from "fs";
import crypto from "crypto";
import { LRUCache } from "lru-cache";
import { mayServe } from "../../../../src/shared/computeProvenance.ts";
import { serverProvenance } from "../../infra/host-probe.ts";
import { type PdbAtom, parseAtomsFromPdbMaybeAsync, parseResiduesFromPdbMaybeAsync } from "../pdb-parser.ts";
import { defaultCacheRegistry } from "../../infra/cache-registry.ts";
import { determineLikelyCofactor } from "./propensities.ts";
import { selectPocketForResidue } from "./selection.ts";
import { type DetectedPocket, type JobPaths, type PocketInfoResult, type ScoreAndVolume } from "./types.ts";
import { type Point, centroidOf, distanceBetween, describePocketResidues, pocketCentroidDistance, round2 } from "./geometry.ts";
import { p2rankScoreAndVolume, runP2RankTool, selectP2RankProfile } from "./p2rank.ts";
import { parseP2RankPredictions } from "./p2rank-parse.ts";
import { fpocketScoreAndVolume, parseFpocketOutput, runFpocketTool } from "./fpocket.ts";

export { readPocketDescriptorVolume } from "./descriptor-volume.ts";
export { selectP2RankProfile } from "./p2rank.ts";
export type { PocketInfoResult } from "./types.ts";

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
 * The identity of a pocket run: the exact coordinates (hash), the residue, the chain and the P2Rank
 * profile the structure selects; plus the P2Rank version when a host reports one (agents, WP-F).
 * The route uses it to serve a cached result and to join an identical run already in flight.
 */
export function pocketResultCacheKey(pdbText: string, targetIndex: number, targetChain?: string, toolVersion?: string): string {
  const pdbHash = crypto.createHash("sha256").update(pdbText).digest("hex");
  const tool = toolVersion ? `_p2rank:${toolVersion}` : "";
  return `${pdbHash}_${targetIndex}_${targetChain || "any"}_${selectP2RankProfile(pdbText)}${tool}`;
}

/**
 * A cached pocket result the WORKER may use: only one anyone may have. The worker does not know who is
 * waiting, so a re-queued job for someone who was refused a private result (an agent result its owner
 * does not share, `computeProvenance`) must recompute rather than be handed that result here.
 */
export function shareableCachedPocket(cache: LRUCache<string, any>, cacheKey: string): any | null {
  const found = cache.get(cacheKey);
  return found && mayServe(found, null) ? found : null;
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
  const cached = shareableCachedPocket(cache, cacheKey);
  if (cached) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Biophysical Caching] Cache Hit for binding pocket at residue: ${targetIndex}`);
    }
    return cached;
  }
  const result = await findBindingPocketInternal(pdbText, targetIndex, jobDir, targetChain, signal);
  if (result.status === "success" || result.status === "none_detected" || result.status === "fallback") {
    // Every stored result says where it ran (WP-E) and with WHICH tool. A P2Rank job can fall back to
    // fpocket (status "fallback"), and the early none_detected returns happen before any tool ran, so
    // stamp P2Rank's version only when the result's own provenance says P2Rank produced it. Otherwise
    // the telemetry row would credit an fpocket run to P2Rank and teach P2Rank's curves from it.
    if (!(result as any).computeProvenance) {
      const engine = (result as any).provenance?.engine;
      (result as any).computeProvenance = serverProvenance(null, engine === "p2rank" ? "p2rank" : undefined);
    }
    cache.set(cacheKey, result);
  }
  return result;
}

/** The variant residue: its index, the chain it lies on, and the centre of its atoms. */
interface VariantSite {
  index: number;
  chain: string | undefined;
  point: Point;
}

/** What one engine reports for the pocket it selected, before provenance is attached. */
interface PocketFinding extends ScoreAndVolume {
  pocketResidues: any[];
  likelyCofactor: string;
  pocketDistance: number | null;
  cavityCentreDistance: number | null;
  sasPoints?: number;
  surfaceAtoms?: number;
}

const NO_COFACTOR = "None recorded in curated annotations";

function emptyPocketResult(status: "none_detected" | "unavailable", withProvenance = false): PocketInfoResult {
  return {
    pocketResidues: [],
    pocketScore: 0,
    pocketVolume: 0,
    likelyCofactor: NO_COFACTOR,
    status,
    pocketDistance: null,
    ...(withProvenance
      ? {
          cavityCentreDistance: null,
          provenance: { engine: "p2rank" as const, scoreSource: "unavailable" as const, volumeSource: "unavailable" as const }
        }
      : {})
  };
}

/** Find the variant residue in the structure; null when it is absent or has no atoms. */
async function locateVariantSite(
  pdbText: string,
  atoms: PdbAtom[],
  index: number,
  targetChain?: string
): Promise<VariantSite | null> {
  const residues = await parseResiduesFromPdbMaybeAsync(pdbText);
  if (!residues.some(r => r.resSeq === index)) {
    console.warn(`[Pocket Finder] Target residue position ${index} is not found in the PDB structure. Returning none_detected.`);
    return null;
  }
  const chain = targetChain || atoms.find(a => a.resSeq === index)?.chain;
  const siteAtoms = atoms.filter(a => a.resSeq === index && (chain === undefined || a.chain === chain));
  if (siteAtoms.length === 0) {
    console.warn(`[Pocket Finder] Coordinates for target residue position ${index} could not be extracted. Returning none_detected.`);
    return null;
  }
  return { index, chain, point: centroidOf(siteAtoms) };
}

/** Describe the selected pocket: lining residues, the variant's distance to it, and the co-factor note. */
function describeFinding(
  selected: DetectedPocket,
  atoms: PdbAtom[],
  site: VariantSite,
  scoreAndVolume: ScoreAndVolume
): PocketFinding {
  return {
    pocketResidues: describePocketResidues(selected.residueKeys, atoms, site.point),
    ...scoreAndVolume,
    likelyCofactor: determineLikelyCofactor(),
    pocketDistance: pocketCentroidDistance(selected.residueKeys, atoms, site.point),
    cavityCentreDistance: null
  };
}

interface P2RankOutcome {
  finding: PocketFinding | null;
  /** True when P2Rank produced a predictions file, even if no pocket suited the variant. */
  ranSuccessfully: boolean;
  /** The profile the probability is calibrated for; probabilities do not compare across profiles. */
  profile: string;
}

async function detectWithP2Rank(
  pdbText: string,
  atoms: PdbAtom[],
  site: VariantSite,
  paths: JobPaths,
  signal?: AbortSignal
): Promise<P2RankOutcome> {
  const profile = selectP2RankProfile(pdbText);
  const outcome: P2RankOutcome = { finding: null, ranSuccessfully: false, profile };
  try {
    await runP2RankTool(profile, paths, signal);
    const predictionsFile = path.join(paths.outDir, `wt.pdb_predictions.csv`);
    if (!fs.existsSync(predictionsFile)) return outcome;
    outcome.ranSuccessfully = true;

    const pockets = parseP2RankPredictions(await fs.promises.readFile(predictionsFile, "utf8"));
    // Lining pocket first, then the nearest cavity centre: the distance the tab prints and
    // bands. Choosing by residue centroid and printing the centre distance disagreed (selection.ts).
    const selected = selectPocketForResidue(pockets, atoms, site.point, site.index, site.chain);
    if (!selected) return outcome;

    const finding = describeFinding(selected, atoms, site, p2rankScoreAndVolume(selected, paths.outDir));
    finding.sasPoints = selected.sasPoints;
    finding.surfaceAtoms = selected.surfaceAtoms;
    // Distance to P2Rank's own cavity centre, when the CSV carried one. This
    // is the quantity the 4/8/12 Å bands were intended to describe; the
    // centroid above grows with pocket size instead.
    if (selected.cavityCentre) {
      finding.cavityCentreDistance = round2(distanceBetween(selected.cavityCentre, site.point));
    }
    outcome.finding = finding;
  } catch (p2rankErr: any) {
    console.warn(`[Pocket Finder ML] P2Rank execution failed or not installed. Error:`, p2rankErr.message);
  }
  return outcome;
}

async function detectWithFpocket(
  atoms: PdbAtom[],
  site: VariantSite,
  paths: JobPaths,
  signal?: AbortSignal
): Promise<PocketFinding | null> {
  try {
    console.log(`[Pocket Finder Fallback] P2Rank failed/offline. Executing fpocket...`);
    await runFpocketTool(paths.jobDir, paths.pdbPath, signal);
    const pockets = await parseFpocketOutput(paths.jobDir);
    if (!pockets) return null;
    // fpocket reports no cavity centre, so the shared rule falls back to the residue centroid.
    const selected = selectPocketForResidue(pockets, atoms, site.point, site.index, site.chain);
    return selected ? describeFinding(selected, atoms, site, fpocketScoreAndVolume(selected)) : null;
  } catch (fpocketErr: any) {
    console.warn(`[Pocket Finder Fallback] fpocket execution or parsing failed:`, fpocketErr.message);
    return null;
  }
}

export async function findBindingPocketInternal(
  pdbText: string,
  targetIndex: number,
  jobDir: string,
  targetChain?: string,
  signal?: AbortSignal
): Promise<PocketInfoResult> {
  const paths: JobPaths = { jobDir, pdbPath: path.join(jobDir, "wt.pdb"), outDir: path.join(jobDir, "out") };

  // Write PDB to job folder
  await fs.promises.mkdir(jobDir, { recursive: true });
  await fs.promises.writeFile(paths.pdbPath, pdbText, "utf8");
  await fs.promises.mkdir(paths.outDir, { recursive: true });

  const atoms = await parseAtomsFromPdbMaybeAsync(pdbText);
  if (atoms.length === 0) return emptyPocketResult("unavailable");

  const site = await locateVariantSite(pdbText, atoms, Number(targetIndex), targetChain);
  if (!site) return emptyPocketResult("none_detected");

  const p2rank = await detectWithP2Rank(pdbText, atoms, site, paths, signal);
  const finding = p2rank.finding ?? (await detectWithFpocket(atoms, site, paths, signal));
  if (!finding) return emptyPocketResult(p2rank.ranSuccessfully ? "none_detected" : "unavailable", true);

  const { pocketScoreSource, pocketVolumeSource, ...fields } = finding;
  return {
    ...fields,
    /**
     * Where each number came from, so the client never has to guess whether the
     * score is a calibrated probability or whether the volume was measured.
     * `cavityCentreDistance` is null when the engine did not report a centre (fpocket, or a
     * P2Rank version without `center_*`); the client then falls back to `pocketDistance`
     * and says which quantity it is using.
     */
    provenance: {
      engine: p2rank.finding ? "p2rank" : "fpocket",
      scoreSource: pocketScoreSource,
      volumeSource: pocketVolumeSource,
      ...(p2rank.finding ? { profile: p2rank.profile } : {})
    },
    status: p2rank.finding ? "success" : "fallback"
  };
}
